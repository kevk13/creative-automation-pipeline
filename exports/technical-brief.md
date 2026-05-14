# Creative Automation Pipeline — Technical Review Brief

**Prepared for:** External Reviewer  
**Date:** May 14, 2026  
**Repo layout:** pnpm monorepo — `artifacts/api-server` (Express), `artifacts/frontend` (Vite + React), `lib/api-spec` (OpenAPI), `lib/api-client-react` (generated hooks), `lib/api-zod` (generated schemas)

---

## 1. Architecture Overview

### Pipeline topology

All six steps run **strictly sequentially** — no parallelism, no branching. Each step receives the previous step's output as its own input. Inter-step communication is typed Zod schemas, validated at every boundary. Progress events are emitted to an in-process EventEmitter bus (`progressBus`) which updates an in-memory run-state store; the frontend polls that store every 750 ms.

```
HTTP POST /api/generate
    │
    ├── Zod-validates request body → CampaignBrief
    ├── Allocates runId, creates RunState in memory
    ├── Returns {"runId":"..."} immediately (< 5 ms)
    │
    └── background async IIFE ──►
            │
            ▼
    ┌─── Step 1: loadBrief ──────────────────────────────────────────┐
    │  In:  CampaignWorkflowInput (runId + raw brief or file path)   │
    │  Out: { runId, brief: CampaignBrief }                          │
    │  Does: parse YAML/JSON, Zod-validate, emit progress event       │
    └────────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌─── Step 2: gatherAssets ───────────────────────────────────────┐
    │  In:  { runId, brief }                                          │
    │  Out: { runId, brief, assets: Record<productName, filePath>,    │
    │         outputDir }                                              │
    │  Does: per-product: check local file OR call AssetGatherer      │
    │        agent (Claude prompt → Gemini image → save PNG)          │
    └────────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌─── Step 3: renderAspectRatios ─────────────────────────────────┐
    │  In:  { runId, brief, assets, outputDir }                       │
    │  Out: { runId, brief, renders: Record<product, Record<ratio,    │
    │         filePath>>, outputDir }                                  │
    │  Does: Sharp resize to 1080×1080, 1080×1920, 1920×1080         │
    │        (fit: cover, position: centre) — 3 files per product     │
    └────────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌─── Step 4: applyOverlay ───────────────────────────────────────┐
    │  In:  { runId, brief, renders }     (renders → base.png)       │
    │  Out: { runId, brief, renders }     (renders → final.png)      │
    │  Does: build SVG overlay (word-wrapped bar + text), optionally  │
    │        composite logo PNG, Sharp composite → final.png           │
    └────────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌─── Step 5: organizeOutputs ────────────────────────────────────┐
    │  In:  { runId, brief, renders, outputDir }                      │
    │  Out: { runId, brief, renders, manifest, outputDir }            │
    │  Does: verify every final.png exists, stat file sizes, write    │
    │        output/manifest.json                                      │
    └────────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌─── Step 6: checkCompliance ────────────────────────────────────┐
    │  In:  { runId, brief, renders, manifest, outputDir }            │
    │  Out: { runId, manifest, complianceReport, outputDir }          │
    │  Does: per-image color extraction (Sharp pixel sampling) +      │
    │        logo vision check (Claude multimodal) + legal word scan  │
    │        → write output/compliance.json                           │
    └────────────────────────────────────────────────────────────────┘
            │
            └── completeRun(runId, manifest, complianceReport)
                → RunState.status = "done"
```

### Agents (not LLM-orchestrated tool loops — custom async functions)

| Agent | File | Role | Tools called |
|---|---|---|---|
| AssetGatherer | `src/agents/assetGatherer.ts` | Per-product: check local asset, else generate via GenAI | `checkLocalAsset`, `generateAssetWithGenAI` |
| ComplianceChecker | `src/agents/complianceChecker.ts` | Per-render: color extraction + logo vision + legal scan | `extractColors`, `checkLogoPresence` (+ inline legal scan) |

> **Note:** These are not LLM agent loops with autonomous tool selection. They are named "agents" in the Mastra idiom — async functions that coordinate multiple tools to accomplish a goal. There is no ReAct loop, no tool-calling via the LLM API, no automatic retry or replanning.

### Tools

