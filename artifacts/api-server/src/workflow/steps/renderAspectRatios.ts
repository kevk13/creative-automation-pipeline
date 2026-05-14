import fs from "fs";
import path from "path";
import sharp from "sharp";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { slugify } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";

export const ASPECT_RATIOS = {
  "1x1": { width: 1080, height: 1080 },
  "9x16": { width: 1080, height: 1920 },
  "16x9": { width: 1920, height: 1080 },
} as const;

export type AspectRatio = keyof typeof ASPECT_RATIOS;

const RenderInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  assets: z.record(z.string(), z.string()),
  outputDir: z.string(),
});

const RenderOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  outputDir: z.string(),
});

export const renderAspectRatiosStep = createStep({
  id: "renderAspectRatios",
  description: "Render each asset into 1:1, 9:16, and 16:9 aspect ratios using Sharp",
  inputSchema: RenderInputSchema,
  outputSchema: RenderOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, assets, outputDir } = inputData;
    const renders: Record<string, Record<string, string>> = {};

    emitProgress({ runId, step: "renderAspectRatios", status: "running", message: "Rendering aspect ratios..." });

    for (const [productName, assetPath] of Object.entries(assets)) {
      const productSlug = slugify(productName);
      renders[productName] = {};

      for (const [ratio, dims] of Object.entries(ASPECT_RATIOS)) {
        try {
          const ratioDir = path.resolve(outputDir, productSlug, ratio);
          fs.mkdirSync(ratioDir, { recursive: true });
          const outPath = path.resolve(ratioDir, "base.png");

          await sharp(assetPath)
            .resize(dims.width, dims.height, {
              fit: "cover",
              position: "centre",
            })
            .png()
            .toFile(outPath);

          renders[productName][ratio] = outPath;

          logStep("renderAspectRatios", `Rendered ${productName} ${ratio}`, {
            width: dims.width,
            height: dims.height,
            path: outPath,
          });
        } catch (err) {
          logStepError("renderAspectRatios", err, { productName, ratio });
          throw err;
        }
      }
    }

    emitProgress({ runId, step: "renderAspectRatios", status: "complete", message: "All aspect ratios rendered" });

    return { runId, brief, renders, outputDir };
  },
});
