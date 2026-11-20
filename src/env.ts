export interface Env {
  DB: D1Database;
  WORKSPACE_LIMITER: RateLimit;
  AI_LIMITER: RateLimit;
  TELEGRAM_AGENT: DurableObjectNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  AZURE_OPENAI_DEPLOYMENT?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_API_VERSION?: string;
}
