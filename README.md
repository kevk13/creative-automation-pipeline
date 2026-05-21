# Creative Automation Pipeline

This is a deliberate 2-3 hour POC. Scope discipline was a priority: every architectural decision is production-faithful, but infrastructure concerns (auth, queuing, multi-tenancy) are explicitly deferred and documented rather than partially implemented.

A creative automation pipeline for social ad campaigns. Upload a campaign brief (YAML or JSON), and the pipeline automatically generates AI product images in three aspect ratios, applies brand overlays, runs compliance checks, and uploads outputs to your storage backend - all orchestrated through a six-step multi-agent workflow.

---

## Quick Start

The fastest path on a fresh machine. Should take about two minutes after the install completes.

### Prerequisites

You need exactly two things installed:

- **Node.js 20+** — install from [nodejs.org](https://nodejs.org/) or via Homebrew: `brew install node`
- **pnpm 10.x** — the project pins this via `packageManager` so corepack will auto-activate it on Node 16.10+. If `pnpm --version` shows nothing or shows 9.x/11.x, run one of these once:
  - `corepack enable` (preferred, no extra install)
  - or `npm install -g pnpm@10`

Verify with:
```bash
node --version    # v20.x or later
pnpm --version    # 10.x
```

### Setup

```bash
git clone https://github.com/kevk13/creative-automation-pipeline.git
cd creative-automation-pipeline
cp .env.example .env
```

Now open `.env` in your editor of choice and paste your two API keys:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...   # from https://console.anthropic.com/settings/keys
GEMINI_API_KEY=AIza...                # from https://aistudio.google.com/apikey
```

> A few demo runs cost roughly $0.04 each — well within Anthropic's
> free-trial credit and Gemini's free tier. If you hit a rate limit
> mid-run, the Anthropic console may need a billing method attached.

Then install and run:

```bash
pnpm install
pnpm run dev
```

The dev script starts the API on port 4000 and the frontend on port 5173. When you see `Local: http://localhost:5173` in the logs, open that URL in your browser. Load a sample brief, click **Run Pipeline**, and the gallery will populate in about 60 seconds.

> **macOS note**: the API runs on `:4000` because macOS AirPlay Receiver occupies `:5000` by default.

> **On Replit**: both services start via the workflow panel. No API keys needed — AI Integrations provides Anthropic and Gemini credentials automatically.

### Alternative: Docker

If you'd rather not install Node and pnpm locally, the repo ships with a `docker-compose.yml` that handles everything:

```bash
cp .env.example .env
# Edit .env with your API keys
docker compose up --build
```

Same `http://localhost:5173` URL. Works identically on macOS, Linux, and Windows.

---

## Overview

Global consumer goods companies launch hundreds of localized campaigns monthly. Manually producing each creative variant - multiple products x multiple aspect ratios x multiple markets - is slow, inconsistent, and expensive. This pipeline automates the entire creative production loop: from a structured campaign brief to a complete set of compliance-verified, overlay-rendered ad images in a single API call.

The pipeline uses a Mastra-compatible workflow architecture to chain six discrete steps, each with Zod-validated input/output contracts, structured Pino logging, and graceful error handling. Two specialized agents (AssetGatherer and ComplianceChecker) operate with bounded tool access and well-defined responsibilities. A pluggable StorageAdapter handles output delivery - local filesystem by default, Dropbox with a single environment variable.

---

## Architecture

### Six-Step Workflow

```
CampaignBrief (YAML/JSON)
        |
        v
+------------------+
| 1. loadBrief     |  Parse and validate brief against Zod schema
+------------------+
        |
        v
+------------------+
| 2. gatherAssets  |  AssetGatherer agent
+------------------+  - checkLocalAsset: probe existingAssetPath
        |              - loadExistingAsset: copy reused image into output tree
        v              - generateAssetWithGenAI: Claude writes prompt, Gemini renders
+------------------+
| 3. renderRatios  |  Sharp resize: 1:1 (1080x1080), 9:16 (1080x1920), 16:9 (1920x1080)
+------------------+
        |
        v
+------------------+
| 4. applyOverlay  |  Sharp SVG composite: campaign message bar, bottom third
+------------------+  Font scales down iteratively until text fits without overflow
        |
        v
+--------------------+
| 5. organizeOutputs |  StorageAdapter.save() per file, write manifest.json
+--------------------+
        |
        v
+------------------+
| 6. checkCompliance|  ComplianceChecker agent
+------------------+  - extractColors: pixel sampling vs brand palette
        |              - checkLogoPresence: Claude vision per final image
        v              - legal scan: regex against prohibitedWords list
manifest.json + compliance.json + final.png x (products x ratios)


Cross-cutting concerns (every step):
+----------------------+     +------------------------------+
| Pino structured log  |     | StorageAdapter (step 5)      |
|                      |     |                              |
| - tokens per call    |     | local  -> output/ on disk    |
| - costUSD per call   |     | dropbox -> Dropbox shared URL|
| - latencyMs          |     | s3     -> scaffolded         |
| - logs/run-*.json    |     | azure  -> scaffolded         |
+----------------------+     +------------------------------+
```

### Agent Design Philosophy

**Bounded responsibilities** - Each agent has one job. AssetGatherer coordinates image sourcing. ComplianceChecker verifies output quality. Neither does both.

**Strict tool contracts** - Agents operate through explicit tools with typed interfaces. Each tool handles its own error cases and never fails silently.

**Polling-based progress** - The workflow emits progress events via an internal ProgressBus (EventEmitter) that updates an in-memory RunState. `POST /api/generate` returns `{runId}` immediately; the frontend polls `GET /api/run/:runId/status` every 750 ms. SSE was the original design but the Replit reverse proxy buffers all chunks until the response closes, making true streaming impossible through the proxy.

**Drop-in Mastra compatibility** - This POC implements the `createStep`/`createWorkflow` API pattern from Mastra's workflow spec exactly. Swapping the import from `./workflow/mastra-compat` to `@mastra/core/workflows` requires zero changes to any step or workflow definition.

---

## Stack Rationale

| Technology | Why |
|---|---|
| TypeScript | End-to-end type safety from brief schema to manifest. Zod schemas at every step boundary mean runtime validation matches compile-time types. |
| Mastra-compatible workflow | Declarative step chaining with validated input/output schemas per step. Observability is built in. Hand-rolled orchestration would need all of this re-implemented. |
| Anthropic claude-sonnet-4-5 | Best-in-class instruction following for prompt crafting and vision tasks. The compliance agent needs reliable JSON extraction from vision responses. |
| Google Gemini gemini-2.5-flash-image | Fast, high-quality image generation. Claude crafts the prompt; Gemini generates the image. Architecture supports Adobe Firefly swap via single tool replacement in `generateAssetWithGenAI.ts`. |
| Sharp | Native Node.js image processing - 5-10x faster than Canvas, handles large images without memory issues, excellent resize quality. |
| StorageAdapter | Pluggable output delivery. Local by default (zero config), Dropbox with one env var. S3 and Azure scaffolded as single-class additions. |
| Pino | Structured JSON logging with file + console transports. Every AI call logs tokens, cost, and duration. Logs ship to Datadog/CloudWatch with zero changes. |
| Express + polling | `POST /api/generate` returns immediately; clients poll `GET /api/run/:runId/status`. Simple, debuggable with curl, proxy-safe. |

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Anthropic API key (for text generation and vision calls)
- Google Gemini API key (for image generation; provided automatically on Replit)

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-api03-...
GEMINI_API_KEY=AIza...
PORT=4000

# Optional - storage backend (default: local)
STORAGE_ADAPTER=local
# STORAGE_ADAPTER=dropbox
# DROPBOX_ACCESS_TOKEN=your_token_here
```

On Replit, `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are provided automatically by AI Integrations. No manual configuration needed.

---

## Usage

1. Open the app in your browser
2. Load a sample brief using the quick-load buttons, or drag and drop your own YAML/JSON file
3. Optionally upload a brand logo - stamped bottom-right on every creative
4. Review the brief preview (client, products, campaign message, palette, asset sources)
5. Click **Run Pipeline**
6. Watch the six steps tick through in real time
7. Browse the **Results Gallery** - three aspect ratios per product with download links and compliance badges
8. Review the **Run Report** - total AI cost, duration, token counts, and a per-call breakdown

### Sample Briefs

Four sample briefs are included in `artifacts/api-server/briefs/`:

| File | Client | Mode |
|---|---|---|
| `sample-jewelry.yaml` | Sterling Atelier | Generate - Gemini produces images from scratch |
| `vitara-generate.yaml` | Vitara Naturals | Generate - Gemini produces images from scratch |
| `vitara-reuse.yaml` | Vitara Naturals | Reuse - loads existing brand photography |
| `sterling-reuse.yaml` | Sterling Atelier | Reuse - loads existing brand photography |

The UI labels each sample with a Generate (orange) or Reuse (green) badge.

### Asset Reuse

To use existing product photography instead of generating new images, add `existingAssetPath` to any product in the brief:

```yaml
products:
  - productName: Energize Daily Face Serum
    productDescription: "Vitamin C brightening serum, 30ml"
    existingAssetPath: "./briefs/assets/energize-serum.png"
```

The AssetGatherer agent loads the file directly - no AI call, no cost - and stamps `generationMethod: "reused"` in the manifest. If the path is invalid or the file is missing, the agent logs a warning and falls back to Gemini generation automatically.

---

## Example Input and Output

### Input: `briefs/sample-jewelry.yaml`

```yaml
clientName: Sterling Atelier
products:
  - productName: Sterling Silver Moonstone Necklace
    productDescription: "Minimalist pendant for everyday wear, ethically sourced moonstone,
      hand-finished in small batches"
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

### Output: folder structure

```
output/
  sterling-silver-moonstone-necklace/
    1x1/    base.png   final.png
    9x16/   base.png   final.png
    16x9/   base.png   final.png
  sterling-silver-hoop-earrings/
    1x1/    base.png   final.png
    9x16/   base.png   final.png
    16x9/   base.png   final.png
  generated/
    sterling-silver-moonstone-necklace.png
    sterling-silver-hoop-earrings.png
  manifest.json
  compliance.json
```

`base.png` is the resized image before overlay. `final.png` is the campaign-ready deliverable with the message bar composited in.

### Output: `manifest.json` (one entry)

```json
{
  "productName": "Sterling Silver Moonstone Necklace",
  "productSlug": "sterling-silver-moonstone-necklace",
  "aspectRatio": "1x1",
  "filePath": "/output/sterling-silver-moonstone-necklace/1x1/final.png",
  "fileSize": 1243880,
  "generationTimestamp": "2026-05-14T18:21:26.513Z",
  "generationMethod": "gemini-2.5-flash-image",
  "url": "/output/sterling-silver-moonstone-necklace/1x1/final.png",
  "adapter": "local",
  "uploadStatus": "success",
  "uploadedAt": "2026-05-14T18:21:26.515Z",
  "bytes": 1243880
}
```

With Dropbox active, `url` becomes a `https://www.dropbox.com/s/...?dl=1` direct download link and `adapter` becomes `"dropbox"`.

### Output: `compliance.json` (abbreviated)

```json
{
  "generatedAt": "2026-05-14T18:21:44.201Z",
  "colorCompliance": [
    {
      "productName": "Sterling Silver Moonstone Necklace",
      "aspectRatio": "1x1",
      "dominantColors": ["#B8B8B8", "#1C1C1C", "#F2EDE8"],
      "score": 0.82,
      "pass": true
    }
  ],
  "logoCompliance": [
    {
      "productName": "Sterling Silver Moonstone Necklace",
      "aspectRatio": "1x1",
      "logoPresent": false,
      "reasoning": "No brand logo or watermark visible in the image"
    }
  ],
  "legalCompliance": {
    "passed": true,
    "matches": []
  }
}
```

### Output: Run Report (verified against actual runs)

A 2-product generate run (Vitara Naturals brief, measured):

| Metric | Actual value |
|---|---|
| Total AI cost | $0.043 |
| Run duration | 56 seconds |
| AI calls | 10 |
| Input tokens | 9,901 |
| Output tokens | 886 |

Per-call breakdown (10 calls total):

| Call | Count | Cost each | Subtotal |
|---|---|---|---|
| Claude prompt crafting (gatherAssets) | 2 | ~$0.0035 | ~$0.007 |
| Gemini image generation (gatherAssets) | 2 | $0.00 reported | $0.00 |
| Claude vision logo check (checkCompliance) | 6 | ~$0.006 | ~$0.036 |

Gemini image generation cost is not returned by the Replit-managed integration and is displayed as $0. Actual Gemini billing occurs on the Replit account and is not currently tracked per-run.

For reuse runs (existing images provided), the 2 Claude prompt crafts and 2 Gemini calls are skipped. Only the 6 compliance vision calls run, reducing total cost to approximately $0.036.

---

## Key Design Decisions

### 1. Mastra-compatible workflow over hand-rolled orchestration

The `createStep`/`createWorkflow` pattern enforces Zod schemas at every step boundary and makes the execution graph explicit. Adding a new step (localization, A/B variant generation, human review) is a single `.then(newStep)` call. Hand-rolled orchestration would need validation, error handling, and progress tracking re-implemented from scratch for every step.

The implementation is intentionally drop-in compatible with `@mastra/core/workflows` - swapping the import requires zero changes to step or workflow definitions.

### 2. Asset reuse alongside generation

The AssetGatherer agent supports three paths in priority order: load from `existingAssetPath` (no AI cost), fall back to Gemini generation if load fails, or generate from scratch if no path is provided. This reflects real production workflows where clients have brand photography for hero products but need generation for new SKUs. The `generationMethod` field in the manifest makes the source of every asset auditable.

### 3. StorageAdapter abstraction - Dropbox as the cloud backend

The pipeline uses a `StorageAdapter` interface with `save()`, `load()`, `exists()`, and `getUrl()` methods. Three backends are supported architecturally:

- `local` (default) - files saved to `output/` on disk, zero config
- `dropbox` (fully implemented) - files uploaded to Dropbox via the official SDK, shared links returned as download URLs
- `s3` / `azure` (scaffolded) - throw a clear error with instructions; single-class additions for teams that need them

**Why Dropbox over S3 or Azure**: The customer's workflow is creative-team-led. Marketing and creative teams at consumer goods companies consume assets in Dropbox-class shared storage - they share folders, send links to agencies, and drag files into layouts. They do not open S3 consoles or navigate Azure Blob containers. S3 and Azure remain scaffolded as engineering-side additions for observability pipelines or hybrid dual-write architectures. The chosen adapter reflects user workflow, not just technical preference.

Switch backends with a single environment variable - no code changes:

```env
STORAGE_ADAPTER=local     # default, no token needed
STORAGE_ADAPTER=dropbox   # also set DROPBOX_ACCESS_TOKEN
```

The Dropbox adapter applies the same retry logic used for Gemini image generation: 3 attempts, exponential backoff with +/-20% jitter, retry on 429/5xx/network errors, no retry on 400/401/403.

**Dropbox implementation status**: The adapter is fully implemented and the local regression path is verified. The cloud upload path requires a live `DROPBOX_ACCESS_TOKEN` to test end-to-end against the Dropbox API.

### 4. Frontend observability - Run Report panel

Cost and token data is not just logged to disk. Every AI call during a run records a cost event in the in-memory RunState. On run completion, the server computes a `runReport` summary and exposes it through the polling endpoint. The frontend renders a Run Report panel showing total cost, duration, call count, token breakdown, and a per-call log table.

This makes per-run cost visible to anyone using the UI - not just engineers with server access. At scale, the same `costEvents` array feeds per-client cost attribution dashboards.

### 5. Real image generation, not placeholders

Every generate run produces actual AI-generated product images. Claude writes the image generation prompt tailored to the product, brand palette, and target audience. Gemini renders the image. The architecture supports swapping to Adobe Firefly with a single function replacement in `src/tools/generateAssetWithGenAI.ts` - nothing else in the pipeline changes.

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

Logs are written to `logs/run-{timestamp}.json` and are queryable with `jq`, shippable to Datadog/CloudWatch, or aggregatable into cost dashboards.

### 7. File-based storage instead of database

Manifest and compliance reports are portable JSON files. Zero infrastructure required for the POC. The schema maps directly to two Postgres tables - `manifest_entries` and `compliance_reports` - with no restructuring needed for the migration.

---

## Observability and Cost Tracking

### In the UI (Run Report panel)

After every pipeline run, the Run Report section displays total cost, run duration, AI call count, and token breakdown. Below the summary, the AI Call Log table shows one row per invocation: tool, step, product, model, input tokens, output tokens, cost.

Gemini image generation cost is not returned by the Replit-managed integration and is displayed as `--`.

### On the server (Pino logs)

Logs are written to `artifacts/api-server/logs/run-{timestamp}.json`. Each line is a JSON object. Useful queries:

```bash
# All AI costs for a run
jq 'select(.costUSD != null) | {step, product, model, costUSD}' logs/run-*.json

# Total spend for a run
jq -s '[.[].costUSD // 0] | add' logs/run-*.json

# Dropbox upload results
jq 'select(.adapter == "dropbox")' logs/run-*.json
```

---

## Production Extension

| Concern | Solution |
|---|---|
| Image generation | Swap `generateAssetWithGenAI.ts` to call Adobe Firefly API - single function, no other changes |
| Concurrent runs | Add run-scoped output directories (`output/{runId}/`); current implementation overwrites on each run |
| Batch processing | Add BullMQ or SQS queue; each brief becomes a job; workers run the workflow in parallel |
| Persistence | Postgres for campaign history and audit trail; S3/R2 for generated assets |
| Auth and tenancy | Per-client API keys, campaign isolation, RBAC for approval workflows |
| Human-in-the-loop | Add `reviewStep` between `applyOverlay` and `organizeOutputs`; pause workflow, notify reviewer, resume on approval |
| A/B testing | Generate N variants per product, track downstream CTR, feed back into prompt tuning |
| Localization | Schema already has `targetRegion`; add `translateStep` after `loadBrief` to localize `campaignMessage` and `productDescription` |
| Cloud storage | `STORAGE_ADAPTER=dropbox` is live; `s3` and `azure` are scaffolded single-class additions |

---

## Future Iterations

Beyond the production-readiness extensions above, the higher-leverage next
steps are about closing the gap between "generates brand-adjacent imagery"
and "generates **on-brand**, **on-product** variations at scale."

### Reference-image conditioning
The current pipeline generates from text prompts alone, which produces
brand-adjacent imagery but doesn't reliably preserve product fidelity
across many campaigns — a real Vitara serum bottle in 50 generations
should look like the *same* bottle, not 50 similar bottles. Adding
image-to-image conditioning (Gemini's reference mode, Adobe Firefly's
structure references, or a ControlNet pipeline) would let the system
take product photography as input and produce variations that preserve
shape, color, and label.

### Brand fine-tuning (LoRA adapters)
Train lightweight LoRA adapters on a brand's existing creative library
so every output absorbs the visual language without needing it spelled
out in the prompt. One adapter per client, reused across every campaign.
Reduces per-prompt token cost, improves consistency, and makes "off-brand
output" structurally harder.

### DAM integration (Adobe AEM Assets, Bynder, Brandfolder)
The `existingAssetPath` mechanism in the brief schema is the first step
toward this. The next step is `StorageAdapter`-style adapters for real
digital asset management systems — Adobe AEM Assets in particular, given
its position in the Experience Cloud — so the pipeline reaches into a
client's approved asset library instead of relying on local file paths.
An `AEMAssetsAdapter` is structurally identical to the existing
`DropboxStorageAdapter`: implement `load()`, `exists()`, `getUrl()`,
wire via env var, no other pipeline changes.

Together these shift the system from "generate creative variations"
to "generate on-brand, on-product variations at scale" — the business
outcome the brief actually describes.

---

## Assumptions and Limitations

- **Variation scope**: The PDF objective describes generating "variations for campaign assets." This POC interprets variations as the combination of multi-product output and multi-aspect-ratio output, producing six final creatives for a two-product campaign (2 products x 3 aspect ratios). A broader interpretation - multiple distinct creative concepts per product for A/B testing - is supported architecturally via a `variantsPerProduct` parameter on the brief schema. The AssetGatherer step is single-iteration today; making it N-iteration is an additive change with no downstream restructuring required. Per-region localization of the campaign message is similarly architecture-ready via a `translateStep` after `loadBrief`, using the existing `targetRegion` field. Both are scope-out decisions for the 2-3 hour POC window, not architectural limitations.
- **Scope**: Deliberate 2-3 hour POC. Architecture is production-faithful; infrastructure is not.
- **Concurrent runs**: All runs write to the same `output/` directory. The last run wins. Production requires run-scoped output paths.
- **Compliance checks**: Advisory, not blocking. Color match threshold (>=30%) is a starting point. Logo detection relies on Claude vision and is non-deterministic.
- **Single-user**: No auth, no tenant isolation, no rate limiting.
- **Image model**: `gemini-2.5-flash-image` via Replit AI Integrations. Adobe Firefly is the production target - one function swap in `generateAssetWithGenAI.ts`.
- **Gemini cost**: The Replit-managed Gemini integration does not return billing data. Image generation cost is logged as $0 and shown as `--` in the Run Report.
- **Run store**: In-memory with a 1-hour TTL. Restarting the API server loses all in-flight run states.
- **pnpm required**: The workspace uses pnpm. `npm install` is blocked by a preinstall guard. Use `pnpm install` and `pnpm run dev`.