| Tool | File | Mechanism |
|---|---|---|
| `checkLocalAsset` | `src/tools/checkLocalAsset.ts` | `fs.existsSync` + `path.resolve` |
| `generateAssetWithGenAI` | `src/tools/generateAssetWithGenAI.ts` | Claude text → image prompt; Gemini image generation |
| `extractColors` | `src/tools/extractColors.ts` | Sharp pixel sampling, Euclidean RGB distance |
| `checkLogoPresence` | `src/tools/checkLogoPresence.ts` | Claude vision (base64 PNG → multimodal message) |

---

## 2. Tech Stack

| Layer | Technology | Version / Model |
|---|---|---|
| Language | TypeScript | 5.9 |
| Runtime | Node.js | 24 |
| Package manager | pnpm workspaces | — |
| API server | Express | 5 |
| Workflow runner | Custom Mastra-compatible (`mastra-compat.ts`) | — |
| Text LLM | Anthropic claude-sonnet-4-5 | `claude-sonnet-4-5` |
| Image LLM | Google Gemini | `gemini-2.5-flash-image` |
| Image processing | Sharp | — |
| Brief parsing | js-yaml + Zod | — |
| Logging | Pino | structured JSON, dual stream |
| Frontend | Vite + React 19 + Tailwind v4 | — |
| API contract | OpenAPI 3.1 → Orval codegen | React Query hooks + Zod schemas |
| Dev bundler | tsx watch | — |
| Prod bundler | esbuild (ESM) | — |
| Hosting | Replit (path-routed reverse proxy) | — |

**AI client routing:** `AI_INTEGRATIONS_ANTHROPIC_*` env vars are checked first (Replit-managed proxy). Falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` for local development. Identical call sites either way.

```ts
// src/lib/ai-clients.ts
function getAnthropicApiKey(): string {
  return (
    process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ||
    process.env["ANTHROPIC_API_KEY"] ||
    "not-configured"
  );
}

export const TEXT_MODEL = "claude-sonnet-4-5";
export const IMAGE_MODEL = "gemini-2.5-flash-image";
```

---

## 3. Data Flow — Single Campaign Run

### Input: YAML upload or JSON POST body

Example brief (`briefs/sample-jewelry.yaml`):

```yaml
clientName: Sterling Atelier
products:
  - productName: Sterling Silver Moonstone Necklace
    productDescription: "Minimalist pendant for everyday wear, ethically sourced moonstone, hand-finished in small batches"
  - productName: Sterling Silver Hoop Earrings
    productDescription: "Modern thin hoops, hypoallergenic, designed for layering"
targetRegion: North America
targetAudience: "Women 28-42, urban, values craftsmanship and ethical sourcing, shops DTC brands"
campaignMessage: "Carry your story."
brandPalette:
  - "#C0C0C0"
  - "#1A1A1A"
  - "#F5F5F0"
prohibitedWords:
  - free
  - guaranteed
  - miracle
  - cure
```

### Step-by-step data handoff

```
POST /api/generate
  body: { clientName, products[], targetRegion, targetAudience,
          campaignMessage, brandPalette?, prohibitedWords?, logoPath? }
  │
  │  Zod parse → CampaignBrief
  │  createRun(runId) → RunState { status: "running", steps: {} }
  │
  └─► response: { runId: "uuid-v4" }     ← returned to client immediately

--- background ---

Step 1 → loadBrief
  in:  { runId, input: "", isFilePath: false, briefData: CampaignBrief }
  out: { runId, brief: CampaignBrief }

Step 2 → gatherAssets
  in:  { runId, brief }
  out: { runId, brief, assets: {
    "Sterling Silver Moonstone Necklace": "/abs/path/output/generated/sterling-silver-moonstone-necklace.png",
    ...
  }, outputDir }

Step 3 → renderAspectRatios
  in:  { runId, brief, assets, outputDir }
  out: { runId, brief, renders: {
    "Sterling Silver Moonstone Necklace": {
      "1x1":  "/abs/path/output/sterling-silver-moonstone-necklace/1x1/base.png",
      "9x16": "/abs/path/output/.../9x16/base.png",
      "16x9": "/abs/path/output/.../16x9/base.png"
    },
    ...
  }, outputDir }

Step 4 → applyOverlay
  in:  { runId, brief, renders }     ← renders point to base.png
  out: { runId, brief, renders }     ← renders now point to final.png

Step 5 → organizeOutputs
  in:  { runId, brief, renders, outputDir }
  out: { runId, brief, renders, manifest: OutputManifest, outputDir }
  side-effect: writes output/manifest.json

