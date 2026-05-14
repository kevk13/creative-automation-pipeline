import fs from "fs";
import path from "path";
import sharp from "sharp";
import { z } from "zod";
import { createStep } from "../mastra-compat.js";
import { CampaignBriefSchema } from "../../schemas/campaignBrief.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import { emitProgress } from "../../progress-bus.js";
import { ASPECT_RATIOS, type AspectRatio } from "./renderAspectRatios.js";

const AssetSourceEnum = z.enum(["reused", "generated", "fallback_to_generated"]);

const OverlayInputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  assetSources: z.record(z.string(), AssetSourceEnum),
  outputDir: z.string(),
});

const OverlayOutputSchema = z.object({
  runId: z.string(),
  brief: CampaignBriefSchema,
  renders: z.record(z.string(), z.record(z.string(), z.string())),
  assetSources: z.record(z.string(), AssetSourceEnum),
  outputDir: z.string(),
});

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wraps text into lines that fit within maxLineWidth.
 *
 * Words too long to fit on a single line are hard-broken into character-sized
 * chunks so they never overflow the canvas horizontally.
 */
function wrapWords(message: string, maxLineWidth: number, charWidth: number): string[] {
  const maxCharsPerLine = Math.floor(maxLineWidth / charWidth);

  // Pre-process: split oversized words into hard-break chunks
  const tokens: string[] = [];
  for (const word of message.split(/\s+/).filter(Boolean)) {
    if (word.length <= maxCharsPerLine) {
      tokens.push(word);
    } else {
      for (let i = 0; i < word.length; i += maxCharsPerLine) {
        tokens.push(word.slice(i, i + maxCharsPerLine));
      }
    }
  }

  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (candidate.length * charWidth > maxLineWidth && current) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Builds the SVG overlay buffer.
 *
 * Font-size is scaled down in 10 % steps until the full text block fits
 * within 40 % of the canvas height. A <clipPath> scoped to the bar rect
 * acts as a hard safety net so nothing can visually escape the bar even
 * if float-rounding pushes a glyph slightly over the boundary.
 */
function buildSvgOverlay(width: number, height: number, message: string): Buffer {
  // charWidth uses 0.62× rather than 0.56× to account for capital-heavy text
  // and wide characters (W, M, %, @) that render wider than the average glyph.
  const CHAR_WIDTH_RATIO = 0.62;
  const LINE_WIDTH_RATIO = 0.88;
  const MAX_BAR_RATIO    = 0.40;
  const MIN_FONT_SIZE    = 12;

  const maxBarHeight = Math.round(height * MAX_BAR_RATIO);

  let fontSize   = Math.round(width * 0.055);
  let lines: string[] = [];
  let lineHeight = 0;
  let barHeight  = 0;
  let vertPad    = 0;

  // Scale font down until the text block fits inside maxBarHeight
  while (true) {
    lineHeight = Math.round(fontSize * 1.3);
    vertPad    = Math.round(fontSize * 0.7);
    const charWidth    = fontSize * CHAR_WIDTH_RATIO;
    const maxLineWidth = width * LINE_WIDTH_RATIO;

    lines     = wrapWords(message, maxLineWidth, charWidth);
    barHeight = Math.max(
      Math.round(height * 0.15),
      lines.length * lineHeight + vertPad * 2
    );

    if (barHeight <= maxBarHeight || fontSize <= MIN_FONT_SIZE) break;
    fontSize = Math.max(MIN_FONT_SIZE, Math.round(fontSize * 0.9));
  }

  // Clamp barHeight to the ceiling after the final iteration
  barHeight = Math.min(barHeight, maxBarHeight);

  const numLines = lines.length;
  const barY     = height - barHeight;
  const blockTop =
    barY +
    Math.round((barHeight - numLines * lineHeight) / 2) +
    Math.round(lineHeight * 0.75);

  const textEls = lines
    .map(
      (line, i) =>
        `<text
      x="${width / 2}"
      y="${blockTop + i * lineHeight}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${fontSize}"
      font-weight="600"
      fill="white"
      text-anchor="middle"
      letter-spacing="1"
      clip-path="url(#bar-clip)"
    >${escapeXml(line)}</text>`
    )
    .join("\n");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="bar-clip">
        <rect x="0" y="${barY}" width="${width}" height="${barHeight}" />
      </clipPath>
    </defs>
    <rect x="0" y="${barY}" width="${width}" height="${barHeight}" fill="rgba(0,0,0,0.55)" />
    ${textEls}
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
    const { runId, brief, renders, assetSources, outputDir } = inputData;
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

    return { runId, brief, renders: updatedRenders, assetSources, outputDir };
  },
});
