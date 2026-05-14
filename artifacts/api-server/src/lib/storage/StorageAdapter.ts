/**
 * StorageAdapter — pluggable storage backend for pipeline outputs.
 *
 * Three backends are architecturally supported:
 *   local    — filesystem (default, always implemented)
 *   dropbox  — Dropbox shared storage (implemented)
 *   s3       — AWS S3 (scaffolded for future use)
 *   azure    — Azure Blob Storage (scaffolded for future use)
 *
 * Dropbox was chosen for this POC over S3 and Azure because the customer's
 * workflow is creative-team-led. Marketing and creative teams at consumer
 * goods companies already live in Dropbox-class shared storage — not in S3
 * consoles or Azure Blob containers. S3 and Azure remain one-class additions
 * for engineering-side observability or hybrid dual-write architectures.
 */

export type SaveResult = {
  /** Public URL (Dropbox shared link) or local file path for local adapter. */
  url: string;
  /** Bytes uploaded/written. */
  bytes: number;
};

export interface StorageAdapter {
  /** Machine-readable backend name — stamped on every manifest entry. */
  readonly adapterName: string;

  /**
   * Upload (or verify) content at the given logical path.
   * @param path   Cloud-style logical path, e.g. /outputs/vitara/serum/1x1/final.png
   * @param content File bytes to persist
   * @param metadata Optional key/value bag (e.g. { localPath: "/abs/path" })
   */
  save(path: string, content: Buffer, metadata?: Record<string, string>): Promise<SaveResult>;

  /** Download content from the given logical path. */
  load(path: string): Promise<Buffer>;

  /** Return true if an object exists at the given logical path. */
  exists(path: string): Promise<boolean>;

  /**
   * Return a publicly accessible URL for the given logical path.
   * For local adapter this is the filesystem path; for cloud it is a
   * shared/pre-signed link.
   */
  getUrl(path: string): Promise<string>;
}