Step 6 → checkCompliance
  in:  { runId, brief, renders, manifest, outputDir }
  out: { runId, manifest, complianceReport, outputDir }
  side-effect: writes output/compliance.json

completeRun(runId, manifest, complianceReport)
  → RunState.status = "done"

--- frontend polling (750 ms interval) ---

GET /api/run/:runId/status
  response: {
    runId, steps, currentMessage, status,
    manifest?,        ← present only when status = "done"
    complianceReport? ← present only when status = "done"
  }
```

---

## 4. File Structure

```
workspace/
├── artifacts/
│   ├── api-server/
│   │   ├── briefs/
│   │   │   └── sample-jewelry.yaml          ← sample campaign brief
│   │   ├── output/                           ← auto-created at runtime
│   │   │   ├── generated/                    ← raw AI images (one PNG per product)
│   │   │   ├── <product-slug>/
│   │   │   │   ├── 1x1/
│   │   │   │   │   ├── base.png              ← step 3 output
│   │   │   │   │   └── final.png             ← step 4 output (served to frontend)
│   │   │   │   ├── 9x16/
│   │   │   │   └── 16x9/
│   │   │   ├── logos/                        ← uploaded logo PNGs
│   │   │   ├── manifest.json                 ← step 5 output
│   │   │   └── compliance.json               ← step 6 output
│   │   ├── logs/                             ← auto-created at runtime
│   │   │   └── run-<ISO-timestamp>.json      ← one file per server start
│   │   └── src/
│   │       ├── index.ts                      ← entry point
│   │       ├── app.ts                        ← Express app setup
│   │       ├── campaign-logger.ts            ← Pino singleton + cost helpers
│   │       ├── progress-bus.ts               ← EventEmitter bus
│   │       ├── routes/
│   │       │   ├── index.ts
│   │       │   └── campaign.ts               ← all API routes + run store wiring
│   │       ├── schemas/
│   │       │   └── campaignBrief.ts          ← CampaignBriefSchema (source of truth)
│   │       ├── lib/
│   │       │   ├── ai-clients.ts             ← Anthropic + Gemini client factories
│   │       │   ├── paths.ts                  ← centralised OUTPUT_DIR / BRIEFS_DIR / LOGS_DIR
│   │       │   ├── logger.ts                 ← request-level Pino logger
│   │       │   └── runStore.ts               ← in-memory Map<runId, RunState>
│   │       ├── workflow/
│   │       │   ├── mastra-compat.ts          ← createStep / createWorkflow implementation
│   │       │   ├── campaignWorkflow.ts        ← 6-step sequential pipeline declaration
│   │       │   └── steps/
│   │       │       ├── loadBrief.ts
│   │       │       ├── gatherAssets.ts
│   │       │       ├── renderAspectRatios.ts
│   │       │       ├── applyOverlay.ts
│   │       │       ├── organizeOutputs.ts
│   │       │       └── checkCompliance.ts
│   │       ├── agents/
│   │       │   ├── assetGatherer.ts
│   │       │   └── complianceChecker.ts
│   │       └── tools/
│   │           ├── checkLocalAsset.ts
│   │           ├── generateAssetWithGenAI.ts
│   │           ├── extractColors.ts
│   │           └── checkLogoPresence.ts
│   └── frontend/
│       └── src/
│           └── App.tsx                       ← single-page React app
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml                      ← OpenAPI 3.1 source of truth
│   ├── api-client-react/
│   │   └── src/generated/                    ← Orval-generated React Query hooks
│   └── api-zod/
│       └── src/generated/                    ← Orval-generated Zod schemas
└── pnpm-workspace.yaml
```

---

## 5. Observability Implementation

### Pino setup (`src/campaign-logger.ts`)

```ts
import pino from "pino";
import fs from "fs";
import path from "path";
import { LOGS_DIR } from "./lib/paths.js";

fs.mkdirSync(LOGS_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = path.resolve(LOGS_DIR, `run-${timestamp}.json`);

export const campaignLogger = pino(
  {
    level: "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { stream: process.stdout, level: "debug" },
    {
      stream: pino.destination({ dest: logFile, sync: false }),
      level: "debug",
    },
  ])
);
```

One log file per server start (timestamped). Async writes to avoid blocking the event loop. Dual sink: stdout (for container log aggregation) + newline-delimited JSON file (for local inspection).

### Log helpers

```ts
export function logStep(
  stepName: string,
  message: string,
  extra: Record<string, unknown> = {}
): void {
  campaignLogger.info({ step: stepName, ...extra }, message);
}

