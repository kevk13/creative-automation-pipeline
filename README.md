# Creative Automation Pipeline

A production-grade creative automation pipeline for social ad campaigns. Upload a campaign brief (YAML or JSON), and the pipeline automatically generates AI product images in three aspect ratios, applies brand overlays, runs compliance checks, and uploads outputs to your storage backend — all orchestrated through a six-step multi-agent workflow.

---

## Overview

Global consumer goods companies launch hundreds of localized campaigns monthly. Manually producing each creative variant — multiple products × multiple aspect ratios × multiple markets — is slow, inconsistent, and expensive. This pipeline automates the entire creative production loop: from a structured campaign brief to a complete set of compliance-verified, overlay-rendered ad images in a single API call.

The pipeline uses a Mastra-compatible workflow architecture to chain six discrete steps, each with Zod-validated input/output contracts, structured Pino logging, and graceful error handling. Two specialized agents (AssetGatherer and ComplianceChecker) operate with bounded tool access and well-defined responsibilities. A pluggable StorageAdapter pattern handles output delivery — local filesystem by default, Dropbox with a single environment variable.

---

## Architecture

### Six-Step Mastra Workflow

```
CampaignBrief (YAML/JSON)
        │
        ▼
┌─────────────────┐
│  1. loadBrief   │  Parse + validate brief against Zod schema
└────────┬────────┘
         │
         ▼
┌──────────────────┐
│ 2. gatherAssets  │  AssetGatherer agent: reuse existing → generate via GenAI
└────────┬─────────┘
         │
         ▼
┌──────────────────────┐
│ 3. renderAspectRatios│  Sharp: 1:1 (1080²), 9:16 (1080×1920), 16:9 (1920×1080)
└────────┬─────────────┘
         │
         ▼
┌──────────────────┐
│ 4. applyOverlay  │  Sharp SVG composite: campaign message, bottom-third bar
└────────┬─────────┘
         │
         ▼
┌──────────────────────┐
│ 5. organizeOutputs   │  Verify files, upload via StorageAdapter, write manifest.json
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ 6. checkCompliance   │  ComplianceChecker agent: colors + logo + legal
└──────────────────────┘
         │
         ▼
manifest.json + compliance.json + final.png × (products × ratios)
```

### Agent Design Philosophy

**Bounded responsibilities** — Each agent has one job. `AssetGatherer` coordinates image sourcing. `ComplianceChecker` verifies output quality. Neither does both.

**Strict tool contracts** — Agents operate through explicit tools (`checkLocalAsset`, `generateAssetWithGenAI`, `loadExistingAsset`, `extractColors`, `checkLogoPresence`). Each tool has a typed interface and handles its own error cases.

**Polling-based progress** — The workflow emits progress events via an internal `ProgressBus` (EventEmitter) that updates an in-memory `RunState`. `POST /api/generate` returns `{runId}` immediately; the frontend polls `GET /api/run/:runId/status` every 750 ms for real-time step visibility. SSE was the original design but the Replit reverse proxy buffers all chunks until the response closes, making true streaming impossible through the proxy.

**Drop-in Mastra compatibility** — This POC implements the `createStep`/`createWorkflow` API pattern from Mastra's workflow spec exactly. Swapping the import from `./workflow/mastra-compat` to `@mastra/core/workflows` requires zero changes to any step or workflow definition.

---

## Stack Rationale

| Technology | Why |
|---|---|
| **TypeScript** | End-to-end type safety from brief schema to manifest. Zod schemas at every step boundary mean runtime validation matches compile-time types. |
| **Mastra-compatible workflow** | Declarative step chaining with validated input/output schemas per step. Observability is built-in. Hand-rolled orchestration would need all of this re-implemented. |
| **Anthropic claude-sonnet-4-5** | Best-in-class instruction following for prompt crafting and vision tasks. The compliance agent needs reliable JSON extraction from vision responses. |
| **Google Gemini gemini-2.5-flash-image** | Fast, high-quality image generation. Claude crafts the prompt; Gemini generates the image. Architecture supports Adobe Firefly swap via single tool replacement in `generateAssetWithGenAI.ts`. |
| **Sharp** | Native Node.js image processing — 5–10× faster than Canvas, handles large images without memory issues, excellent resize quality. |
| **StorageAdapter** | Pluggable output delivery. Local by default (zero config), Dropbox with one env var. S3 and Azure scaffolded as single-class additions. |
| **Pino** | Structured JSON logging with file + console transports. Every AI call logs tokens, cost, and duration. Logs ship to Datadog/CloudWatch with zero changes. |
| **Express + polling** | `POST /api/generate` returns immediately; clients poll `GET /api/run/:runId/status`. Simple, debuggable with curl, proxy-safe. |

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Anthropic API key (for text generation and vision calls)
- Google Gemini access (via Replit AI Integrations, or a `GEMINI_API_KEY` directly)

