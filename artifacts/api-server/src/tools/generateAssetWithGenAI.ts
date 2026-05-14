import fs from "fs";
import path from "path";
import { createAnthropicClient, createOpenAIClient, IMAGE_MODEL, TEXT_MODEL } from "../lib/ai-clients.js";
import { calcClaudeCost, calcImageCost, logStep } from "../campaign-logger.js";
import type { Product, CampaignBrief } from "../schemas/campaignBrief.js";
import { slugify } from "../schemas/campaignBrief.js";

export type GenerateAssetResult = {
  productSlug: string;
  assetPath: string;
  method: "gpt-image-1" | "dalle-3";
  cost: number;
};

export async function generateAssetWithGenAI(
  product: Product,
  brief: Pick<CampaignBrief, "clientName" | "targetAudience" | "brandPalette">,
  outputDir: string
): Promise<GenerateAssetResult> {
  const anthropic = createAnthropicClient();
  const openai = createOpenAIClient();

  const productSlug = slugify(product.productName);
  const generatedDir = path.resolve(outputDir, "generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const assetPath = path.resolve(generatedDir, `${productSlug}.png`);

  const promptMessages = [
    {
      role: "user" as const,
      content: `Create a detailed DALL-E image generation prompt for this product:

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
  ];

  const promptResponse = await anthropic.messages.create({
    model: TEXT_MODEL,
    max_tokens: 512,
    messages: promptMessages,
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

  const imagePrompt =
    promptResponse.content[0].type === "text" ? promptResponse.content[0].text : "";

  const imageResponse = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt: imagePrompt,
    size: "1024x1024",
    n: 1,
  });

  const imageCost = calcImageCost(1);
  logStep("generateAssetWithGenAI", "Image generated", {
    product: product.productName,
    imageCount: 1,
    costUSD: imageCost,
    model: IMAGE_MODEL,
  });

  const imageData = imageResponse.data?.[0];
  if (!imageData) throw new Error("No image data returned from OpenAI");

  let imageBuffer: Buffer;

  if (imageData.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, "base64");
  } else if (imageData.url) {
    const imageRes = await fetch(imageData.url);
    imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  } else {
    throw new Error("No image data returned from OpenAI");
  }

  fs.writeFileSync(assetPath, imageBuffer);

  return {
    productSlug,
    assetPath,
    method: "gpt-image-1",
    cost: claudeCost + imageCost,
  };
}
