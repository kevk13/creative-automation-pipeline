import fs from "fs";
import path from "path";

export type CheckLocalAssetResult = {
  exists: boolean;
  absolutePath: string | null;
};

export function checkLocalAsset(localAssetPath: string | undefined): CheckLocalAssetResult {
  if (!localAssetPath) {
    return { exists: false, absolutePath: null };
  }

  try {
    const absolutePath = path.resolve(localAssetPath);
    const exists = fs.existsSync(absolutePath);
    return { exists, absolutePath: exists ? absolutePath : null };
  } catch {
    return { exists: false, absolutePath: null };
  }
}
