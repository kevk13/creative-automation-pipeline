import path from "path";
import sharp from "sharp";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";
import { ASPECT_RATIOS, type AspectRatio } from "./renderAspectRatios.js";

const OverlayInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  outputDir: z.string(),
});

const OverlayOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  outputDir: z.string(),
});

function buildSvgOverlay(width: number, height: number, message: string): Buffer {
  const fontSize = Math.round(width * 0.055);
  const barHeight = Math.round(height * 0.15);
  const barY = height - barHeight;
  const textY = barY + Math.round(barHeight * 0.62);

  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${barY}" width="${width}" height="${barHeight}" fill="rgba(0,0,0,0.55)" />
    <text
      x="${width / 2}"
      y="${textY}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${fontSize}"
      font-weight="600"
      fill="white"
      text-anchor="middle"
      dominant-baseline="middle"
      letter-spacing="2"
    >${escapedMessage}</text>
  </svg>`;

  return Buffer.from(svg);
}

export const applyOverlayStep = createStep({
  id: "applyOverlay",
  description: "Composite campaign message overlay onto each rendered image",
  inputSchema: OverlayInputSchema,
  outputSchema: OverlayOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, renders, outputDir } = inputData;
    const updatedRenders: Record<string, Record<string, string>> = {};

    emitProgress({ runId, step: "applyOverlay", status: "running", message: "Applying campaign message overlay..." });

    for (const [productName, ratioMap] of Object.entries(renders)) {
      updatedRenders[productName] = {};

      for (const [ratio, basePath] of Object.entries(ratioMap)) {
        try {
          const dims = ASPECT_RATIOS[ratio as AspectRatio];
          const finalPath = path.resolve(path.dirname(basePath), "final.png");
          const svg = buildSvgOverlay(dims.width, dims.height, brief.campaignMessage);

          await sharp(basePath)
            .composite([{ input: svg, top: 0, left: 0 }])
            .png()
            .toFile(finalPath);

          updatedRenders[productName][ratio] = finalPath;

          logStep("applyOverlay", `Overlay applied: ${productName} ${ratio}`, {
            finalPath,
            message: brief.campaignMessage,
          });
        } catch (err) {
          logStepError("applyOverlay", err, { productName, ratio });
          throw err;
        }
      }
    }

    emitProgress({ runId, step: "applyOverlay", status: "complete", message: "Overlays applied to all images" });

    return { runId, brief, renders: updatedRenders, outputDir };
  },
});
