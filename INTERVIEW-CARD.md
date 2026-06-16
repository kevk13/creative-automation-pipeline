# Creative Automation Pipeline — Interview Card

> Glance before the call. Top = say it cold. Bottom = answers to the probes.

## The beat (say in one breath)

> Six-step creative pipeline. Hand it a campaign brief (YAML/JSON), get back a full set of
> compliance-checked ad creatives. **Load brief → gather assets → render 3 ratios → apply overlay
> → organize outputs → check compliance.** Every step has a Zod input/output contract, two agents
> do the AI work (one sources images, one checks compliance), and every AI call logs tokens, cost,
> latency. `POST /generate` returns a run ID; the front end polls; you end with the images plus
> `manifest.json` and `compliance.json`.

## The six steps (one line each)

1. **loadBrief** — parse + Zod-validate. Bad brief fails here, before spending a cent on AI.
2. **gatherAssets** — AssetGatherer agent: reuse local asset if present, else Claude writes prompt → Gemini renders.
3. **renderRatios** — Sharp resizes to 1:1, 9:16, 16:9.
4. **applyOverlay** — Sharp SVG composite of the message bar; font auto-shrinks until text fits.
5. **organizeOutputs** — StorageAdapter saves each file + writes manifest. Local default, Dropbox via one env var.
6. **checkCompliance** — ComplianceChecker agent: palette match (pixel sampling), logo presence (Claude vision), prohibited-words regex.

## The 3 probes (and the answer)

- **Why polling, not SSE?** → SSE was first design, but the Replit proxy buffers chunks till response close. Polling every 750ms is simple, proxy-safe, `curl`-debuggable.
- **Why two bounded agents?** → Single responsibility. AssetGatherer sources, ComplianceChecker verifies — neither does both. Typed tool contracts, no silent failures.
- **How do you avoid vendor lock-in?** → Seams: Mastra-compat runner (swap to `@mastra/core`, zero step changes), pluggable StorageAdapter (S3/Azure scaffolded), Gemini→Firefly is one tool swap, Pino logs ship to Datadog/CloudWatch unchanged.

## The closer (the line that lands it)

> Deliberate 2-3 hour POC. Auth, queuing, multi-tenancy are **explicitly deferred and documented,
> not half-built.** File-based manifests map straight to Postgres tables when it's time to make it real.

## Stack one-liner

TypeScript end-to-end · Express 5 + polling · Claude (text/vision) + Gemini (image) · Sharp (resize/composite) · Zod at every boundary · Pino cost logging · no DB (file manifests).
