import { GoogleGenAI } from "@google/genai";

const apiKey =
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY;

const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

if (!apiKey) {
  throw new Error(
    "Gemini API key not configured.\n" +
      "  On Replit: enable the Gemini AI Integration in the integrations panel.\n" +
      "  Locally: set GEMINI_API_KEY in your .env file.\n" +
      "  Get a key at https://aistudio.google.com/app/apikey"
  );
}

export const ai = new GoogleGenAI({
  apiKey,
  ...(baseUrl
    ? { httpOptions: { apiVersion: "", baseUrl } }
    : {}),
});
