import { checkLocalAsset } from "../tools/checkLocalAsset.js";
import { generateAssetWithGenAI } from "../tools/generateAssetWithGenAI.js";
import { logStep, logStepError } from "../campaign-logger.js";
import type { CampaignBrief } from "../schemas/campaignBrief.js";

export type AssetMap = Record<string, string>;

/**
 * Asset Gatherer Agent
 * System: "You are a creative asset coordinator. For each product, first check if a
 * local asset exists. If yes, use it. If no, generate a detailed image generation
 * prompt that captures the product, brand aesthetic, and target audience. Then call
 * the image generator tool to produce the asset."
 */
export async function runAssetGathererAgent(
  brief: CampaignBrief,
  outputDir: string
): Promise<AssetMap> {
  const assetMap: AssetMap = {};

  for (const product of brief.products) {
    try {
      logStep("assetGatherer", `Processing product: ${product.productName}`);

      const localCheck = checkLocalAsset(product.localAssetPath);

      if (localCheck.exists && localCheck.absolutePath) {
        logStep("assetGatherer", `Using local asset for ${product.productName}`, {
          path: localCheck.absolutePath,
        });
        assetMap[product.productName] = localCheck.absolutePath;
      } else {
        logStep("assetGatherer", `Generating asset for ${product.productName} via GenAI`);
        const result = await generateAssetWithGenAI(
          product,
          {
            clientName: brief.clientName,
            targetAudience: brief.targetAudience,
            brandPalette: brief.brandPalette,
          },
          outputDir
        );
        assetMap[product.productName] = result.assetPath;
        logStep("assetGatherer", `Asset generated`, {
          product: product.productName,
          path: result.assetPath,
          method: result.method,
          costUSD: result.cost,
        });
      }
    } catch (err) {
      logStepError("assetGatherer", err, { product: product.productName });
      throw err;
    }
  }

  return assetMap;
}