### Installation

```bash
# Clone the repo
git clone <repo-url>
cd <repo-dir>

# Install all workspace packages
pnpm install
```

### Environment Variables

Create `artifacts/api-server/.env` (or set in your shell):

```env
# Required when running locally (outside Replit)
ANTHROPIC_API_KEY=sk-ant-...

# Storage backend — defaults to "local" if unset
# Set to "dropbox" and provide a token to upload outputs to Dropbox
STORAGE_ADAPTER=local
# STORAGE_ADAPTER=dropbox
# DROPBOX_ACCESS_TOKEN=your_dropbox_token_here

PORT=5000
```

> **Running on Replit**: No API keys needed. The Replit AI Integrations proxy is configured automatically for both Anthropic and Gemini.

> **Running locally**: Set `ANTHROPIC_API_KEY`. Image generation uses the Replit-managed Gemini integration and requires additional configuration outside of Replit.

### Run

```bash
# Terminal 1 — API server
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend
pnpm --filter @workspace/frontend run dev
```

---

## Usage

1. Open the frontend in your browser
2. Load a sample brief using the quick-load buttons, or drag and drop your own YAML/JSON file
3. Optionally upload a brand logo — stamped bottom-right on every creative
4. Review the brief preview (client, products, campaign message, palette, asset sources)
5. Click **Run Pipeline**
6. Watch the six steps tick through in real time
7. Browse the **Results Gallery** — three aspect ratios per product with download links and compliance badges
8. Review the **Run Report** — total AI cost, duration, token counts, and a per-call breakdown

### Sample Briefs

Four sample briefs are included in `artifacts/api-server/briefs/`:

| File | Client | Mode |
|---|---|---|
| `sample-jewelry.yaml` | Sterling Atelier | Generate — Gemini produces images from scratch |
| `vitara-generate.yaml` | Vitara Naturals | Generate — Gemini produces images from scratch |
| `vitara-reuse.yaml` | Vitara Naturals | Reuse — loads existing brand photography |
| `sterling-reuse.yaml` | Sterling Atelier | Reuse — loads existing brand photography |

The UI labels each sample with a **Generate** (orange) or **Reuse** (green) badge so you can demonstrate both asset paths without editing a file.

### Asset Reuse

To use existing product photography instead of generating new images, add `existingAssetPath` to any product in the brief:

```yaml
products:
  - productName: Energize Daily Face Serum
    productDescription: "Vitamin C brightening serum, 30ml"
    existingAssetPath: "./briefs/assets/energize-serum.png"  # local path or URL
```

The AssetGatherer agent loads the file directly (no AI call, no cost) and stamps `generationMethod: "reused"` in the manifest. If the path is invalid or the file is missing, the agent logs a warning and falls back to Gemini generation automatically, stamping `generationMethod: "fallback_to_generated"`.

### Output Structure

```
artifacts/api-server/output/
├── generated/
│   ├── sterling-silver-moonstone-necklace.png   # AI-generated base image
│   └── sterling-silver-hoop-earrings.png
├── sterling-silver-moonstone-necklace/
│   ├── 1x1/    base.png  final.png
│   ├── 9x16/   base.png  final.png
│   └── 16x9/   base.png  final.png
├── sterling-silver-hoop-earrings/
│   ├── 1x1/    base.png  final.png
│   ├── 9x16/   base.png  final.png
│   └── 16x9/   base.png  final.png
├── manifest.json
└── compliance.json
```

`base.png` is the resized image before overlay. `final.png` is the campaign-ready deliverable with the message bar composited in.

---

## Example Input

`briefs/sample-jewelry.yaml`:

