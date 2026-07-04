export * from "./app"

import { createApp, readEnv, DEFAULT_PORT } from "./app"
import { createServer } from "node:http"

export function start(env = readEnv()) {
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
      app
        .fetch(new Request(url, init))
        .then((resp) => {
          res.statusCode = resp.status
          resp.headers.forEach((v, k) => res.setHeader(k, v))
          if (resp.body) {
            const reader = resp.body.getReader()
            const pump = (): Promise<void> =>
              reader
                .read()
                .then(({ done, value }) => {
                  if (done) {
                    res.end()
                    return Promise.resolve()
                  }
                  res.write(value)
                  return pump()
                })
            pump().catch(() => {
              try {
                res.end()
              } catch {}
            })
          } else {
            res.end()
          }
        })
        .catch((err) => {
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

if (import.meta.main) {
  start()
}
