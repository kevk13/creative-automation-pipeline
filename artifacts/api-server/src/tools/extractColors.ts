import sharp from "sharp";

export type ExtractColorsResult = {
  dominantColors: string[];
  paletteScore: number;
};

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);

  return Math.sqrt(
    Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2)
  );
}

export async function extractColors(
  imagePath: string,
  brandPalette: string[] = []
): Promise<ExtractColorsResult> {
  const image = sharp(imagePath);
  const { data, info } = await image
    .resize(50, 50, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const colorCounts = new Map<string, number>();
  const channels = info.channels;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;

    const hex = rgbToHex(
      Math.min(qr, 255),
      Math.min(qg, 255),
      Math.min(qb, 255)
    );
    colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
  }

  const sorted = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hex]) => hex);

  let paletteScore = 0;
  if (brandPalette.length > 0) {
    const MAX_DISTANCE = Math.sqrt(3 * 255 * 255);
    let totalScore = 0;

    for (const brandColor of brandPalette) {
      const closestDistance = Math.min(
        ...sorted.map((c) => colorDistance(c, brandColor))
      );
      totalScore += 1 - closestDistance / MAX_DISTANCE;
    }

    paletteScore = totalScore / brandPalette.length;
  }

  return { dominantColors: sorted, paletteScore };
}