```yaml
clientName: Sterling Atelier
products:
  - productName: Sterling Silver Moonstone Necklace
    productDescription: "Minimalist pendant for everyday wear, ethically sourced moonstone, hand-finished in small batches"
  - productName: Sterling Silver Hoop Earrings
    productDescription: "Modern thin hoops, hypoallergenic, designed for layering"
targetRegion: North America
targetAudience: "Women 28-42, urban, values craftsmanship and ethical sourcing"
campaignMessage: "Carry your story."
brandPalette:
  - "#C0C0C0"
  - "#1A1A1A"
  - "#F5F5F0"
prohibitedWords: [free, guaranteed, miracle, cure]
```

**Expected output**: 6 final images (2 products × 3 ratios), `manifest.json` with file metadata and storage URLs, `compliance.json` with color scores, logo advisory, and legal word scan.

### Example manifest.json entry

```json
{
  "productName": "Sterling Silver Moonstone Necklace",
  "productSlug": "sterling-silver-moonstone-necklace",
  "aspectRatio": "1x1",
  "filePath": "/home/.../output/sterling-silver-moonstone-necklace/1x1/final.png",
  "fileSize": 1243880,
  "generationTimestamp": "2026-05-14T18:21:26.513Z",
  "generationMethod": "gemini-2.5-flash-image",
  "url": "/home/.../output/sterling-silver-moonstone-necklace/1x1/final.png",
  "adapter": "local",
  "uploadStatus": "success",
  "uploadedAt": "2026-05-14T18:21:26.515Z",
  "bytes": 1243880
}
```

With Dropbox active, `url` becomes a `https://www.dropbox.com/s/...?dl=1` direct download link and `adapter` becomes `"dropbox"`.

---

## Key Design Decisions

### 1. Mastra-compatible workflow over hand-rolled orchestration

The `createStep`/`createWorkflow` pattern enforces Zod schemas at every step boundary and makes the execution graph explicit. Adding a new step (localization, A/B variant generation, human review) is a single `.then(newStep)` call. Hand-rolled orchestration would need validation, error handling, and progress tracking re-implemented from scratch for every step.

The implementation is intentionally drop-in compatible with `@mastra/core/workflows` — swapping the import requires zero changes to step or workflow definitions.

### 2. Asset reuse alongside generation

The AssetGatherer agent supports three paths in priority order: load from `existingAssetPath` (no AI cost), fall back to Gemini generation if load fails, or generate from scratch if no path is provided. This reflects real production workflows where clients have brand photography for hero products but need generation for new SKUs. The `generationMethod` field in the manifest makes the source of every asset auditable.

### 3. StorageAdapter abstraction — Dropbox as the cloud backend

The pipeline uses a `StorageAdapter` interface with `save()`, `load()`, `exists()`, and `getUrl()` methods. Three backends are supported architecturally:

- **`local`** (default) — files saved to `output/` on disk, zero config
- **`dropbox`** (fully implemented) — files uploaded to Dropbox via the official SDK, shared links returned as download URLs
- **`s3` / `azure`** (scaffolded) — throw a clear error with instructions; single-class additions for teams that need them

**Why Dropbox over S3 or Azure**: The customer's workflow is creative-team-led. Marketing and creative teams at consumer goods companies consume assets in Dropbox-class shared storage — they share folders, send links to agencies, and drag files into layouts. They do not open S3 consoles or navigate Azure Blob containers. S3 and Azure remain scaffolded as engineering-side additions for observability pipelines or hybrid dual-write architectures. The chosen adapter reflects user workflow, not just technical preference.

Switch between backends via a single environment variable — no code changes:

```env
STORAGE_ADAPTER=local     # default, no token needed
STORAGE_ADAPTER=dropbox   # requires DROPBOX_ACCESS_TOKEN
```

The Dropbox adapter applies the same retry logic used for Gemini image generation: 3 attempts, exponential backoff with ±20% jitter, retry on 429/5xx/network errors, no retry on 400/401/403.

### 4. Frontend observability — Run Report panel

Cost and token data is not just logged to disk. Every AI call during a run records a cost event in the in-memory `RunState`. On run completion, the server computes a `runReport` summary and exposes it through the polling endpoint. The frontend renders a **Run Report** panel showing:

- Total AI cost (Claude input + output tokens billed at $3.00/M and $15.00/M respectively)
- Run duration
- Total AI call count
- Token breakdown (input vs output)
- Per-call log table: tool name, step, product, model, tokens, cost

This makes per-run cost visible to anyone using the UI — not just engineers with server access. At scale, the same `costEvents` array feeds per-client cost attribution dashboards.

### 5. Real image generation, not placeholders

