import { checkLocalAsset } from "../tools/checkLocalAsset.js";
import { generateAssetWithGenAI } from "../tools/generateAssetWithGenAI.js";
import { loadExistingAsset } from "../tools/loadExistingAsset.js";
import { logStep, logStepError } from "../campaign-logger.js";
import { slugify } from "../schemas/campaignBrief.js";
import type { CampaignBrief } from "../schemas/campaignBrief.js";

export type AssetMap = Record<string, string>;

/** How each asset was sourced for the run. Carried through the workflow so
 *  organizeOutputs can stamp generationMethod on the manifest without
 *  inspecting the filesystem. */
export type AssetSource = "reused" | "generated" | "fallback_to_generated";
export type AssetSourceMap = Record<string, AssetSource>;

/**
 * Asset Gatherer Agent
 *
 * For each product:
 *  1. If existingAssetPath is set → try to load it (local or URL)
 *     - success  → use it, decision = "reused"
 *     - failure  → log warning, fall back to generation, decision = "fallback_to_generated"
 *  2. If existingAssetPath is absent → check legacy localAssetPath,
 *     then generate via Gemini, decision = "generated"
 */
export async function runAssetGathererAgent(
  brief: CampaignBrief,
  outputDir: string
): Promise<{ assets: AssetMap; assetSources: AssetSourceMap }> {
  const assetMap: AssetMap = {};
  const assetSources: AssetSourceMap = {};

  for (const product of brief.products) {
    try {
      logStep("assetGatherer", `Processing product: ${product.productName}`);

      const productSlug = slugify(product.productName);

      // ── Path 1: existingAssetPath (new unified reuse field) ──────────────
      if (product.existingAssetPath) {
        const result = await loadExistingAsset(
          product.existingAssetPath,
          outputDir,
          productSlug
        );

        if (result.success) {
          logStep("image_generator", "Asset decision", {
            operation: "asset_decision",
            product: product.productName,
            decision: "reused",
            assetPath: product.existingAssetPath,
            reason: "asset_provided_and_loaded",
            timestamp: new Date().toISOString(),
          });
          assetMap[product.productName] = result.assetPath;
          assetSources[product.productName] = "reused";
          continue;
        }

        // Asset load failed — warn and fall through to generation
        logStep("image_generator", "Asset decision — fallback to generation", {
          operation: "asset_decision",
          product: product.productName,
          decision: "fallback_to_generated",
          assetPath: product.existingAssetPath,
          reason: "asset_load_failed",
          failureDetail: result.reason,
          timestamp: new Date().toISOString(),
        });
        logStepError("assetGatherer", new Error(result.reason), {
          product: product.productName,
          existingAssetPath: product.existingAssetPath,
        });
        // intentional fall-through to generation below
      } else {
        // ── Path 2: no existingAssetPath — log the generate decision ────────
        logStep("image_generator", "Asset decision", {
          operation: "asset_decision",
          product: product.productName,
          decision: "generated",
          assetPath: null,
          reason: "no_asset_provided",
          timestamp: new Date().toISOString(),
        });

        // Legacy localAssetPath support (backward-compatible)
        const localCheck = checkLocalAsset(product.localAssetPath);
        if (localCheck.exists && localCheck.absolutePath) {
          logStep("assetGatherer", `Using legacy localAssetPath for ${product.productName}`, {
            path: localCheck.absolutePath,
          });
          assetMap[product.productName] = localCheck.absolutePath;
          assetSources[product.productName] = "reused";
          continue;
        }
      }

      // ── Generation path (new or fallback) ────────────────────────────────
      logStep("assetGatherer", `Generating asset for ${product.productName} via Gemini`);
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
      assetSources[product.productName] = product.existingAssetPath
        ? "fallback_to_generated"
        : "generated";
      logStep("assetGatherer", "Asset generated", {
        product: product.productName,
        path: result.assetPath,
        method: result.method,
        costUSD: result.cost,
      });
    } catch (err) {
      logStepError("assetGatherer", err, { product: product.productName });
      throw err;
    }
  }

  return { assets: assetMap, assetSources };
}
