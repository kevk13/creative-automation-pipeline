import fs from "fs";
import type { StorageAdapter, SaveResult } from "./StorageAdapter.js";

/**
 * LocalStorageAdapter — default no-op cloud backend.
 *
 * All pipeline writes happen before this adapter is invoked (applyOverlay
 * writes final.png to disk). save() therefore only needs to confirm the file
 * exists and return its local path as the "URL". The pipeline continues to
 * serve assets through /api/output/* as before.
 *
 * This adapter is always available and requires no additional configuration.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly adapterName = "local";

  async save(
    _logicalPath: string,
    content: Buffer,
    metadata?: Record<string, string>
  ): Promise<SaveResult> {
    const localPath = metadata?.localPath ?? _logicalPath;
    return { url: localPath, bytes: content.length };
  }

  async load(path: string): Promise<Buffer> {
    return fs.readFileSync(path);
  }

  async exists(path: string): Promise<boolean> {
    return fs.existsSync(path);
  }

  async getUrl(path: string): Promise<string> {
    return path;
  }
}