Every run produces actual AI-generated product images. Claude `claude-sonnet-4-5` writes the image generation prompt tailored to the product, brand palette, and target audience. Gemini `gemini-2.5-flash-image` generates the image. The architecture supports swapping to Adobe Firefly with a single function replacement in `src/tools/generateAssetWithGenAI.ts` — nothing else in the pipeline changes.

### 6. Structured logging with cost tracking from day one

Every AI call is logged as structured JSON:

```json
{
  "time": "2026-05-14T10:23:45.123Z",
  "step": "generateAssetWithGenAI",
  "msg": "Claude prompt crafted",
  "product": "Sterling Silver Moonstone Necklace",
  "inputTokens": 412,
  "outputTokens": 87,
  "costUSD": 0.00374,
  "model": "claude-sonnet-4-5"
}
```

Logs are written to `logs/run-{timestamp}.json` and are queryable with `jq`, shippable to Datadog/CloudWatch, or aggregatable into cost dashboards. At scale (hundreds of campaigns per day), this is how you answer: "Why did this campaign run cost $4.20 instead of $0.80?"

### 7. File-based storage instead of database

Manifest and compliance reports are portable JSON files. Zero infrastructure required for the POC. The schema maps directly to Postgres tables — `manifest_entries` and `compliance_reports` — with no restructuring needed for the migration.

---

## Observability and Cost Tracking

### In the UI (Run Report panel)

After every pipeline run, the **Run Report** section displays:

| Metric | Description |
|---|---|
| Total AI Cost | Sum of all Claude token costs for the run |
| Run Duration | Wall-clock time from request to completion |
| AI Calls | Total number of model invocations |
| Tokens Used | Combined input + output token count |

Below the summary, the **AI Call Log** table shows one row per invocation — tool, step, product, model, input tokens, output tokens, cost. Gemini image generation cost is not returned by the Replit-managed integration and is displayed as `—`.

### On the server (Pino logs)

Logs are written to `artifacts/api-server/logs/run-{timestamp}.json`. Each line is a JSON object. To query:

```bash
# All AI costs for a run
jq 'select(.costUSD != null) | {step, product, model, costUSD}' logs/run-*.json

# Total cost for a run
jq -s '[.[].costUSD // 0] | add' logs/run-*.json

# Dropbox upload results
jq 'select(.adapter == "dropbox")' logs/run-*.json
```

---

## Production Extension

| Concern | Solution |
|---|---|
| **Image generation** | Swap `generateAssetWithGenAI.ts` to call Adobe Firefly API — single function, no other changes |
| **Concurrent runs** | Add run-scoped output directories (`output/{runId}/`); current implementation overwrites on each run |
| **Batch processing** | Add BullMQ or SQS queue; each brief becomes a job; workers run the workflow in parallel |
| **Persistence** | Postgres for campaign history and audit trail; S3/R2 for generated assets |
| **Auth + tenancy** | Per-client API keys, campaign isolation, RBAC for approval workflows |
| **Human-in-the-loop** | Add `reviewStep` between `applyOverlay` and `organizeOutputs`; pause workflow, notify reviewer, resume on approval |
| **A/B testing** | Generate N variants per product, track downstream CTR, feed back into prompt tuning |
| **Localization** | Schema already has `targetRegion`; add `translateStep` after `loadBrief` to localize `campaignMessage` and `productDescription` |
| **Cloud storage** | `STORAGE_ADAPTER=dropbox` is live; `s3` and `azure` are scaffolded single-class additions |

---

## Assumptions and Limitations

- **Scope**: Take-home build. Architecture is production-ready; infrastructure is not.
- **Concurrent runs**: All runs write to the same `output/` directory. The last run wins. Production requires run-scoped output paths.
- **Compliance checks**: Advisory, not blocking. Color match threshold (≥30%) is a starting point. Logo detection relies on Claude vision and is non-deterministic.
- **Single-user**: No auth, no tenant isolation, no rate limiting.
- **Image model**: `gemini-2.5-flash-image` via Replit AI Integrations. Adobe Firefly is the production target — one function swap in `generateAssetWithGenAI.ts`.
- **Gemini cost**: The Replit-managed Gemini integration does not return billing data. Image generation cost is logged as $0 and shown as `—` in the Run Report.
- **Run store**: In-memory with a 1-hour TTL. Restarting the API server loses all in-flight run states.
