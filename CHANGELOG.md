# Changelog

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
