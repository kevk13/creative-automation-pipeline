import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

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

function getOpenAIApiKey(): string {
  return (
    process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ||
    process.env["OPENAI_API_KEY"] ||
    "not-configured"
  );
}

function getOpenAIBaseUrl(): string | undefined {
  return process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] || undefined;
}

export function createAnthropicClient(): Anthropic {
  const baseURL = getAnthropicBaseUrl();
  return new Anthropic({
    apiKey: getAnthropicApiKey(),
    ...(baseURL ? { baseURL } : {}),
  });
}

export function createOpenAIClient(): OpenAI {
  const baseURL = getOpenAIBaseUrl();
  return new OpenAI({
    apiKey: getOpenAIApiKey(),
    ...(baseURL ? { baseURL } : {}),
  });
}

export function validateAiClients(): void {
  const hasIntegrations =
    process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] &&
    process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];

  const hasDirectKeys =
    process.env["ANTHROPIC_API_KEY"] && process.env["OPENAI_API_KEY"];

  if (!hasIntegrations && !hasDirectKeys) {
    console.error(
      "ERROR: AI API keys not configured.\n" +
        "Set ANTHROPIC_API_KEY and OPENAI_API_KEY in .env,\n" +
        "or configure Replit AI Integrations."
    );
    process.exit(1);
  }
}

export const IMAGE_MODEL = "gemini-2.5-flash-image";
export const TEXT_MODEL = "claude-sonnet-4-5";
