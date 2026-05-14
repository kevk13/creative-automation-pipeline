import { useState, useRef, useCallback } from "react";
import { useGetManifest, useGetCompliance } from "@workspace/api-client-react";

type Product = {
  productName: string;
  productDescription: string;
  localAssetPath?: string;
};

type CampaignBrief = {
  clientName: string;
  products: Product[];
  targetRegion: string;
  targetAudience: string;
  campaignMessage: string;
  brandPalette?: string[];
  prohibitedWords?: string[];
};

type ProgressEvent = {
  type: "started" | "progress" | "complete" | "error";
  step?: string;
  status?: "running" | "complete" | "error";
  message?: string;
  error?: string;
  manifest?: unknown;
  complianceReport?: unknown;
};

type PipelineStatus = "idle" | "running" | "done" | "error";

const RATIOS = ["1x1", "9x16", "16x9"] as const;
type Ratio = (typeof RATIOS)[number];

const RATIO_LABELS: Record<Ratio, string> = {
  "1x1": "1:1 Square",
  "9x16": "9:16 Portrait",
  "16x9": "16:9 Landscape",
};

const STEP_LABELS: Record<string, string> = {
  loadBrief: "Loading brief",
  gatherAssets: "Generating product images",
  renderAspectRatios: "Rendering aspect ratios",
  applyOverlay: "Applying campaign overlay",
  organizeOutputs: "Organizing outputs",
  checkCompliance: "Running compliance checks",
};

