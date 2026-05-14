import { logStep } from "../../campaign-logger.js";
import { LocalStorageAdapter } from "./LocalStorageAdapter.js";
import { DropboxStorageAdapter } from "./DropboxStorageAdapter.js";
import type { StorageAdapter } from "./StorageAdapter.js";

export type { StorageAdapter, SaveResult } from "./StorageAdapter.js";
export { LocalStorageAdapter } from "./LocalStorageAdapter.js";
export { DropboxStorageAdapter } from "./DropboxStorageAdapter.js";

/**
 * Factory — reads STORAGE_ADAPTER env var (default "local") and returns the
 * appropriate adapter.
 *
 * Implemented:  local, dropbox
 * Scaffolded:   s3, azure (throw NotImplementedError with clear guidance)
 *
 * Call once per pipeline run so that adapter selection is logged at run start.
 */
export function getStorageAdapter(): StorageAdapter {
  const selected = (process.env.STORAGE_ADAPTER ?? "local").toLowerCase().trim();

  switch (selected) {
    case "local": {
      const adapter = new LocalStorageAdapter();
      logStep("storageAdapter", "Storage adapter selected", {
        adapter: adapter.adapterName,
        reason: "STORAGE_ADAPTER=local (or unset)",
      });
      return adapter;
    }

    case "dropbox": {
      // DropboxStorageAdapter constructor throws if DROPBOX_ACCESS_TOKEN is absent
      const adapter = new DropboxStorageAdapter();
      logStep("storageAdapter", "Storage adapter selected", {
        adapter: adapter.adapterName,
        reason: "STORAGE_ADAPTER=dropbox",
        note: "Assets will be uploaded to Dropbox and shared links returned",
      });
      return adapter;
    }

    case "s3":
    case "azure":
      throw new Error(
        `Storage adapter "${selected}" is scaffolded but not yet implemented. ` +
          "Implemented: local, dropbox. Scaffolded for future: s3, azure. " +
          "Set STORAGE_ADAPTER=local or STORAGE_ADAPTER=dropbox."
      );

    default:
      throw new Error(
        `Unknown storage adapter "${selected}". ` +
          "Supported values: local, dropbox."
      );
  }
}
