import fs from "fs";
import path from "path";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { slugify } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";

export type ManifestEntry = {
  productName: string;
  productSlug: string;
  aspectRatio: string;
  filePath: string;
  fileSize: number;
  generationTimestamp: string;
  generationMethod: "local" | "gpt-image-1" | "dalle-3";
};

export type OutputManifest = {
  generatedAt: string;
  entries: ManifestEntry[];
};

const OrganizeInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  outputDir: z.string(),
});

const OrganizeOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  manifest: z.any(),
  outputDir: z.string(),
});

export const organizeOutputsStep = createStep({
  id: "organizeOutputs",
  description: "Verify output structure and write manifest.json",
  inputSchema: OrganizeInputSchema,
  outputSchema: OrganizeOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, renders, outputDir } = inputData;
    const timestamp = new Date().toISOString();
    const entries: ManifestEntry[] = [];

    emitProgress({ runId, step: "organizeOutputs", status: "running", message: "Organizing outputs and writing manifest..." });

    try {
      for (const [productName, ratioMap] of Object.entries(renders)) {
        const productSlug = slugify(productName);

        for (const [ratio, finalPath] of Object.entries(ratioMap)) {
          const exists = fs.existsSync(finalPath);
          if (!exists) {
            throw new Error(`Expected file missing: ${finalPath}`);
          }

          const stat = fs.statSync(finalPath);
          const generatedDir = path.resolve(outputDir, "generated");
          const generatedAsset = path.resolve(generatedDir, `${productSlug}.png`);
          const method: ManifestEntry["generationMethod"] = fs.existsSync(generatedAsset)
            ? "gpt-image-1"
            : "local";

          entries.push({
            productName,
            productSlug,
            aspectRatio: ratio,
            filePath: finalPath,
            fileSize: stat.size,
            generationTimestamp: timestamp,
            generationMethod: method,
          });
        }
      }

      const manifest: OutputManifest = { generatedAt: timestamp, entries };
      const manifestPath = path.resolve(outputDir, "manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      logStep("organizeOutputs", "Manifest written", {
        manifestPath,
        totalFiles: entries.length,
      });

      emitProgress({ runId, step: "organizeOutputs", status: "complete", message: `Manifest written — ${entries.length} files` });

      return { runId, brief, renders, manifest, outputDir };
    } catch (err) {
      logStepError("organizeOutputs", err);
      emitProgress({ runId, step: "organizeOutputs", status: "error", error: String(err) });
      throw err;
    }
  },
});