export function logStepError(
  stepName: string,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  campaignLogger.error({ step: stepName, error, ...extra }, `Error in ${stepName}`);
}
```

### What a log entry looks like (NDJSON)

```json
{
  "level": 30,
  "time": "2026-05-14T12:34:56.789Z",
  "step": "generateAssetWithGenAI",
  "msg": "Claude prompt crafted",
  "product": "Sterling Silver Moonstone Necklace",
  "inputTokens": 187,
  "outputTokens": 94,
  "costUSD": 0.001971,
  "model": "claude-sonnet-4-5"
}
```

Fields captured per AI call: `step`, `product`, `inputTokens`, `outputTokens`, `costUSD`, `model`. Fields captured per render: `width`, `height`, `path`. Fields captured per compliance check: `colorItems`, `logoItems`, `legalPassed`.

---

## 6. Cost Tracking Implementation

### Rate constants (`src/campaign-logger.ts`)

```ts
export const COSTS = {
  CLAUDE_SONNET_INPUT_PER_TOKEN:  3  / 1_000_000,  // $3.00 / 1M input tokens
  CLAUDE_SONNET_OUTPUT_PER_TOKEN: 15 / 1_000_000,  // $15.00 / 1M output tokens
  IMAGE_PER_GENERATION:           0.04,              // $0.04 / image (estimate)
};

export function calcClaudeCost(inputTokens: number, outputTokens: number): number {
  return (
    inputTokens  * COSTS.CLAUDE_SONNET_INPUT_PER_TOKEN +
    outputTokens * COSTS.CLAUDE_SONNET_OUTPUT_PER_TOKEN
  );
}

export function calcImageCost(imageCount: number): number {
  return imageCount * COSTS.IMAGE_PER_GENERATION;
}
```

### Where it's called

**Prompt-crafting call** in `generateAssetWithGenAI`:
```ts
const claudeCost = calcClaudeCost(
  promptResponse.usage.input_tokens,
  promptResponse.usage.output_tokens
);

logStep("generateAssetWithGenAI", "Claude prompt crafted", {
  product: product.productName,
  inputTokens: promptResponse.usage.input_tokens,
  outputTokens: promptResponse.usage.output_tokens,
  costUSD: claudeCost,
  model: TEXT_MODEL,
});
```

**Logo vision call** in `checkLogoPresence`:
```ts
const cost = calcClaudeCost(
  response.usage.input_tokens,
  response.usage.output_tokens
);

logStep("checkLogoPresence", "Logo check complete", {
  imagePath,
  costUSD: cost,
  model: TEXT_MODEL,
});
```

**What is not implemented:** There is no cumulative campaign cost aggregator. Each AI call logs its own cost to the Pino log file, but there is no sum written to the manifest or compliance report, and no field surfaced in the API response or UI. To reconstruct total campaign cost you would parse the NDJSON log and sum `costUSD` fields for a given `runId`. Gemini image generation cost is logged as `0` because the Replit-managed integration does not return token usage data.

---

## 7. Compliance Agent Implementation

### Color compliance — `src/tools/extractColors.ts`

**Real implementation.** Uses Sharp to sample actual pixel data.

```ts
export async function extractColors(
  imagePath: string,
  brandPalette: string[] = []
): Promise<ExtractColorsResult> {
  const { data, info } = await sharp(imagePath)
    .resize(50, 50, { fit: "fill" })  // downsample for speed
    .raw()
    .toBuffer({ resolveWithObject: true });

  const colorCounts = new Map<string, number>();
  const channels = info.channels;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    // Quantize to 32-step buckets to merge near-identical colors
    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;

    const hex = rgbToHex(Math.min(qr, 255), Math.min(qg, 255), Math.min(qb, 255));
    colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
  }

  const sorted = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hex]) => hex);

  // Score: average proximity of each brand color to the nearest dominant image color
  let paletteScore = 0;
  if (brandPalette.length > 0) {
    const MAX_DISTANCE = Math.sqrt(3 * 255 * 255);  // max possible Euclidean RGB distance
    let totalScore = 0;
    for (const brandColor of brandPalette) {
      const closestDistance = Math.min(
        ...sorted.map((c) => colorDistance(c, brandColor))
      );
      totalScore += 1 - closestDistance / MAX_DISTANCE;
    }
    paletteScore = totalScore / brandPalette.length;
  }

  return { dominantColors: sorted, paletteScore };
}
```

Pass threshold: `paletteScore >= 0.3`. Score is normalized 0–1. If no `brandPalette` is provided in the brief, all images score 0 / pass = false (because `paletteScore` stays 0 and 0 < 0.3). This is a known bug — when no palette is specified, compliance should be treated as N/A rather than failed.

### Logo detection — `src/tools/checkLogoPresence.ts`

**Real Claude vision call.** Each image is base64-encoded and sent as a multimodal message.

```ts
export async function checkLogoPresence(
  imagePath: string
): Promise<CheckLogoPresenceResult> {
  const anthropic = createAnthropicClient();
  const base64Image = fs.readFileSync(imagePath).toString("base64");

  const response = await anthropic.messages.create({
    model: TEXT_MODEL,                // claude-sonnet-4-5
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: base64Image },
          },
          {
            type: "text",
            text: 'Is there a brand logo, text logo, or watermark visible in this image? Answer with JSON only: {"logoPresent": true/false, "reasoning": "brief explanation"}',
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]) as CheckLogoPresenceResult;
  }
  return { logoPresent: false, reasoning: "Could not parse vision response" };
}
```

This is a real vision call per image. For a 2-product run with 3 ratios each, that is **6 separate Claude multimodal requests** at compliance time. At claude-sonnet-4-5 pricing, each costs roughly $0.01–$0.03 depending on image token count (1080×1080 PNG ≈ 1,300–1,800 image tokens).

### Legal/prohibited word scan — `src/agents/complianceChecker.ts`

```ts
const legalMatches: string[] = [];
const msg = brief.campaignMessage.toLowerCase();
for (const word of brief.prohibitedWords || []) {
  if (msg.includes(word.toLowerCase())) {
    legalMatches.push(word);
  }
}

