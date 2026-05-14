import fs from "fs";
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

async function buildLogoComposite(
  logoPath: string,
  canvasWidth: number,
  canvasHeight: number
): Promise<sharp.OverlayOptions | null> {
  if (!fs.existsSync(logoPath)) return null;

  try {
    const logoMaxWidth = Math.round(canvasWidth * 0.18);
    const logoBuffer = await sharp(logoPath)
      .resize(logoMaxWidth, undefined, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const { width: logoW = logoMaxWidth, height: logoH = logoMaxWidth } =
      await sharp(logoBuffer).metadata();

    const padding = Math.round(canvasWidth * 0.035);
    const barHeight = Math.round(canvasHeight * 0.15);

    const left = canvasWidth - logoW - padding;
    const top = canvasHeight - barHeight - logoH - padding;

    return { input: logoBuffer, top: Math.max(0, top), left: Math.max(0, left) };
  } catch {
    return null;
  }
}

export const applyOverlayStep = createStep({
  id: "applyOverlay",
  description: "Composite campaign message + optional logo onto each rendered image",
  inputSchema: OverlayInputSchema,
  outputSchema: OverlayOutputSchema,
  async execute({ inputData }) {
    const { runId, brief, renders, outputDir } = inputData;
    const updatedRenders: Record<string, Record<string, string>> = {};
    const hasLogo = !!brief.logoPath;

    emitProgress({
      runId,
      step: "applyOverlay",
      status: "running",
      message: hasLogo
        ? "Applying campaign message and logo overlay..."
        : "Applying campaign message overlay...",
    });

    for (const [productName, ratioMap] of Object.entries(renders)) {
      updatedRenders[productName] = {};

      for (const [ratio, basePath] of Object.entries(ratioMap)) {
        try {
          const dims = ASPECT_RATIOS[ratio as AspectRatio];
          const finalPath = path.resolve(path.dirname(basePath), "final.png");
          const svgBuffer = buildSvgOverlay(dims.width, dims.height, brief.campaignMessage);

          const composites: sharp.OverlayOptions[] = [{ input: svgBuffer, top: 0, left: 0 }];

          if (brief.logoPath) {
            const logoOverlay = await buildLogoComposite(brief.logoPath, dims.width, dims.height);
            if (logoOverlay) {
              composites.push(logoOverlay);
              logStep("applyOverlay", `Logo composited: ${productName} ${ratio}`, {
                logoPath: brief.logoPath,
              });
            } else {
              logStep("applyOverlay", `Logo file not found or unreadable, skipping`, {
                logoPath: brief.logoPath,
              });
            }
          }

          await sharp(basePath).composite(composites).png().toFile(finalPath);

          updatedRenders[productName][ratio] = finalPath;

          logStep("applyOverlay", `Overlay applied: ${productName} ${ratio}`, {
            finalPath,
            message: brief.campaignMessage,
            logoIncluded: composites.length > 1,
          });
        } catch (err) {
          logStepError("applyOverlay", err, { productName, ratio });
          throw err;
        }
      }
    }

    emitProgress({
      runId,
      step: "applyOverlay",
      status: "complete",
      message: hasLogo ? "Message and logo applied to all images" : "Overlays applied to all images",
    });

    return { runId, brief, renders: updatedRenders, outputDir };
  },
});
