import fs from "fs";
import yaml from "js-yaml";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema, type CampaignBrief } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";

const LoadBriefInputSchema = z.object({
  runId: z.string(),
  input: z.string(),
  isFilePath: z.boolean().default(false),
  briefData: CampaignBriefSchema.optional(),
});

const LoadBriefOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
});

export const loadBriefStep = createStep({
  id: "loadBrief",
  description: "Load and validate campaign brief from YAML/JSON file or raw string",
  inputSchema: LoadBriefInputSchema,
  outputSchema: LoadBriefOutputSchema,
  async execute({ inputData }) {
    const { runId, input, isFilePath, briefData } = inputData;

    emitProgress({ runId, step: "loadBrief", status: "running", message: "Loading campaign brief..." });

    try {
      let parsed: unknown;

      if (briefData) {
        parsed = briefData;
      } else if (isFilePath) {
        const content = fs.readFileSync(input, "utf-8");
        if (input.endsWith(".yaml") || input.endsWith(".yml")) {
          parsed = yaml.load(content);
        } else {
          parsed = JSON.parse(content);
        }
      } else {
        try {
          parsed = JSON.parse(input);
        } catch {
          parsed = yaml.load(input);
        }
      }

      const brief = CampaignBriefSchema.parse(parsed) as CampaignBrief;

      logStep("loadBrief", "Brief loaded and validated", {
        clientName: brief.clientName,
        products: brief.products.length,
      });

      emitProgress({ runId, step: "loadBrief", status: "complete", message: `Brief loaded for ${brief.clientName}` });

      return { runId, brief };
    } catch (err) {
      logStepError("loadBrief", err);
      emitProgress({ runId, step: "loadBrief", status: "error", error: String(err) });
      throw err;
    }
  },
});