const legalCompliance: LegalCompliance = {
  passed: legalMatches.length === 0,
  matches: legalMatches,
};
```

**Scope:** Scans only `campaignMessage`. Does not scan product names, product descriptions, or any overlay text beyond the campaign message. No regex, no stemming — pure `String.prototype.includes`.

---

## 8. Image Generation

### Two-stage pipeline: Claude text → Gemini image

**Stage 1 — Claude crafts the image prompt** (`src/tools/generateAssetWithGenAI.ts`):

```ts
const promptResponse = await anthropic.messages.create({
  model: TEXT_MODEL,   // claude-sonnet-4-5
  max_tokens: 512,
  messages: [
    {
      role: "user",
      content: `Create a detailed image generation prompt for this product:

Product: ${product.productName}
Description: ${product.productDescription}
Brand: ${brief.clientName}
Target audience: ${brief.targetAudience}
Brand palette: ${brief.brandPalette?.join(", ") || "neutral tones"}

Requirements:
- Premium, minimalist aesthetic
- Clean studio photography style
- Product should be the focal point
- Lighting should enhance the product's quality
- Background should be clean and on-brand
- Suitable for social media advertising

Return ONLY the image generation prompt, nothing else.`,
    },
  ],
});
```

**Stage 2 — Gemini generates the image:**

```ts
const { b64_json } = await generateImage(imagePrompt);
fs.writeFileSync(assetPath, Buffer.from(b64_json, "base64"));
```

`generateImage` is provided by the Replit-managed Gemini integration (`@workspace/integrations-gemini-ai/image`). It calls `gemini-2.5-flash-image` and returns a base64 PNG.

**One call per product.** The raw generated image is saved as `output/generated/<slug>.png`. This is the master asset for all three aspect ratios.

### Aspect ratio handling — post-processing, not separate calls

```ts
export const ASPECT_RATIOS = {
  "1x1":  { width: 1080, height: 1080 },
  "9x16": { width: 1080, height: 1920 },
  "16x9": { width: 1920, height: 1080 },
} as const;

// Applied to every (product, ratio) combination:
await sharp(assetPath)
  .resize(dims.width, dims.height, {
    fit: "cover",
    position: "centre",
  })
  .png()
  .toFile(outPath);
```

**One AI image generation call per product. Three Sharp resize crops per product.** There is no aspect-ratio-aware prompt or native multi-ratio generation — the single generated image is center-cropped by Sharp. For portrait (9:16) ratios this can clip significant image content; acceptable for a POC, not acceptable for production where the image subject could be cut off.

---

## 9. Brief Parsing

### Zod schema (`src/schemas/campaignBrief.ts`)

```ts
export const ProductSchema = z.object({
  productName:        z.string().min(1),
  productDescription: z.string().min(1),
  localAssetPath:     z.string().optional(),
});

