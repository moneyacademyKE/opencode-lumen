import { Hono } from "hono"

export type Env = {
  SURPLUS_API_KEY: string
  SURPLUS_BASE_URL: string
  GATEWAY_TOKEN_SECRET?: string
  GATEWAY_TOKEN_TTL_SECONDS?: string
  GATEWAY_PORT?: string
  GATEWAY_ALLOWED_MODELS?: string
}

export const DEFAULT_BASE_URL = "https://api.surplusintelligence.ai/v1"
export const DEFAULT_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "glm-5.2", "kimi-k2.7-code"]
export const DEFAULT_PORT = 8787
export const DEFAULT_TTL = 60 * 60

export function readEnv(): Env {
  const key = process.env.SURPLUS_API_KEY ?? ""
  if (!key) console.warn("[gateway] SURPLUS_API_KEY is not set; upstream calls will fail")
  return {
    SURPLUS_API_KEY: key,
    SURPLUS_BASE_URL: (process.env.SURPLUS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    GATEWAY_TOKEN_SECRET: process.env.GATEWAY_TOKEN_SECRET,
    GATEWAY_TOKEN_TTL_SECONDS: process.env.GATEWAY_TOKEN_TTL_SECONDS,
    GATEWAY_PORT: process.env.GATEWAY_PORT,
    GATEWAY_ALLOWED_MODELS: process.env.GATEWAY_ALLOWED_MODELS,
  }
}

export function allowedModels(env: Env): string[] {
  const raw = env.GATEWAY_ALLOWED_MODELS
  if (!raw) return DEFAULT_MODELS
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_MODELS
}

// Web-only base64url (no Buffer) so the same module runs on Bun and Workers.
const b64urlEncode = (bytes: Uint8Array): string => {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const b64urlEncodeStr = (s: string): string => b64urlEncode(new TextEncoder().encode(s))
const b64urlDecodeToStr = (s: string): string => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return b64urlEncode(new Uint8Array(sig))
}

export async function issueToken(env: Env, ttlSeconds = DEFAULT_TTL): Promise<string> {
  if (!env.GATEWAY_TOKEN_SECRET) throw new Error("GATEWAY_TOKEN_SECRET is required to issue tokens")
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = b64urlEncodeStr(JSON.stringify({ exp }))
  const sig = await hmac(payload, env.GATEWAY_TOKEN_SECRET)
  return `${payload}.${sig}`
}

export async function verifyToken(token: string | undefined, env: Env): Promise<boolean> {
  if (!env.GATEWAY_TOKEN_SECRET) return true
  if (!token) return false
  const [payload, sig] = token.split(".")
  if (!payload || !sig) return false
  const expected = await hmac(payload, env.GATEWAY_TOKEN_SECRET)
  if (expected !== sig) return false
  try {
    const { exp } = JSON.parse(b64urlDecodeToStr(payload)) as { exp: number }
    return exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function unauthorized(c: any) {
  return c.json({ error: { type: "unauthorized", message: "Invalid or missing token" } }, 401)
}

function extractBearer(req: Request): string | undefined {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization")
  if (!h) return undefined
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : undefined
}

export function createApp(env: Env) {
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true, time: Date.now() }))

  app.post("/token", async (c) => {
    if (!env.GATEWAY_TOKEN_SECRET)
      return c.json({ error: { message: "Token issuance disabled (no secret configured)" } }, 400)
    const ttl = Number(env.GATEWAY_TOKEN_TTL_SECONDS ?? DEFAULT_TTL)
    const token = await issueToken(env, ttl > 0 ? ttl : DEFAULT_TTL)
    return c.json({ token, expires_in: ttl })
  })

  app.get("/v1/models", async (c) => {
    if (!(await verifyToken(extractBearer(c.req.raw), env))) return unauthorized(c)
    const ids = allowedModels(env)
    return c.json({
      object: "list",
      data: ids.map((id) => ({ id, object: "model", owned_by: "lumen-orchard" })),
    })
  })

  app.post("/v1/chat/completions", async (c) => {
    if (!(await verifyToken(extractBearer(c.req.raw), env))) return unauthorized(c)

    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { type: "invalid_request", message: "Invalid JSON body" } }, 400)
    }

    const models = allowedModels(env)
    if (body.model && !models.includes(body.model)) {
      return c.json(
        { error: { type: "invalid_request", message: `Model '${body.model}' is not available` } },
        400,
      )
    }

    const upstream = new URL(`${env.SURPLUS_BASE_URL}/chat/completions`)
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.SURPLUS_API_KEY}`,
        accept: body.stream === true ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(body),
    })

    const streaming = body.stream === true && upstreamRes.body
    if (streaming) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    }
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: { "content-type": upstreamRes.headers.get("content-type") ?? "application/json" },
    })
  })

  return app
}
