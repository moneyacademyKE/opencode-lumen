import { createApp, type Env } from "./src/app"

export type CfEnv = {
  SURPLUS_API_KEY: string
  SURPLUS_BASE_URL?: string
  GATEWAY_TOKEN_SECRET?: string
  GATEWAY_TOKEN_TTL_SECONDS?: string
  GATEWAY_ALLOWED_MODELS?: string
}

export default {
  async fetch(request: Request, env: CfEnv): Promise<Response> {
    const resolved: Env = {
      SURPLUS_API_KEY: env.SURPLUS_API_KEY ?? "",
      SURPLUS_BASE_URL: (env.SURPLUS_BASE_URL ?? "https://api.surplusintelligence.ai/v1").replace(/\/$/, ""),
      GATEWAY_TOKEN_SECRET: env.GATEWAY_TOKEN_SECRET,
      GATEWAY_TOKEN_TTL_SECONDS: env.GATEWAY_TOKEN_TTL_SECONDS,
      GATEWAY_PORT: undefined,
      GATEWAY_ALLOWED_MODELS: env.GATEWAY_ALLOWED_MODELS,
    }
    return createApp(resolved).fetch(request)
  },
}
