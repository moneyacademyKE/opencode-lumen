import { describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODELS,
  allowedModels,
  createApp,
  issueToken,
  readEnv,
  verifyToken,
} from "../src/index"

const env = (overrides: Partial<ReturnType<typeof readEnv>> = {}) => ({
  SURPLUS_API_KEY: "test-key",
  SURPLUS_BASE_URL: DEFAULT_BASE_URL,
  ...overrides,
})

describe("gateway", () => {
  it("returns the default model list when no override is set", () => {
    expect(allowedModels(env())).toEqual(DEFAULT_MODELS)
  })

  it("honors an explicit allowlist", () => {
    const list = allowedModels(env({ GATEWAY_ALLOWED_MODELS: "gpt-5.5, glm-5.2," }))
    expect(list).toEqual(["gpt-5.5", "glm-5.2"])
  })

  it("falls back to defaults on an empty allowlist", () => {
    expect(allowedModels(env({ GATEWAY_ALLOWED_MODELS: " , " }))).toEqual(DEFAULT_MODELS)
  })

  it("allows requests when no secret is configured", async () => {
    const app = createApp(env())
    const res = await app.fetch(new Request("http://x/v1/models"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.map((m: any) => m.id)).toEqual(DEFAULT_MODELS)
  })

  it("rejects requests without a valid token when a secret is configured", async () => {
    const app = createApp(env({ GATEWAY_TOKEN_SECRET: "shh" }))
    const res = await app.fetch(new Request("http://x/v1/models"))
    expect(res.status).toBe(401)
  })

  it("accepts a freshly issued token", async () => {
    const e = env({ GATEWAY_TOKEN_SECRET: "shh" })
    const app = createApp(e)
    const token = await issueToken(e, 60)
    expect(await verifyToken(token, e)).toBe(true)
    const res = await app.fetch(
      new Request("http://x/v1/models", { headers: { authorization: `Bearer ${token}` } }),
    )
    expect(res.status).toBe(200)
  })

  it("rejects a tampered token", async () => {
    const e = env({ GATEWAY_TOKEN_SECRET: "shh" })
    const token = await issueToken(e, 60)
    const tampered = token.slice(0, -2) + "xx"
    expect(await verifyToken(tampered, e)).toBe(false)
  })

  it("rejects an expired token", async () => {
    const e = env({ GATEWAY_TOKEN_SECRET: "shh" })
    const token = await issueToken(e, -10)
    expect(await verifyToken(token, e)).toBe(false)
  })

  it("forwards chat completions to the configured upstream and passes through status", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fakeFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init as RequestInit })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    mock.module("node:fs", () => ({}))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fakeFetch as any
    try {
      const app = createApp(env({ SURPLUS_BASE_URL: "https://upstream.example.com/v1" }))
      const res = await app.fetch(
        new Request("http://x/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-5.5", messages: [{ role: "user", content: "hi" }] }),
        }),
      )
      expect(res.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe("https://upstream.example.com/v1/chat/completions")
      const forwarded = calls[0]?.init
      expect((forwarded?.headers as any)?.authorization).toBe("Bearer test-key")
      expect(await res.json()).toEqual({ ok: true })
    } finally {
      globalThis.fetch = originalFetch
      mock.restore()
    }
  })

  it("rejects a model that is not in the allowlist", async () => {
    const app = createApp(env())
    const res = await app.fetch(
      new Request("http://x/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-opus", messages: [] }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
