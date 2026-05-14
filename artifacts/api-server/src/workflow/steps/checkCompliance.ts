import fs from "fs";
import path from "path";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { runComplianceCheckerAgent } from "../../agents/complianceChecker.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";

const ComplianceInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  manifest: z.any(),
  outputDir: z.string(),
});

const ComplianceOutputSchema = z.object({
  runId: z.string(),
  manifest: z.any(),
  complianceReport: z.any(),
  outputDir: z.string(),
});

export const checkComplianceStep = createStep({
  id: "checkCompliance",
  description: "Run compliance checks: color analysis, logo presence, legal word scan",
  inputSchema: ComplianceInputSchema,
  outputSchema: ComplianceOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, renders, manifest, outputDir } = inputData;

    emitProgress({ runId, step: "checkCompliance", status: "running", message: "Running compliance checks..." });

    try {
      const complianceReport = await runComplianceCheckerAgent(brief, renders);

      const compliancePath = path.resolve(outputDir, "compliance.json");
      fs.writeFileSync(compliancePath, JSON.stringify(complianceReport, null, 2));

      logStep("checkCompliance", "Compliance report saved", {
        path: compliancePath,
        colorItems: complianceReport.colorCompliance.length,
        legalPassed: complianceReport.legalCompliance.passed,
      });

      emitProgress({ runId, step: "checkCompliance", status: "complete", message: "Compliance checks complete" });

      return { runId, manifest, complianceReport, outputDir };
    } catch (err) {
      logStepError("checkCompliance", err);
      emitProgress({ runId, step: "checkCompliance", status: "error", error: String(err) });
      throw err;
    }
  },
});
