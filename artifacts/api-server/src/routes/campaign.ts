import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { campaignWorkflow } from "../workflow/campaignWorkflow.js";
import { CampaignBriefSchema } from "../schemas/campaignBrief.js";
import { progressBus, type ProgressEvent } from "../progress-bus.js";
import { logStep, logStepError } from "../campaign-logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");
const OUTPUT_DIR = path.resolve(ROOT_DIR, "output");

const router = Router();

router.post("/generate", async (req, res) => {
  const runId = crypto.randomUUID();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const progressHandler = (event: ProgressEvent) => {
    if (event.runId === runId) {
      send({ type: "progress", ...event });
    }
  };

  progressBus.on("progress", progressHandler);

  const cleanup = () => {
    progressBus.off("progress", progressHandler);
  };

  req.on("close", cleanup);

  try {
    const briefData = CampaignBriefSchema.parse(req.body);

    logStep("campaign-route", "Starting workflow run", {
      runId,
      clientName: briefData.clientName,
    });

    send({ type: "started", runId, message: "Pipeline started" });

    const run = campaignWorkflow.createRun();
    const result = await run.start({
      inputData: {
        runId,
        input: "",
        isFilePath: false,
        briefData,
      },
    });

    cleanup();

    if (result.error) {
      send({ type: "error", runId, error: result.error });
      res.end();
      return;
    }

    const finalResult = result.results as any;
    send({
      type: "complete",
      runId,
      manifest: finalResult.manifest,
      complianceReport: finalResult.complianceReport,
    });

    logStep("campaign-route", "Workflow completed", { runId });
  } catch (err) {
    cleanup();
    logStepError("campaign-route", err, { runId });
    send({ type: "error", runId, error: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
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
