import fs from "fs";
import path from "path";
import sharp from "sharp";
import { logStep } from "../campaign-logger.js";

export type LoadAssetResult =
  | { success: true; assetPath: string }
  | { success: false; reason: string };

/**
 * Loads an existing asset from a local file path or a URL.
 * The result is always converted to PNG via Sharp so every downstream
 * step can treat all sources identically regardless of original format.
 */
export async function loadExistingAsset(
  existingAssetPath: string,
  outputDir: string,
  productSlug: string
): Promise<LoadAssetResult> {
  const isUrl =
    existingAssetPath.startsWith("http://") ||
    existingAssetPath.startsWith("https://");

  return isUrl
    ? loadFromUrl(existingAssetPath, outputDir, productSlug)
    : loadFromFile(existingAssetPath, outputDir, productSlug);
}

async function saveAsset(
  buffer: Buffer,
  outputDir: string,
  productSlug: string
): Promise<string> {
  const reuseDir = path.resolve(outputDir, "reused");
  fs.mkdirSync(reuseDir, { recursive: true });
  const assetPath = path.resolve(reuseDir, `${productSlug}.png`);
  await sharp(buffer).png().toFile(assetPath);
  return assetPath;
}

async function loadFromUrl(
  url: string,
  outputDir: string,
  productSlug: string
): Promise<LoadAssetResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return { success: false, reason: `HTTP ${res.status} fetching ${url}` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const assetPath = await saveAsset(buffer, outputDir, productSlug);
    logStep("loadExistingAsset", "Asset loaded from URL", { url, assetPath });
    return { success: true, assetPath };
  } catch (err) {
    return {
      success: false,
      reason: `URL fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function loadFromFile(
  filePath: string,
  outputDir: string,
  productSlug: string
): Promise<LoadAssetResult> {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return { success: false, reason: `File not found: ${absolutePath}` };
  }
  try {
    const buffer = fs.readFileSync(absolutePath);
    const assetPath = await saveAsset(buffer, outputDir, productSlug);
    logStep("loadExistingAsset", "Asset loaded from local file", {
      source: absolutePath,
      assetPath,
    });
    return { success: true, assetPath };
  } catch (err) {
    return {
      success: false,
      reason: `File read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
