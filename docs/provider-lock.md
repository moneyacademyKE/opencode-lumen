# Provider Lock

`provider_lock` restricts OpenCode to a single provider ID. It is the simplest
way to ship a branded, single-provider build.

## Behavior

When `provider_lock` is set, config loading appends two policy statements after
any explicit `experimental.policies`:

```
deny  provider.use  *
allow provider.use  <provider_lock>
```

The catalog finalize step (`packages/core/src/catalog.ts`) then removes every
provider that resolves to `deny`. The TUI, web, and desktop model pickers read
`catalog.provider.available()` / `catalog.model.available()`, so denied
providers and their models disappear from selection.

Explicit `--model <denied-provider>/<model>` fails resolution through
`SessionRunnerModel.resolve` because the model no longer exists in the catalog.

## Example

```jsonc
{
  "provider_lock": "lumen-orchard",
  "model": "lumen-orchard/gpt-5.5"
}
```

## Interaction with `experimental.policies`

`experimental.policies` are loaded first, in reverse document order. The
generated `provider_lock` statements are appended last. Because `Policy.evaluate`
returns the **last** matching statement, a later generated lock can override an
earlier explicit statement. If you need an escape hatch, do not use
`provider_lock`; author `experimental.policies` directly.

## Built-in Lumen Orchard provider

This fork ships a built-in `lumen-orchard` provider so `provider_lock` works
without extra user config.

- Provider ID: `lumen-orchard`
- Adapter: `@ai-sdk/openai-compatible`
- Endpoint: `OPENCODE_LUMEN_ORCHARD_URL` env, default
  `https://lumen-orchard.example.com/v1`
- Credentials env: `LUMEN_ORCHARD_API_KEY`, then `SURPLUS_API_KEY`
- Models: `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `glm-5.2`, `kimi-k2.7-code`

## Secrecy boundary

Provider locking hides nothing at the network layer. A locally running CLI or
desktop app can be inspected for the endpoint it calls. To keep a real upstream
key and endpoint secret, run a gateway:

```
OpenCode -> OPENCODE_LUMEN_ORCHARD_URL (your gateway) -> real upstream
```

The gateway holds the real credential; OpenCode only knows the gateway URL.
