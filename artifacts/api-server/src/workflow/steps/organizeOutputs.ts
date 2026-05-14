import fs from "fs";
import path from "path";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { slugify } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";
import type { AssetSource } from "../../agents/assetGatherer.js";

export type ManifestEntry = {
  productName: string;
  productSlug: string;
  aspectRatio: string;
  filePath: string;
  fileSize: number;
  generationTimestamp: string;
  generationMethod: "reused" | "gemini-2.5-flash-image" | "fallback_to_generated";
};

export type OutputManifest = {
  generatedAt: string;
  entries: ManifestEntry[];
};

const AssetSourceEnum = z.enum(["reused", "generated", "fallback_to_generated"]);

const OrganizeInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  assetSources: z.record(z.string(), AssetSourceEnum),
  outputDir: z.string(),
});

const OrganizeOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  manifest: z.any(),
  outputDir: z.string(),
});

function toGenerationMethod(source: AssetSource): ManifestEntry["generationMethod"] {
  if (source === "reused") return "reused";
  if (source === "fallback_to_generated") return "fallback_to_generated";
  return "gemini-2.5-flash-image";
}

export const organizeOutputsStep = createStep({
  id: "organizeOutputs",
  description: "Verify output structure and write manifest.json",
  inputSchema: OrganizeInputSchema,
  outputSchema: OrganizeOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, renders, assetSources, outputDir } = inputData;
    const timestamp = new Date().toISOString();
    const entries: ManifestEntry[] = [];

    emitProgress({ runId, step: "organizeOutputs", status: "running", message: "Organizing outputs and writing manifest..." });

    try {
      for (const [productName, ratioMap] of Object.entries(renders)) {
        const productSlug = slugify(productName);
        const source: AssetSource = assetSources[productName] ?? "generated";

        for (const [ratio, finalPath] of Object.entries(ratioMap)) {
          if (!fs.existsSync(finalPath)) {
            throw new Error(`Expected file missing: ${finalPath}`);
          }

          const stat = fs.statSync(finalPath);

          entries.push({
            productName,
            productSlug,
            aspectRatio: ratio,
            filePath: finalPath,
            fileSize: stat.size,
            generationTimestamp: timestamp,
            generationMethod: toGenerationMethod(source),
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

      emitProgress({
        runId,
        step: "organizeOutputs",
        status: "complete",
        message: `Manifest written — ${entries.length} files`,
      });

      return { runId, brief, renders, manifest, outputDir };
    } catch (err) {
      logStepError("organizeOutputs", err);
      emitProgress({ runId, step: "organizeOutputs", status: "error", error: String(err) });
      throw err;
    }
  },
});
