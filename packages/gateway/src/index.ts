import { Hono } from "hono"
import { createServer } from "node:http"

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

const b64url = (s: string) => Buffer.from(s).toString("base64url")
const b64urlDecode = (s: string) => Buffer.from(s, "base64url").toString("utf8")

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return b64url(String.fromCharCode(...new Uint8Array(sig)))
}

export async function issueToken(env: Env, ttlSeconds = DEFAULT_TTL): Promise<string> {
  if (!env.GATEWAY_TOKEN_SECRET) throw new Error("GATEWAY_TOKEN_SECRET is required to issue tokens")
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = b64url(JSON.stringify({ exp }))
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
    const { exp } = JSON.parse(b64urlDecode(payload)) as { exp: number }
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

export function createApp(env: Env = readEnv()) {
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true, time: Date.now() }))

  app.post("/token", async (c) => {
    if (!env.GATEWAY_TOKEN_SECRET) return c.json({ error: { message: "Token issuance disabled (no secret configured)" } }, 400)
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
      return c.json({ error: { type: "invalid_request", message: `Model '${body.model}' is not available` } }, 400)
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

export function start(env: Env = readEnv()) {
  const app = createApp(env)
  const port = Number(env.GATEWAY_PORT ?? DEFAULT_PORT)
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv))
        else if (typeof v === "string") headers.set(k, v)
      }
      const init: RequestInit = { method: req.method ?? "GET", headers }
      const buf = Buffer.concat(chunks)
      if (buf.length) init.body = buf
      app.fetch(new Request(url, init)).then((resp) => {
        res.statusCode = resp.status
        resp.headers.forEach((v, k) => res.setHeader(k, v))
        if (resp.body) {
          const reader = resp.body.getReader()
          const pump = (): Promise<void> =>
            reader.read().then(({ done, value }) => {
              if (done) {
                res.end()
                return Promise.resolve()
              }
              res.write(value)
              return pump()
            })
          pump().catch(() => {
            try { res.end() } catch {}
          })
        } else {
          res.end()
        }
      }).catch((err) => {
        console.error("[gateway] fetch error", err)
        res.statusCode = 500
        res.end(JSON.stringify({ error: { message: "Internal gateway error" } }))
      })
    })
  })
  server.listen(port, () => {
    console.log(`[gateway] Lumen Orchard gateway listening on http://localhost:${port}`)
    console.log(`[gateway] upstream: ${env.SURPLUS_BASE_URL}`)
    console.log(`[gateway] models: ${allowedModels(env).join(", ")}`)
    console.log(`[gateway] auth: ${env.GATEWAY_TOKEN_SECRET ? "HMAC token required" : "open (no secret set)"}`)
  })
  return server
}

if (import.meta.main || (typeof process !== "undefined" && process.argv[1]?.endsWith("gateway/src/index.ts"))) {
  start()
}