export const CampaignBriefSchema = z.object({
  clientName:      z.string().min(1),
  products:        z.array(ProductSchema).min(2),
  targetRegion:    z.string().min(1),
  targetAudience:  z.string().min(1),
  campaignMessage: z.string().min(1),
  brandPalette:    z.array(z.string()).optional(),
  prohibitedWords: z.array(z.string()).optional(),
  logoPath:        z.string().optional(),
});
```

`products` requires at least 2 entries. All string fields require at least 1 character. `brandPalette`, `prohibitedWords`, and `logoPath` are optional.

### Three input paths in `loadBrief`

```ts
if (briefData) {
  // Path A: JSON already parsed — used when POST /api/generate sends a body
  parsed = briefData;
} else if (isFilePath) {
  // Path B: file path provided — used for server-side CLI / testing
  const content = fs.readFileSync(input, "utf-8");
  if (input.endsWith(".yaml") || input.endsWith(".yml")) {
    parsed = yaml.load(content);   // js-yaml
  } else {
    parsed = JSON.parse(content);
  }
} else {
  // Path C: raw string — try JSON first, fall back to YAML
  try {
    parsed = JSON.parse(input);
  } catch {
    parsed = yaml.load(input);
  }
}

const brief = CampaignBriefSchema.parse(parsed);  // throws ZodError if invalid
```

**Malformed brief handling:**

- Zod `parse` throws a `ZodError` with a full path-annotated error list.
- In `loadBrief`: the error is caught, logged via `logStepError`, a `progress` event with `status: "error"` is emitted to the run store, and the error is re-thrown — which surfaces to `mastra-compat`'s `start()` runner and is caught as `result.error`.
- In `POST /api/generate`: if `CampaignBriefSchema.parse(req.body)` throws before the run is created, the route returns `400` with the Zod error message serialized as a string. Zod's full issue array (path, code, message per field) is not forwarded to the client — it becomes a single concatenated string. Production would want to pass `err.errors` directly.

---

## 10. Known Limitations

### Hardcoded / not yet parameterized

| Item | Current state | What production needs |
|---|---|---|
| Output directory | Single global `output/` dir | Per-run scoped dir (e.g. `output/<runId>/`) — concurrent runs overwrite each other |
| Log file | One file per server start | One file per run, or a structured logging backend (Datadog, CloudWatch) |
| Cost rates | Hardcoded `$3/$15/$0.04` constants | Config-driven, updated when model pricing changes |
| Compliance pass threshold | `paletteScore >= 0.3` hardcoded | Per-client configurable threshold |
| Image resize strategy | `fit: cover, position: centre` always | Per-ratio strategy (e.g. `contain` + background fill for 9:16) |
| Logo size + placement | 18% canvas width, top-right of bar | Brief-configurable logo position + max-size |
| Run store | In-memory `Map` with 1-hour TTL | Persistent store (Redis / Postgres) — server restart loses all in-flight runs |
| Concurrency | No per-run isolation | Queue (BullMQ) to control parallel AI calls and avoid rate-limit errors |

### What is real vs mocked

| Component | Real? | Notes |
|---|---|---|
| Claude text calls (prompt crafting) | ✅ Real | Full API calls with token usage captured |
| Gemini image generation | ✅ Real | Actual `gemini-2.5-flash-image` via Replit integration |
| Sharp image resizing | ✅ Real | Actual pixel operations on actual PNG files |
| SVG overlay compositing | ✅ Real | Real Sharp composite; word-wrapped text |
| Color extraction | ✅ Real | Real Sharp pixel sampling + Euclidean distance scoring |
| Logo vision check | ✅ Real | Real Claude multimodal call per rendered image |
| Legal word scan | ✅ Real | String scan — intentionally simple |
| Cumulative cost tracking | ❌ Not implemented | Per-call costs logged; no aggregation or API surface |
| Concurrent run isolation | ❌ Not implemented | All runs write to the same `output/` directory |
| Zod error serialization | ⚠️ Partial | Zod error flattened to string on 400 response; full issue array not returned |
| 9:16 image quality | ⚠️ Degraded | Single generated image center-cropped; subject may be cut |
| Brand palette compliance with no palette | ⚠️ Bug | Score stays 0 → all images "fail" when no palette is specified |
