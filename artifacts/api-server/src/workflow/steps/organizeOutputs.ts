import fs from "fs";
import path from "path";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema, slugify } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";
import { getStorageAdapter } from "../../lib/storage/index.js";
import type { AssetSource } from "../../agents/assetGatherer.js";

export type ManifestEntry = {
  productName: string;
  productSlug: string;
  aspectRatio: string;
  filePath: string;
  fileSize: number;
  generationTimestamp: string;
  generationMethod: "reused" | "gemini-2.5-flash-image" | "fallback_to_generated";
  // Storage fields
  url: string;
  adapter: string;
  uploadStatus: "success" | "failed";
  uploadedAt: string;
  bytes: number;
  uploadError?: string;
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
  description: "Verify output structure, upload to storage adapter, and write manifest.json",
  inputSchema: OrganizeInputSchema,
  outputSchema: OrganizeOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, renders, assetSources, outputDir } = inputData;
    const timestamp = new Date().toISOString();
    const entries: ManifestEntry[] = [];

    emitProgress({
      runId,
      step: "organizeOutputs",
      status: "running",
      message: "Organizing outputs and writing manifest...",
    });

    // Instantiate the storage adapter once for this run
    const adapter = getStorageAdapter();
    const clientSlug = slugify(brief.clientName);

    logStep("organizeOutputs", "Storage adapter ready", {
      adapter: adapter.adapterName,
      clientSlug,
    });

    try {
      for (const [productName, ratioMap] of Object.entries(renders)) {
        const productSlug = slugify(productName);
        const source: AssetSource = assetSources[productName] ?? "generated";

        for (const [ratio, finalPath] of Object.entries(ratioMap)) {
          if (!fs.existsSync(finalPath)) {
            throw new Error(`Expected file missing: ${finalPath}`);
          }

          const stat = fs.statSync(finalPath);
          const uploadedAt = new Date().toISOString();

          // Cloud-style logical path (used by Dropbox + future S3/Azure)
          const cloudPath = `/outputs/${clientSlug}/${productSlug}/${ratio}/final.png`;

          let uploadResult: { url: string; bytes: number };
          let uploadStatus: "success" | "failed" = "success";
          let uploadError: string | undefined;

          try {
            const content = fs.readFileSync(finalPath);
            uploadResult = await adapter.save(cloudPath, content, { localPath: finalPath });
          } catch (err) {
            uploadStatus = "failed";
            uploadError = err instanceof Error ? err.message : String(err);
            uploadResult = { url: finalPath, bytes: stat.size };

            logStepError("organizeOutputs", err, {
              agent: "organizer",
              adapter: adapter.adapterName,
              operation: "save",
              path: cloudPath,
              status: "failed",
              errorMessage: uploadError,
              timestamp: uploadedAt,
            });
          }

          entries.push({
            productName,
            productSlug,
            aspectRatio: ratio,
            filePath: finalPath,
            fileSize: stat.size,
            generationTimestamp: timestamp,
            generationMethod: toGenerationMethod(source),
            url: uploadResult.url,
            adapter: adapter.adapterName,
            uploadStatus,
            uploadedAt,
            bytes: uploadResult.bytes,
            ...(uploadError ? { uploadError } : {}),
          });
        }
      }

      const manifest: OutputManifest = { generatedAt: timestamp, entries };
      const manifestPath = path.resolve(outputDir, "manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const successCount = entries.filter((e) => e.uploadStatus === "success").length;
      const failCount = entries.filter((e) => e.uploadStatus === "failed").length;

      logStep("organizeOutputs", "Manifest written", {
        manifestPath,
        totalFiles: entries.length,
        adapter: adapter.adapterName,
        uploadSuccess: successCount,
        uploadFailed: failCount,
      });

      emitProgress({
        runId,
        step: "organizeOutputs",
        status: "complete",
        message: `Manifest written — ${entries.length} files via ${adapter.adapterName}`,
      });

      return { runId, brief, renders, manifest, outputDir };
    } catch (err) {
      logStepError("organizeOutputs", err);
      emitProgress({ runId, step: "organizeOutputs", status: "error", error: String(err) });
      throw err;
    }
  },
});
