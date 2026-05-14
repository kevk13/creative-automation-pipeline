import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { runAssetGathererAgent } from "../../agents/assetGatherer.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";
import { OUTPUT_DIR } from "../../lib/paths.js";

const AssetSourceEnum = z.enum(["reused", "generated", "fallback_to_generated"]);

const GatherAssetsInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
});

const GatherAssetsOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  assets: z.record(z.string(), z.string()),
  assetSources: z.record(z.string(), AssetSourceEnum),
  outputDir: z.string(),
});

export const gatherAssetsStep = createStep({
  id: "gatherAssets",
  description: "Gather or generate image assets for each product using the AssetGatherer agent",
  inputSchema: GatherAssetsInputSchema,
  outputSchema: GatherAssetsOutputSchema,
  async execute({ inputData }) {
    const { runId, brief } = inputData;
    const outputDir = OUTPUT_DIR;

    emitProgress({
      runId,
      step: "gatherAssets",
      status: "running",
      message: `Gathering assets for ${brief.products.length} products...`,
    });

    try {
      logStep("gatherAssets", "Starting asset gathering", {
        products: brief.products.map((p) => p.productName),
      });

      const { assets, assetSources } = await runAssetGathererAgent(brief, outputDir, runId);

      logStep("gatherAssets", "All assets gathered", { assets, assetSources });
      emitProgress({
        runId,
        step: "gatherAssets",
        status: "complete",
        message: "All product images ready",
      });

      return { runId, brief, assets, assetSources, outputDir };
    } catch (err) {
      logStepError("gatherAssets", err);
      emitProgress({ runId, step: "gatherAssets", status: "error", error: String(err) });
      throw err;
    }
  },
});
