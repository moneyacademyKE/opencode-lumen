import { Effect } from "effect"
import { define } from "../internal"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

const providerID = ProviderV2.ID.make("lumen-orchard")
const endpoint = process.env.OPENCODE_LUMEN_ORCHARD_URL ?? "https://lumen-orchard-gateway.iamkingori.workers.dev/v1"

const models = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "glm-5.2", "kimi-k2.7-code"] as const

export const LumenOrchardPlugin = define({
  id: "lumen-orchard",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update(Integration.ID.make(providerID), (integration) => {
        integration.name = "Lumen Orchard"
      })
      draft.method.update({
        integrationID: Integration.ID.make(providerID),
        method: { type: "env", names: ["LUMEN_ORCHARD_API_KEY", "SURPLUS_API_KEY"] },
      })
    })

    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.name = "Lumen Orchard"
        provider.integrationID = Integration.ID.make(providerID)
        provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: endpoint, settings: {} }
      })

      for (const id of models) {
        catalog.model.update(providerID, ModelV2.ID.make(id), (model) => {
          model.name = id
          model.family = ModelV2.Family.make(id.split("-").slice(0, 2).join("-"))
          model.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", id: ModelV2.ID.make(id), url: endpoint }
          model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
          model.limit = { context: id.includes("mini") ? 128_000 : 256_000, output: id.includes("mini") ? 16_384 : 32_768 }
          model.time.released = Date.UTC(2026, 0, 1)
          model.status = "active"
          model.enabled = true
        })
      }
    })
  }),
})
