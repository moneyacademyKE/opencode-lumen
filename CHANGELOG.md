# Changelog

## v0.2.2-gateway-default — Client Defaults to Cloudflare Gateway

### Changed
- The built-in `lumen-orchard` provider now defaults to the live Cloudflare
  Workers gateway URL:
  `https://lumen-orchard-gateway.iamkingori.workers.dev/v1`
- OpenCode client builds published from this repo now point at the gateway by
  default, so end users talk to the worker rather than the upstream directly.

### Verified
- Gateway-backed chat completion on the Cloudflare worker still returns a real
  completion from Surplus.
- Provider lock and catalog filtering tests still pass.

## v0.2.1-cloudflare — Gateway on Cloudflare Workers

### Added
- **Cloudflare Workers entry** (`packages/gateway/worker.ts`) — the same Hono
  app now runs on Workers with zero logic duplication.
- **`wrangler.toml`** — deploys as `lumen-orchard-gateway` on `workers.dev`.
- **Pure-Web core** (`packages/gateway/src/app.ts`) — removed the `node:http`
  and `Buffer` dependencies from the shared module so it runs on both Bun and
  the Workers runtime. `src/index.ts` keeps the Bun `start()` server wrapper.
- **Deploy + secret scripts** in `packages/gateway/package.json`
  (`deploy`, `dev:worker`).

### Deployed
- Live worker: `https://lumen-orchard-gateway.iamkingori.workers.dev`
- `SURPLUS_API_KEY` pushed as a Cloudflare secret (not in the repo).
- `GATEWAY_TOKEN_SECRET` pushed; clients now require an HMAC token.
- Verified end-to-end on Workers: `/health`, `/v1/models` (401 without token,
  200 with token issued by `/token`), and `/v1/chat/completions`.

---

## v0.2.0-gateway — Lumen Orchard Gateway

### Added
- **`packages/gateway`** — minimal OpenAI-compatible gateway that holds the
  real upstream credential server-side and exposes the Lumen Orchard surface
  to OpenCode clients.
  - Endpoints: `GET /health`, `POST /token`, `GET /v1/models`,
    `POST /v1/chat/completions` (streaming-aware).
  - Optional HMAC-signed short-lived client tokens (`GATEWAY_TOKEN_SECRET`).
  - Model allowlist via `GATEWAY_ALLOWED_MODELS`.
  - Streams `/chat/completions` straight through to the upstream.
- **Tests** (`packages/gateway/test/gateway.test.ts`) — 10 cases covering
  model allowlist, token issue/verify/expiry/tamper, auth gate, model
  rejection, and upstream forwarding.
- **End-to-end verified** against `api.surplusintelligence.ai/v1`:
  `/v1/models`, non-streaming completion, and streaming completion all pass.

### Why
A locally distributed binary cannot keep an embedded secret. The gateway is
the secrecy boundary: the upstream key lives only on the gateway server, and
clients receive only short-lived tokens.

### Setup
```bash
export SURPLUS_API_KEY=inf_xxx
export GATEWAY_TOKEN_SECRET=$(openssl rand -hex 32)
cd packages/gateway && bun run dev
```
See [`packages/gateway/README.md`](./packages/gateway/README.md).

---

## v0.1.0-lumen — Provider Lock & Lumen Orchard Catalog

### Added
- **`provider_lock` config field** (`packages/core/src/config.ts`).
  Optional string that restricts provider access to a single provider ID.
  When set, config loading injects two policy statements after any explicit
  `experimental.policies`:
  - `deny provider.use *`
  - `allow provider.use <provider_lock>`
- **Lumen Orchard built-in provider** (`packages/core/src/plugin/provider/lumen-orchard.ts`).
  OpenAI-compatible provider registered as `lumen-orchard`, wired into the
  provider plugin list (`packages/core/src/plugin/provider.ts`).
  Curated model catalog:
  - `gpt-5.5`
  - `gpt-5.4`
  - `gpt-5.4-mini`
  - `glm-5.2`
  - `kimi-k2.7-code`
  Endpoint resolves from `OPENCODE_LUMEN_ORCHARD_URL`, defaulting to
  `https://lumen-orchard.example.com/v1`.
  Credentials resolve from `LUMEN_ORCHARD_API_KEY` or `SURPLUS_API_KEY`.

### Tests
- `Config > loads provider lock as final provider policy`
  (`packages/core/test/config/config.test.ts`)
- `CatalogV2 > keeps only the provider allowed by provider policy`
  (`packages/core/test/catalog.test.ts`)
- `Config > accepts $schema metadata without writing it into config files`
  extended to assert `provider_lock` round-trips.

### Verification
- `bun test test/config/config.test.ts test/catalog.test.ts` — 30 pass / 0 fail
- `bun typecheck` — `packages/core`, `packages/opencode`, `packages/desktop`
- Native CLI build + smoke test — `opencode-darwin-arm64`
- Desktop build + macOS arm64 packaging — `.dmg`, `.zip`

### Security Note
This release locks the UI/catalog to one provider and its models. It does
**not** embed provider API keys or upstream endpoints. For real key/endpoint
secrecy, run a backend gateway and point `OPENCODE_LUMEN_ORCHARD_URL` at it;
the gateway holds the real upstream credential.
