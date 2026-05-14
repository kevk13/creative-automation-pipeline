# Creative Automation Pipeline

A production-grade creative automation pipeline for social ad campaigns. Upload a campaign brief, and the pipeline automatically generates localized social ad creatives in three aspect ratios, applies brand overlays, and runs compliance checks — all orchestrated through a six-step multi-agent workflow.

---

## Overview

Global consumer goods companies launch hundreds of localized campaigns monthly. Manually producing each creative variant (multiple products × multiple aspect ratios × multiple markets) is slow, inconsistent, and expensive. This pipeline automates the entire creative production loop: from a structured campaign brief to a complete set of compliance-verified, overlay-rendered ad images — in a single API call.

The pipeline uses a Mastra-compatible workflow architecture to chain six discrete steps, each with Zod-validated input/output contracts, structured logging, and graceful error handling. Two specialized agents (asset coordinator and compliance checker) operate with bounded tool access and well-defined responsibilities.

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
┌─────────────────┐
│ 2. gatherAssets │  AssetGatherer agent: check local → generate via GenAI
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│ 3. renderAspectRatios│  Sharp: 1:1 (1080²), 9:16 (1080×1920), 16:9 (1920×1080)
└────────┬─────────────┘
         │
         ▼
┌──────────────────┐
│ 4. applyOverlay  │  Sharp SVG composite: campaign message bottom-third bar
└────────┬─────────┘
         │
         ▼
┌──────────────────────┐
│ 5. organizeOutputs   │  Verify file structure, write manifest.json
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

**Bounded responsibilities**: Each agent has a single, well-defined job. `assetGatherer` coordinates image sourcing. `complianceChecker` verifies output quality. Neither agent does both.

**Strict tool contracts**: Agents operate through explicit tools (`checkLocalAsset`, `generateAssetWithGenAI`, `extractColors`, `checkLogoPresence`). Each tool has a typed interface and handles its own error cases.

**Event-driven orchestration**: The workflow emits progress events via an internal `ProgressBus` (EventEmitter). The Express route subscribes to these events and streams them as Server-Sent Events to the frontend, providing real-time step-by-step visibility without polling.

**Why Mastra-compatible instead of `@mastra/core` directly**: This POC implements the `createStep`/`createWorkflow` API pattern from Mastra's workflow spec. The implementation is intentionally drop-in compatible — swapping the import from `./workflow/mastra-compat` to `@mastra/core/workflows` requires zero changes to step or workflow definitions. This avoids bundling complexity in a POC context while faithfully demonstrating the architectural pattern.

---

## Stack Rationale

| Technology | Why |
|---|---|
| **TypeScript** | End-to-end type safety from brief schema to manifest. Zod schemas at every step boundary mean runtime validation matches compile-time types. |
| **Mastra-compatible workflow** | Declarative step chaining with Zod input/output schemas per step. Observability is built-in: each step emits structured events. Hand-rolled orchestration would need all of this re-implemented. |
| **Anthropic claude-sonnet-4-5** | Best-in-class instruction following for prompt crafting and vision tasks. The compliance agent needs reliable JSON extraction from vision responses. |
| **OpenAI gpt-image-1 / DALL-E 3** | State-of-the-art photorealistic image generation. Architecture supports Adobe Firefly swap via single tool replacement in `generateAssetWithGenAI.ts`. |
| **Sharp** | Native Node.js image processing — 5-10× faster than Canvas, handles large images without memory issues, excellent resize quality with cover/contain modes. |
| **File-based storage** | Zero infrastructure for a POC. `manifest.json` and `compliance.json` are queryable and portable. Production path is Postgres + S3/R2 for campaign history and asset storage. |
| **Pino** | Structured JSON logging with file + console transports. Every AI call logs tokens, cost, and duration — essential for diagnosing production issues at scale. |
| **Express + SSE** | SSE over plain HTTP keeps the pipeline observable without WebSocket complexity. Each workflow step publishes to a ProgressBus; the route streams events to the frontend. |

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- API keys for Anthropic and OpenAI

### Installation

```bash
# Clone the repo
git clone <repo-url>
cd <repo-dir>

# Install all workspace packages
pnpm install

# Install frontend dependencies
cd artifacts/frontend && pnpm install && cd ../..
```

### Environment Variables

Create `artifacts/api-server/.env` (or set in your shell):

```env
# Required when running locally (outside Replit)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Set by Replit AI Integrations automatically — no action needed on Replit
# AI_INTEGRATIONS_ANTHROPIC_BASE_URL=...
# AI_INTEGRATIONS_ANTHROPIC_API_KEY=...
# AI_INTEGRATIONS_OPENAI_BASE_URL=...
# AI_INTEGRATIONS_OPENAI_API_KEY=...

PORT=5000
```

> **Running on Replit**: No API keys needed. The Replit AI Integrations proxy is configured automatically. Charges are billed to your Replit credits.

> **Running locally (for Adobe reviewers)**: Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in the `.env` file above. The server validates both keys on startup and exits with a clear error if either is missing.

### Run

```bash
# Terminal 1 — API server (port 5000)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend (port auto-assigned)
pnpm --filter @workspace/frontend run dev
```

---

## Usage

1. Open the frontend in your browser
2. Drag and drop `artifacts/api-server/briefs/sample-jewelry.yaml` onto the upload area
3. Review the brief preview (client name, products, campaign message, palette)
4. Click **Run Pipeline**
5. Watch step-by-step progress via the SSE stream
6. Browse the Results Gallery — three aspect ratios per product, compliance report below

