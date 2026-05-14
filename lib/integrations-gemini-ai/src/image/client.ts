import { GoogleGenAI, Modality } from "@google/genai";

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

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
