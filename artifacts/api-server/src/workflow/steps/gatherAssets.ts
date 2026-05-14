import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { runAssetGathererAgent } from "../../agents/assetGatherer.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";
import { OUTPUT_DIR } from "../../lib/paths.js";

const GatherAssetsInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
});

const GatherAssetsOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  assets: z.record(z.string(), z.string()),
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

    emitProgress({ runId, step: "gatherAssets", status: "running", message: `Generating assets for ${brief.products.length} products...` });

    try {
      logStep("gatherAssets", "Starting asset gathering", {
        products: brief.products.map((p) => p.productName),
      });

      const assets = await runAssetGathererAgent(brief, outputDir);

      logStep("gatherAssets", "All assets gathered", { assets });
      emitProgress({ runId, step: "gatherAssets", status: "complete", message: "All product images ready" });

      return { runId, brief, assets, outputDir };
    } catch (err) {
      logStepError("gatherAssets", err);
      emitProgress({ runId, step: "gatherAssets", status: "error", error: String(err) });
      throw err;
    }
  },
});