function parseYaml(text: string): CampaignBrief {
  const lines = text.split("\n");
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let inArray = false;
  let arrayKey = "";
  let currentArrayItem: Record<string, unknown> | null = null;
  const arrays: Record<string, unknown[]> = {};

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      if (currentArrayItem && arrayKey) {
        if (!arrays[arrayKey]) arrays[arrayKey] = [];
        arrays[arrayKey]!.push(currentArrayItem);
        currentArrayItem = null;
      }
      inArray = false;

      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        currentKey = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        if (val) {
          result[currentKey] = val.replace(/^["']|["']$/g, "");
        } else {
          inArray = true;
          arrayKey = currentKey;
          arrays[currentKey] = [];
        }
      }
    } else if (indent === 2 && inArray) {
      if (line.trimStart().startsWith("-")) {
        if (currentArrayItem) {
          arrays[arrayKey]!.push(currentArrayItem);
        }
        const afterDash = line.replace(/^\s*-\s*/, "");
        if (afterDash.includes(":")) {
          const key = afterDash.slice(0, afterDash.indexOf(":")).trim();
          const val = afterDash.slice(afterDash.indexOf(":") + 1).trim();
          currentArrayItem = { [key]: val.replace(/^["']|["']$/g, "") };
        } else if (afterDash) {
          currentArrayItem = null;
          arrays[arrayKey]!.push(afterDash.replace(/^["']|["']$/g, ""));
        } else {
          currentArrayItem = {};
        }
      } else if (currentArrayItem) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const val = line.slice(colonIdx + 1).trim();
          currentArrayItem[key] = val.replace(/^["']|["']$/g, "");
        }
      }
    } else if (indent >= 4 && currentArrayItem) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        currentArrayItem[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }

  if (currentArrayItem && arrayKey) {
    if (!arrays[arrayKey]) arrays[arrayKey] = [];
    arrays[arrayKey]!.push(currentArrayItem);
  }

  return { ...result, ...arrays } as CampaignBrief;
}

function BriefUpload({
  onBriefParsed,
}: {
  onBriefParsed: (brief: CampaignBrief) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          let parsed: CampaignBrief;
          if (file.name.endsWith(".json")) {
            parsed = JSON.parse(text) as CampaignBrief;
          } else {
            parsed = parseYaml(text);
          }
          if (!parsed.clientName || !parsed.products?.length) {
            throw new Error("Brief must include clientName and at least 2 products");
          }
          setBrief(parsed);
          setError(null);
          onBriefParsed(parsed);
        } catch (err) {
          setError(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      reader.readAsText(file);
    },
    [onBriefParsed]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-slate-600 bg-slate-50"
            : "border-slate-300 hover:border-slate-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".yaml,.yml,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="text-4xl mb-3">📄</div>
        <p className="text-slate-600 font-medium">
          Drop your campaign brief here
        </p>
        <p className="text-slate-400 text-sm mt-1">
          Supports YAML or JSON — click to browse
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {brief && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">
            Brief Preview
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Client</span>
              <p className="font-medium text-slate-800">{brief.clientName}</p>
            </div>
            <div>
              <span className="text-slate-500">Region</span>
              <p className="font-medium text-slate-800">{brief.targetRegion}</p>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500">Audience</span>
              <p className="font-medium text-slate-800">{brief.targetAudience}</p>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500">Campaign Message</span>
              <p className="font-medium text-slate-800 text-base italic">
                &ldquo;{brief.campaignMessage}&rdquo;
              </p>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500">Products ({brief.products.length})</span>
              <div className="mt-1 space-y-1">
                {brief.products.map((p, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded p-2">
                    <p className="font-medium text-slate-800 text-sm">{p.productName}</p>
                    <p className="text-slate-500 text-xs">{p.productDescription}</p>
                  </div>
                ))}
              </div>
            </div>
            {brief.brandPalette && (
              <div className="col-span-2">
                <span className="text-slate-500">Brand Palette</span>
                <div className="flex gap-2 mt-1">
                  {brief.brandPalette.map((color, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div
                        className="w-5 h-5 rounded border border-slate-200"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs text-slate-500">{color}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ steps }: { steps: Record<string, "running" | "complete" | "error"> }) {
  const stepOrder = [
    "loadBrief",
    "gatherAssets",
    "renderAspectRatios",
    "applyOverlay",
    "organizeOutputs",
    "checkCompliance",
  ];

  return (
    <div className="space-y-2">
      {stepOrder.map((step) => {
        const status = steps[step];
        return (
          <div key={step} className="flex items-center gap-3">
            <div
              className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${
                status === "complete"
                  ? "bg-green-500 text-white"
                  : status === "running"
                  ? "bg-blue-500 text-white animate-pulse"
                  : status === "error"
                  ? "bg-red-500 text-white"
                  : "bg-slate-200"
              }`}
            >
              {status === "complete" ? "✓" : status === "error" ? "✕" : status === "running" ? "…" : ""}
            </div>
            <span
              className={`text-sm ${
                status === "complete"
                  ? "text-green-700 font-medium"
                  : status === "running"
                  ? "text-blue-700 font-medium"
                  : status === "error"
                  ? "text-red-600"
                  : "text-slate-400"
              }`}
            >
              {STEP_LABELS[step] ?? step}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ResultsGallery({ manifest, complianceReport }: { manifest: any; complianceReport: any }) {
  const [lightbox, setLightbox] = useState<{ slug: string; ratio: Ratio } | null>(null);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const byProduct: Record<string, { productName: string; productSlug: string; ratios: Ratio[] }> = {};
  for (const entry of manifest?.entries ?? []) {
    if (!byProduct[entry.productSlug]) {
      byProduct[entry.productSlug] = {
        productName: entry.productName,
        productSlug: entry.productSlug,
        ratios: [],
      };
    }
    byProduct[entry.productSlug]!.ratios.push(entry.aspectRatio as Ratio);
  }

  const getImageUrl = (slug: string, ratio: Ratio) =>
    `${BASE}/api/output/${slug}/${ratio}/final.png`;

  const colorBySlug = (slug: string, ratio: Ratio) => {
    const items: any[] = complianceReport?.colorCompliance ?? [];
    return items.find((i: any) => i.aspectRatio === ratio && i.imagePath?.includes(`/${slug}/`));
  };

  return (
    <div className="space-y-10">
      {Object.values(byProduct).map((product) => (
        <div key={product.productSlug} className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-200 pb-2">
            {product.productName}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {(product.ratios.length ? product.ratios : RATIOS).map((ratio) => (
              <div key={ratio} className="space-y-2">
                <div
                  className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 cursor-pointer group"
                  style={{ aspectRatio: "1/1" }}
                  onClick={() => setLightbox({ slug: product.productSlug, ratio })}
                >
                  <img
                    src={getImageUrl(product.productSlug, ratio)}
                    alt={`${product.productName} ${ratio}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
                <div className="text-xs text-center text-slate-500 font-medium">
                  {RATIO_LABELS[ratio] ?? ratio}
                </div>
                <a
                  href={getImageUrl(product.productSlug, ratio)}
                  download={`${product.productSlug}-${ratio}.png`}
                  className="block text-center text-xs text-slate-500 hover:text-slate-700 underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </a>
                {(() => {
                  const c = colorBySlug(product.productSlug, ratio);
                  if (!c) return null;
                  return (
                    <div
                      className={`text-xs text-center px-2 py-1 rounded ${
                        c.pass ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      Color match {Math.round(c.score * 100)}%
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      ))}

      {complianceReport && (
        <div className="border border-slate-200 rounded-lg p-6 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800">Compliance Report</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-600 mb-2">Color Compliance</div>
              <div className="space-y-1">
                {complianceReport.colorCompliance?.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {item.productName?.split(" ").slice(-1)[0]} {item.aspectRatio}
                    </span>
                    <span
                      className={`font-medium px-1.5 py-0.5 rounded ${
                        item.pass ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {item.pass ? "Pass" : "Warn"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-600 mb-2">Logo Presence (Advisory)</div>
              <div className="space-y-1">
                {complianceReport.logoCompliance?.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {item.productName?.split(" ").slice(-1)[0]} {item.aspectRatio}
                    </span>
                    <span className="font-medium text-slate-500 px-1.5 py-0.5 rounded bg-slate-100">
                      {item.logoPresent ? "Found" : "None"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-600 mb-2">Legal Compliance</div>
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm font-medium ${
                  complianceReport.legalCompliance?.passed
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                <span>{complianceReport.legalCompliance?.passed ? "✓ Passed" : "✕ Failed"}</span>
              </div>
              {!complianceReport.legalCompliance?.passed && (
                <div className="mt-2 text-xs text-red-600">
                  Flagged: {complianceReport.legalCompliance?.matches?.join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setLightbox(null)}
        >
          <div className="max-h-full max-w-full overflow-auto" onClick={(e) => e.stopPropagation()}>
            <img
              src={getImageUrl(lightbox.slug, lightbox.ratio)}
              alt="Enlarged preview"
              className="max-h-screen max-w-screen object-contain rounded"
            />
            <button
              className="absolute top-4 right-4 text-white text-2xl font-bold hover:opacity-70"
              onClick={() => setLightbox(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [steps, setSteps] = useState<Record<string, "running" | "complete" | "error">>({});
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manifest, setManifest] = useState<any>(null);
  const [complianceReport, setComplianceReport] = useState<any>(null);

  const { refetch: refetchManifest } = useGetManifest({ query: { enabled: false } });
  const { refetch: refetchCompliance } = useGetCompliance({ query: { enabled: false } });

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const runPipeline = useCallback(async () => {
    if (!brief) return;
    setStatus("running");
    setSteps({});
    setErrorMessage(null);
    setManifest(null);
    setComplianceReport(null);
    setCurrentMessage("Starting pipeline...");

    try {
      const res = await fetch(`${BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const event: ProgressEvent = JSON.parse(part.slice(6));
            if (event.type === "progress") {
              if (event.step && event.status) {
                setSteps((prev) => ({
                  ...prev,
                  [event.step!]: event.status as "running" | "complete" | "error",
                }));
              }
              if (event.message) setCurrentMessage(event.message);
            } else if (event.type === "complete") {
              setManifest(event.manifest);
              setComplianceReport(event.complianceReport);
              setStatus("done");
              setCurrentMessage("Pipeline complete");
              refetchManifest();
              refetchCompliance();
            } else if (event.type === "error") {
              setErrorMessage(event.error ?? "Unknown error");
              setStatus("error");
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      if (status === "running") setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [brief, BASE, refetchManifest, refetchCompliance, status]);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Creative Automation Pipeline
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Generate localized social ad creatives from a campaign brief
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-800">1. Upload Campaign Brief</h2>
              <p className="text-sm text-slate-500 mt-1">
                Upload a YAML or JSON file with your campaign details
              </p>
            </div>
            <BriefUpload onBriefParsed={setBrief} />
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-800">2. Run Pipeline</h2>
              <p className="text-sm text-slate-500 mt-1">
                6-step Mastra workflow: load → gather → render → overlay → organize → compliance
              </p>
            </div>

            <button
              onClick={runPipeline}
              disabled={!brief || status === "running"}
              className={`w-full py-3 px-6 rounded-lg text-sm font-semibold transition-all ${
                !brief
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : status === "running"
                  ? "bg-blue-100 text-blue-500 cursor-not-allowed"
                  : status === "done"
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-slate-900 text-white hover:bg-slate-700"
              }`}
            >
              {status === "running"
                ? "Running..."
                : status === "done"
                ? "Run Again"
                : "Run Pipeline"}
            </button>

            {status !== "idle" && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
                {currentMessage && (
                  <p className="text-sm text-slate-600 font-medium">{currentMessage}</p>
                )}
                <ProgressBar steps={steps} />
              </div>
            )}

            {errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-red-700">Pipeline Error</p>
                <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
              </div>
            )}
          </div>
        </section>

        {status === "done" && manifest && (
          <section className="space-y-6">
            <div className="border-t border-slate-200 pt-8">
              <h2 className="text-base font-semibold text-slate-800 mb-1">3. Results Gallery</h2>
              <p className="text-sm text-slate-500">
                {manifest.entries?.length ?? 0} creatives generated — click to enlarge, download to save
              </p>
            </div>
            <ResultsGallery manifest={manifest} complianceReport={complianceReport} />
          </section>
        )}
      </main>
    </div>
  );
}
