import path from "path";

/**
 * Centralized path resolution — works correctly in both environments:
 *
 * Dev (tsx watch, pnpm sets CWD = artifacts/api-server/):
 *   process.env.API_SERVER_ROOT is unset → process.cwd() = artifacts/api-server/
 *
 * Production (node dist/index.mjs, CWD = workspace root):
 *   process.env.API_SERVER_ROOT = "artifacts/api-server" (set in artifact.toml)
 *   → path.resolve(workspace_root, "artifacts/api-server")
 *
 * Using import.meta.url per-file fails in production because esbuild merges all
 * source files into dist/index.mjs — every __dirname resolves to dist/, so
 * traversal counts that were correct in dev (src/routes = ../../, src/workflow/steps = ../../..)
 * all give wrong answers from dist/.
 */

const API_SERVER_ROOT = process.env.API_SERVER_ROOT
  ? path.resolve(process.cwd(), process.env.API_SERVER_ROOT)
  : process.cwd();

export const OUTPUT_DIR = path.resolve(API_SERVER_ROOT, "output");
export const BRIEFS_DIR = path.resolve(API_SERVER_ROOT, "briefs");
export const LOGS_DIR = path.resolve(API_SERVER_ROOT, "logs");
