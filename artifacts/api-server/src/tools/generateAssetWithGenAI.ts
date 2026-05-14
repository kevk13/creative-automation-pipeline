import fs from "fs";
import path from "path";
import { generateImage } from "@workspace/integrations-gemini-ai/image";
import { createAnthropicClient, TEXT_MODEL } from "../lib/ai-clients.js";
import { calcClaudeCost, logStep } from "../campaign-logger.js";
import { withRetry } from "../lib/retry.js";
import { recordCost } from "../lib/runStore.js";
import type { Product, CampaignBrief } from "../schemas/campaignBrief.js";
import { slugify } from "../schemas/campaignBrief.js";

export type GenerateAssetResult = {
  productSlug: string;
  assetPath: string;
  method: "gemini-2.5-flash-image";
  cost: number;
};

export async function generateAssetWithGenAI(
  product: Product,
  brief: Pick<CampaignBrief, "clientName" | "targetAudience" | "brandPalette">,
  outputDir: string,
  runId?: string
): Promise<GenerateAssetResult> {
  const anthropic = createAnthropicClient();

  const productSlug = slugify(product.productName);
  const generatedDir = path.resolve(outputDir, "generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const assetPath = path.resolve(generatedDir, `${productSlug}.png`);

  // ── Step 1: Claude crafts the image prompt ──────────────────────────────────
  const promptResponse = await anthropic.messages.create({
    model: TEXT_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Create a detailed image generation prompt for this product:

Product: ${product.productName}
Description: ${product.productDescription}
Brand: ${brief.clientName}
Target audience: ${brief.targetAudience}
Brand palette: ${brief.brandPalette?.join(", ") || "neutral tones"}

Requirements:
- Premium, minimalist aesthetic
- Clean studio photography style
- Product should be the focal point
- Lighting should enhance the product's quality
- Background should be clean and on-brand
- Suitable for social media advertising

Return ONLY the image generation prompt, nothing else.`,
      },
    ],
  });

  const claudeCost = calcClaudeCost(
    promptResponse.usage.input_tokens,
    promptResponse.usage.output_tokens
  );

  logStep("generateAssetWithGenAI", "Claude prompt crafted", {
    product: product.productName,
    inputTokens: promptResponse.usage.input_tokens,
    outputTokens: promptResponse.usage.output_tokens,
    costUSD: claudeCost,
    model: TEXT_MODEL,
  });

  if (runId) {
    recordCost(runId, {
      tool: "generateAssetWithGenAI",
      model: TEXT_MODEL,
      step: "gatherAssets",
      product: product.productName,
      inputTokens: promptResponse.usage.input_tokens,
      outputTokens: promptResponse.usage.output_tokens,
      costUSD: claudeCost,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Step 2: Gemini generates the image ─────────────────────────────────────
  const imagePrompt =
    promptResponse.content[0].type === "text" ? promptResponse.content[0].text : "";

  const { b64_json } = await withRetry(
    () => generateImage(imagePrompt),
    {
      maxAttempts: 4,
      baseDelayMs: 1000,
      jitterFactor: 0.2,
      agentName: "image_generator",
      context: {
        productName: product.productName,
        model: "gemini-2.5-flash-image",
      },
    }
  );

  logStep("generateAssetWithGenAI", "Image generated", {
    product: product.productName,
    imageCount: 1,
    costUSD: 0,
    model: "gemini-2.5-flash-image",
  });

  if (runId) {
    recordCost(runId, {
      tool: "geminiImageGeneration",
      model: "gemini-2.5-flash-image",
      step: "gatherAssets",
      product: product.productName,
      costUSD: 0,
      timestamp: new Date().toISOString(),
    });
  }

  fs.writeFileSync(assetPath, Buffer.from(b64_json, "base64"));

  return {
    productSlug,
    assetPath,
    method: "gemini-2.5-flash-image",
    cost: claudeCost,
  };
}
