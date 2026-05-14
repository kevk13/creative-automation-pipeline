import { Dropbox } from "dropbox";
import { withRetry } from "../retry.js";
import { logStep, logStepError } from "../../campaign-logger.js";
import type { StorageAdapter, SaveResult } from "./StorageAdapter.js";

/**
 * DropboxStorageAdapter
 *
 * Chosen over S3 and Azure because the customer's workflow is creative-team-led.
 * Marketing and creative teams at consumer goods companies already consume assets
 * in Dropbox-class shared storage — not in S3 consoles or Azure Blob containers.
 *
 * S3 and Azure remain scaffolded as single-class additions for engineering-side
 * observability or hybrid dual-write architectures. The chosen adapter reflects
 * user workflow, not just technical preference.
 *
 * Authentication: DROPBOX_ACCESS_TOKEN environment variable.
 * Path structure:  /outputs/{clientSlug}/{productSlug}/{ratio}/{filename}
 */
export class DropboxStorageAdapter implements StorageAdapter {
  readonly adapterName = "dropbox";
  private readonly dbx: Dropbox;

  constructor() {
    const token = process.env.DROPBOX_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "Dropbox adapter requires DROPBOX_ACCESS_TOKEN environment variable. " +
          "Generate a token at https://www.dropbox.com/developers/apps"
      );
    }
    this.dbx = new Dropbox({ accessToken: token });
  }

  // ── Public interface ────────────────────────────────────────────────────────

  async save(
    path: string,
    content: Buffer,
    _metadata?: Record<string, string>
  ): Promise<SaveResult> {
    const dropboxPath = toDropboxPath(path);
    const startTime = Date.now();

    try {
      await this.uploadWithRetry(dropboxPath, content);
      const url = await this.createOrGetSharedLink(dropboxPath);
      const latencyMs = Date.now() - startTime;

      logStep("organizer", "Dropbox upload succeeded", {
        agent: "organizer",
        adapter: "dropbox",
        operation: "save",
        path: dropboxPath,
        bytes: content.length,
        latencyMs,
        status: "success",
        url,
        timestamp: new Date().toISOString(),
      });

      return { url, bytes: content.length };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorType = classifyDropboxError(err);

      logStepError("organizer", err, {
        agent: "organizer",
        adapter: "dropbox",
        operation: "save",
        path: dropboxPath,
        status: "failed",
        errorType,
        errorMessage: errMsg,
        attemptsExhausted: 3,
        latencyMs,
        timestamp: new Date().toISOString(),
      });

      throw err;
    }
  }

  async load(path: string): Promise<Buffer> {
    const dropboxPath = toDropboxPath(path);
    const response = await this.dbx.filesDownload({ path: dropboxPath });
    const data = (response.result as unknown as { fileBinary: Buffer }).fileBinary;
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  async exists(path: string): Promise<boolean> {
    const dropboxPath = toDropboxPath(path);
    try {
      await this.dbx.filesGetMetadata({ path: dropboxPath });
      return true;
    } catch (err: unknown) {
      const summary = (err as { error?: { error_summary?: string } })?.error?.error_summary ?? "";
      if (summary.startsWith("path/not_found")) return false;
      throw err;
    }
  }

  async getUrl(path: string): Promise<string> {
    const dropboxPath = toDropboxPath(path);
    return this.createOrGetSharedLink(dropboxPath);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async uploadWithRetry(dropboxPath: string, content: Buffer): Promise<void> {
    await withRetry(
      () =>
        wrapDropboxError(() =>
          this.dbx.filesUpload({
            path: dropboxPath,
            contents: content,
            mode: { ".tag": "overwrite" },
            autorename: false,
          })
        ),
      {
        maxAttempts: 3,
        agentName: "dropbox_adapter",
        context: { operation: "filesUpload", path: dropboxPath },
      }
    );
  }

  private async createOrGetSharedLink(dropboxPath: string): Promise<string> {
    // Try to create a new shared link
    try {
      const response = await withRetry(
        () =>
          wrapDropboxError(() =>
            this.dbx.sharingCreateSharedLinkWithSettings({ path: dropboxPath })
          ),
        {
          maxAttempts: 3,
          agentName: "dropbox_adapter",
          context: { operation: "sharingCreateSharedLinkWithSettings", path: dropboxPath },
        }
      );
      return directUrl(response.result.url);
    } catch (err: unknown) {
      // If a link already exists, fetch and return it
      const summary = (err as { error?: { error_summary?: string } })?.error?.error_summary ?? String(err);
      if (summary.startsWith("shared_link_already_exists") || String(err).includes("shared_link_already_exists")) {
        return this.fetchExistingSharedLink(dropboxPath);
      }
      throw err;
    }
  }

  private async fetchExistingSharedLink(dropboxPath: string): Promise<string> {
    const response = await this.dbx.sharingListSharedLinks({
      path: dropboxPath,
      direct_only: true,
    });
    const links = response.result.links;
    if (links.length > 0 && links[0]) {
      return directUrl(links[0].url);
    }
    throw new Error(`No shared link found for ${dropboxPath}`);
  }
}

// ── Module-level utilities ────────────────────────────────────────────────────

/**
 * Replace "?dl=0" (Dropbox preview page) with "?dl=1" (direct file download).
 * Also strips raw_sub param that sometimes appears.
 */
function directUrl(url: string): string {
  return url.replace(/\?.*$/, "?dl=1");
}

/**
 * Convert a logical path to a Dropbox-safe absolute path.
 * Dropbox paths must start with "/" and cannot contain consecutive slashes.
 */
function toDropboxPath(logicalPath: string): string {
  const clean = logicalPath.replace(/\/+/g, "/").replace(/\/$/, "");
  return clean.startsWith("/") ? clean : `/${clean}`;
}

/**
 * Normalize Dropbox SDK errors so that classifyError() in retry.ts can read
 * the HTTP status code from the error message string.
 */
async function wrapDropboxError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const summary =
      (err as { error?: { error_summary?: string } })?.error?.error_summary ??
      (err instanceof Error ? err.message : String(err));

    throw new Error(`${status ? `${status} ` : ""}Dropbox API error: ${summary}`);
  }
}

function classifyDropboxError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) return "rate_limit";
  if (status && status >= 500) return "server_error";
  if (status === 401 || status === 403) return "auth_error";
  if (status === 400) return "bad_request";
  const msg = String(err).toLowerCase();
  if (msg.includes("timeout") || msg.includes("etimedout")) return "timeout";
  if (msg.includes("econnreset") || msg.includes("econnrefused")) return "connection_reset";
  return "unknown";
}
