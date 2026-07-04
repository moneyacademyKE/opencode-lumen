# Lumen Orchard Gateway

A minimal OpenAI-compatible gateway that holds the real upstream credential
and exposes the Lumen Orchard provider surface to OpenCode clients.

```
OpenCode client  -->  gateway (your server)  -->  real upstream API
                       holds SURPLUS_API_KEY       api.surplusintelligence.ai
```

The client only ever sees the gateway URL and (optionally) a short-lived
client token. The real upstream key never ships in the CLI or desktop app.

## Why

A locally distributed binary cannot keep an embedded secret: any user can
inspect memory, `strings`, or sniff the app's own network traffic. Moving the
credential server-side is the only durable secrecy boundary. The gateway also
lets you rate-limit, audit, rotate, and revoke without shipping new clients.

## Run

```bash
# 1. Set server-only secrets
export SURPLUS_API_KEY=inf_xxx
export SURPLUS_BASE_URL=https://api.surplusintelligence.ai/v1   # default

# 2. (Recommended) Require clients to present a short-lived token
export GATEWAY_TOKEN_SECRET=$(openssl rand -hex 32)
export GATEWAY_TOKEN_TTL_SECONDS=3600

# 3. (Optional) Restrict the model catalog
export GATEWAY_ALLOWED_MODELS=gpt-5.5,gpt-5.4,gpt-5.4-mini,glm-5.2,kimi-k2.7-code

# 4. Start
cd packages/gateway && bun run dev
# Listening on http://localhost:8787
```

Deploy anywhere that runs Bun (or Node 18+ with `node --import tsx`).

## Endpoints

- `GET /health` — `{ ok: true, time }`
- `POST /token` — issue a client token (only when `GATEWAY_TOKEN_SECRET` is set)
- `GET /v1/models` — Lumen Orchard catalog
- `POST /v1/chat/completions` — OpenAI-compatible, streaming-aware

## Point OpenCode at the gateway

Set on the client machine (env or shell rc):

```bash
export OPENCODE_LUMEN_ORCHARD_URL=https://gateway.your-domain.com/v1
export LUMEN_ORCHARD_API_KEY=<client token from POST /token>
```

Then OpenCode config:

```jsonc
{
  "provider_lock": "lumen-orchard",
  "model": "lumen-orchard/gpt-5.5"
}
```

The built-in `lumen-orchard` provider already maps the model IDs
(`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `glm-5.2`, `kimi-k2.7-code`) to the
OpenAI-compatible adapter pointed at `OPENCODE_LUMEN_ORCHARD_URL`.

## Tokens

When `GATEWAY_TOKEN_SECRET` is unset, the gateway is **open** (dev mode). In
production always set the secret. Tokens are `base64url(payload).base64url(hmac)`
with `payload = { exp }`. Default TTL is 1 hour. Rotate by changing the secret.

## Rate limiting / audit

The gateway is intentionally minimal. Put it behind Cloudflare, nginx, or a
PaaS that provides rate limiting, TLS, and access logs. The app streams
`/chat/completions` responses straight through.
