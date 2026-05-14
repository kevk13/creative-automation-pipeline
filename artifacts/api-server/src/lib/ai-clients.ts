import Anthropic from "@anthropic-ai/sdk";

function getAnthropicApiKey(): string {
  return (
    process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ||
    process.env["ANTHROPIC_API_KEY"] ||
    "not-configured"
  );
}

function getAnthropicBaseUrl(): string | undefined {
  return process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] || undefined;
}

export function createAnthropicClient(): Anthropic {
  const baseURL = getAnthropicBaseUrl();
  return new Anthropic({
    apiKey: getAnthropicApiKey(),
    ...(baseURL ? { baseURL } : {}),
  });
}

export function validateAiClients(): void {
  const hasAnthropicIntegration =
    process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] &&
    process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];

  const hasAnthropicKey = !!process.env["ANTHROPIC_API_KEY"];

  const hasGeminiIntegration =
    process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"] &&
    process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];

  const hasGeminiKey = !!process.env["GEMINI_API_KEY"];

  if (!hasAnthropicIntegration && !hasAnthropicKey) {
    console.error(
      "ERROR: Anthropic API key not configured.\n" +
        "  On Replit: enable the Anthropic AI Integration in the integrations panel.\n" +
        "  Locally: set ANTHROPIC_API_KEY in your .env file."
    );
    process.exit(1);
  }

  if (!hasGeminiIntegration && !hasGeminiKey) {
    console.error(
      "ERROR: Gemini API key not configured.\n" +
        "  On Replit: enable the Gemini AI Integration in the integrations panel.\n" +
        "  Locally: set GEMINI_API_KEY in your .env file.\n" +
        "  Get a key at https://aistudio.google.com/app/apikey"
    );
    process.exit(1);
  }
}

export const IMAGE_MODEL = "gemini-2.5-flash-image";
export const TEXT_MODEL = "claude-sonnet-4-5";
