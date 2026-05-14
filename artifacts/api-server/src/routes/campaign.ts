import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { campaignWorkflow } from "../workflow/campaignWorkflow.js";
import { CampaignBriefSchema } from "../schemas/campaignBrief.js";
import { progressBus, type ProgressEvent } from "../progress-bus.js";
import { logStep, logStepError } from "../campaign-logger.js";
import { OUTPUT_DIR, BRIEFS_DIR } from "../lib/paths.js";
import { createRun, getRun, updateRunStep, completeRun, errorRun } from "../lib/runStore.js";

const router = Router();

progressBus.on("progress", (event: ProgressEvent) => {
  updateRunStep(event.runId, event.step, event.status, event.message);
});

router.get("/samples", (_req, res) => {
  try {
    const files = fs.readdirSync(BRIEFS_DIR).filter((f) =>
      f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json")
    );
    res.json({ samples: files });
  } catch {
    res.json({ samples: [] });
  }
});

router.get("/samples/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename ?? "");
    const filePath = path.resolve(BRIEFS_DIR, filename);
    if (!filePath.startsWith(BRIEFS_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ext = path.extname(filename).slice(1);
    const contentType = ext === "json" ? "application/json" : "text/yaml";
    res.setHeader("Content-Type", contentType);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const briefData = CampaignBriefSchema.parse(req.body);
    const runId = crypto.randomUUID();
    createRun(runId);

    logStep("campaign-route", "Starting workflow run", {
      runId,
      clientName: briefData.clientName,
    });

    (async () => {
      try {
        const run = campaignWorkflow.createRun();
        const result = await run.start({
          inputData: { runId, input: "", isFilePath: false, briefData },
        });

        if (result.error) {
          errorRun(runId, result.error);
          logStepError("campaign-route", new Error(result.error), { runId });
          return;
        }

        const finalResult = result.results as any;
        completeRun(runId, finalResult.manifest, finalResult.complianceReport);
        logStep("campaign-route", "Workflow completed", { runId });
      } catch (err) {
        errorRun(runId, err instanceof Error ? err.message : String(err));
        logStepError("campaign-route", err, { runId });
      }
    })();

    res.json({ runId });
  } catch (err) {
    logStepError("campaign-route", err, {});
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/run/:runId/status", (req, res) => {
  const state = getRun(req.params.runId);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(state);
});

router.get("/manifest", (_req, res) => {
  try {
    const manifestPath = path.resolve(OUTPUT_DIR, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      res.status(404).json({ error: "No manifest found. Run the pipeline first." });
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/compliance", (_req, res) => {
  try {
    const compliancePath = path.resolve(OUTPUT_DIR, "compliance.json");
    if (!fs.existsSync(compliancePath)) {
      res.status(404).json({ error: "No compliance report found. Run the pipeline first." });
      return;
    }
    const report = JSON.parse(fs.readFileSync(compliancePath, "utf-8"));
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/output/:productSlug/:ratio/final.png", (req, res) => {
  try {
    const { productSlug, ratio } = req.params;
    const imagePath = path.resolve(OUTPUT_DIR, productSlug, ratio, "final.png");

    if (!imagePath.startsWith(OUTPUT_DIR)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!fs.existsSync(imagePath)) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    fs.createReadStream(imagePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/upload-logo", (req, res) => {
  try {
    const { data } = req.body as { data?: string };
    if (!data) {
      res.status(400).json({ error: "Missing base64 image data" });
      return;
    }

    const logoDir = path.resolve(OUTPUT_DIR, "logos");
    fs.mkdirSync(logoDir, { recursive: true });
    const logoPath = path.resolve(logoDir, "logo.png");

    const base64 = data.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(logoPath, Buffer.from(base64, "base64"));

    logStep("upload-logo", "Logo saved", { path: logoPath });
    res.json({ logoPath });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
