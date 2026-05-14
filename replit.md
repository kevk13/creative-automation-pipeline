# Creative Automation Pipeline

A production-grade creative automation pipeline for social ad campaigns. Upload a campaign brief (YAML or JSON), and the pipeline automatically generates AI product images in three aspect ratios, applies brand overlays, and runs compliance checks — all orchestrated through a six-step multi-agent Mastra-compatible workflow.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port auto-assigned via PORT env)
- `pnpm --filter @workspace/frontend run dev` — run the React frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; background pipeline execution with polling for real-time progress
- AI: Anthropic claude-sonnet-4-5 (text + vision), Google Gemini gemini-2.5-flash-image (image generation)
- Image processing: Sharp (resize, composite SVG overlays)
- Workflow: Custom Mastra-compatible `createStep`/`createWorkflow` runner (`src/workflow/mastra-compat.ts`)
- Brief format: YAML/JSON parsed by `js-yaml`
- Logging: Pino (structured JSON, dual file+console, cost tracking per AI call)
- Validation: Zod at every workflow step boundary
- Frontend: Vite + React 19 + Tailwind v4, React Query, 750 ms polling for step progress
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (ESM bundle) / tsx watch (dev)
- No database — file-based storage with JSON manifests

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not hand-edit)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not hand-edit)
- `artifacts/api-server/src/workflow/` — 6-step Mastra workflow + step implementations
- `artifacts/api-server/src/agents/` — AssetGatherer + ComplianceChecker agents
- `artifacts/api-server/src/tools/` — agent tools (checkLocalAsset, generateAssetWithGenAI, extractColors, checkLogoPresence)
- `artifacts/api-server/src/schemas/campaignBrief.ts` — Zod schema for CampaignBrief (source of truth)
- `artifacts/api-server/briefs/sample-jewelry.yaml` — sample campaign brief for testing
- `artifacts/api-server/output/` — generated images + manifest.json + compliance.json (auto-created at runtime)
- `artifacts/api-server/logs/` — structured JSON run logs (auto-created at runtime)
- `artifacts/frontend/src/App.tsx` — single-page React app

## Architecture decisions

- **Mastra-compatible workflow**: `mastra-compat.ts` implements `createStep`/`createWorkflow` matching `@mastra/core/workflows` API exactly. Swap the import to use real Mastra with zero code changes.
- **Polling over SSE**: `POST /api/generate` returns `{runId}` immediately and runs the pipeline in a background async IIFE. The frontend polls `GET /api/run/:runId/status` every 750 ms. SSE was the original design but the Replit reverse proxy buffers all SSE chunks until the response closes, making streaming impossible without polling.
- **In-memory run store**: `src/lib/runStore.ts` holds a `Map<runId, RunState>` with a 1-hour TTL. Steps, current message, and final results are updated via `progressBus` events.
- **File-based storage**: `manifest.json` and `compliance.json` are portable artifacts. No DB needed for the POC; the schema maps directly to Postgres tables.
- **Dual AI client setup**: `src/lib/ai-clients.ts` checks `AI_INTEGRATIONS_ANTHROPIC_*` env vars first (Replit), falls back to `ANTHROPIC_API_KEY` (local). Image generation uses the Replit-managed Gemini integration (`@workspace/integrations-gemini-ai/image`).
- **Pino cost logging**: Every AI call logs `inputTokens`, `outputTokens`, and `costUSD`. Critical for per-client cost attribution at scale.
- **tsx for dev, esbuild for prod**: tsx watch avoids esbuild bundling issues with Mastra/AI SDKs during development. Production uses esbuild with heavy packages externalized.

## Product

The pipeline accepts a YAML/JSON campaign brief describing a client, products, target audience, campaign message, brand palette, and prohibited words. It then:
1. Loads and validates the brief
2. Generates or retrieves product images (Claude crafts the prompt, Gemini gemini-2.5-flash-image generates the image, or a local file is used)
3. Renders each image in three aspect ratios (1:1, 9:16, 16:9) using Sharp
4. Composites the campaign message as an SVG overlay on each image
5. Organizes outputs and writes `manifest.json`
6. Runs compliance checks: color palette scoring, logo presence (Claude vision), legal word scan

Results are surfaced in a React gallery with download links and a compliance report.

## User preferences

- Stack is locked: TypeScript, Mastra-compatible workflows, Anthropic claude-sonnet-4-5, Gemini gemini-2.5-flash-image, Sharp, Express, Vite+React+Tailwind, Pino, Zod, js-yaml
- No database — file-based storage only
- Single-page frontend

## Gotchas

- **Dev script uses tsx, not esbuild**: `pnpm run dev` in api-server uses `tsx watch src/index.ts`. Do not use `pnpm run build` for dev — it requires PORT/BASE_PATH env vars that only workflows provide.
- **Sharp needs onlyBuiltDependencies entry**: Already in pnpm-workspace.yaml. If pnpm warns about ignored build scripts, that entry is the fix.
- **Codegen after spec changes**: Always run `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`. The typecheck:libs step runs automatically as part of codegen.
- **Output directory**: All generated files go to `artifacts/api-server/output/`. Concurrent pipeline runs overwrite each other. Production needs run-scoped output directories.
- **Run store is in-memory**: Restarting the API server loses all in-flight run states. In-progress poll requests will receive 404 after a restart.

## Pointers

- See `README.md` at the project root for full architecture docs, setup instructions, and production extension path
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