### Output Structure

```
artifacts/api-server/output/
├── generated/
│   ├── sterling-silver-moonstone-necklace.png   # AI-generated base image
│   └── sterling-silver-hoop-earrings.png
├── sterling-silver-moonstone-necklace/
│   ├── 1x1/   base.png  final.png
│   ├── 9x16/  base.png  final.png
│   └── 16x9/  base.png  final.png
├── sterling-silver-hoop-earrings/
│   ├── 1x1/   base.png  final.png
│   ├── 9x16/  base.png  final.png
│   └── 16x9/  base.png  final.png
├── manifest.json
└── compliance.json
```

---

## Example Input

`briefs/sample-jewelry.yaml`:

```yaml
clientName: Sterling Atelier
products:
  - productName: Sterling Silver Moonstone Necklace
    productDescription: "Minimalist pendant for everyday wear, ethically sourced moonstone"
  - productName: Sterling Silver Hoop Earrings
    productDescription: "Modern thin hoops, hypoallergenic, designed for layering"
targetRegion: North America
targetAudience: "Women 28-42, urban, values craftsmanship and ethical sourcing"
campaignMessage: "Carry your story."
brandPalette: ["#C0C0C0", "#1A1A1A", "#F5F5F0"]
prohibitedWords: [free, guaranteed, miracle, cure]
```

**Expected output**: 6 final images (2 products × 3 ratios), `manifest.json` with file metadata, `compliance.json` with color scores, logo advisory, and legal word scan.

---

## Key Design Decisions

1. **File-based storage instead of database**: Manifest and compliance reports are portable JSON files. Zero infrastructure required for the POC. The schema is designed for direct Postgres migration: `manifest_entries` and `compliance_reports` tables map 1:1.

2. **Single-page frontend**: Focus stays on the pipeline itself. The frontend is a thin observer of the workflow — it uploads a brief, watches SSE progress, and displays results. No routing, no state management library.

3. **Mastra-compatible workflow over hand-rolled orchestration**: The `createStep`/`createWorkflow` pattern enforces Zod schemas at every step boundary and makes the execution graph explicit. Adding a new step (e.g., translation, A/B variant generation) is a single `.then(newStep)` call.

4. **Real image generation, not placeholders**: Every run produces actual AI-generated product images via OpenAI's image API. The architecture supports swapping to Adobe Firefly with a single function replacement in `src/tools/generateAssetWithGenAI.ts` — change the `openai.images.generate` call to the Firefly API endpoint.

5. **Structured logging with cost tracking from day one**: Every Anthropic call logs `inputTokens`, `outputTokens`, and `costUSD`. Every image generation logs `imageCount` and `costUSD`. All logs are queryable JSON in `logs/run-{timestamp}.json`. This is how an FDE diagnoses: "Why did this campaign run cost $4.20 instead of $0.80?"

---

## Observability and Cost Tracking

Every AI call is logged with:

```json
{
  "level": 30,
  "time": "2025-01-15T10:23:45.123Z",
  "step": "generateAssetWithGenAI",
  "msg": "Image generated",
  "product": "Sterling Silver Moonstone Necklace",
  "imageCount": 1,
  "costUSD": 0.04,
  "model": "gpt-image-1"
}
```

Cost model:
- Claude claude-sonnet-4-5: $3.00 / 1M input tokens, $15.00 / 1M output tokens
- gpt-image-1 / DALL-E 3: $0.040 per 1024×1024 image

Logs are structured JSON and can be queried with `jq`, shipped to Datadog/CloudWatch, or aggregated into a cost dashboard. At scale (hundreds of campaigns/day), this log structure is how you build per-client cost attribution and pipeline performance dashboards.

---

## Production Extension

To move this from POC to production:

| Concern | Solution |
|---|---|
| **Image generation** | Swap `generateAssetWithGenAI.ts` tool to call Adobe Firefly API — single function replacement, no other changes |
| **Batch processing** | Add BullMQ or SQS queue; each brief becomes a job; workers run the workflow in parallel |
| **Persistence** | Postgres for campaign history, audit trail, cost tracking; S3/R2 for generated assets |
| **Auth + tenancy** | Per-client API keys, campaign isolation, RBAC for approval workflows |
| **Human-in-the-loop** | Add `reviewStep` between `applyOverlay` and `organizeOutputs`; pause workflow, notify reviewer, resume on approval |
| **A/B testing** | Generate N variants per product, track downstream CTR, feed back into prompt tuning |
| **Localization** | Schema already supports `targetRegion`; add `translateStep` after `loadBrief` to localize `campaignMessage` and `productDescription` |

---

## Assumptions and Limitations

- **Scope**: Take-home build (~3-4 hours). Architecture is production-ready; infrastructure is not.
- **Compliance**: Checks are advisory, not blocking. Color match threshold (≥30%) is a starting point, not a production value.
- **No persistence**: Everything lives on the filesystem. Concurrent runs will overwrite `output/`. Production requires run-scoped output directories.
- **Single-user**: No auth, no tenant isolation, no rate limiting.
- **Image model**: `gpt-image-1` used on Replit (via AI Integrations proxy); DALL-E 3 used with direct API key. Both produce equivalent quality. Adobe Firefly is the production target — swap is one function replacement.
