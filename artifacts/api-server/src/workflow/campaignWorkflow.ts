import { z } from "zod";
import { createWorkflow } from "./mastra-compat.js";
import { CampaignBriefSchema } from "../schemas/campaignBrief.js";
import { loadBriefStep } from "./steps/loadBrief.js";
import { gatherAssetsStep } from "./steps/gatherAssets.js";
import { renderAspectRatiosStep } from "./steps/renderAspectRatios.js";
import { applyOverlayStep } from "./steps/applyOverlay.js";
import { organizeOutputsStep } from "./steps/organizeOutputs.js";
import { checkComplianceStep } from "./steps/checkCompliance.js";

export const CampaignWorkflowInputSchema = z.object({
  runId: z.string(),
  input: z.string().default(""),
  isFilePath: z.boolean().default(false),
  briefData: CampaignBriefSchema.optional(),
});

export type CampaignWorkflowInput = z.infer<typeof CampaignWorkflowInputSchema>;

/**
 * Campaign Workflow — 6 sequential steps:
 * 1. loadBrief       — parse & validate YAML/JSON campaign brief
 * 2. gatherAssets    — agent: check local assets or generate via GenAI
 * 3. renderAspectRatios — Sharp: resize to 1:1, 9:16, 16:9
 * 4. applyOverlay    — Sharp: SVG campaign message overlay
 * 5. organizeOutputs — verify file structure, write manifest.json
 * 6. checkCompliance — agent: color check, logo check, legal word scan
 */
export const campaignWorkflow = createWorkflow({
  id: "campaignWorkflow",
  inputSchema: CampaignWorkflowInputSchema,
})
  .then(loadBriefStep)
  .then(gatherAssetsStep)
  .then(renderAspectRatiosStep)
  .then(applyOverlayStep)
  .then(organizeOutputsStep)
  .then(checkComplianceStep)
  .commit();
