import { useState, useRef, useCallback } from "react";
import { useGetManifest, useGetCompliance } from "@workspace/api-client-react";

type Product = {
  productName: string;
  productDescription: string;
  localAssetPath?: string;
  existingAssetPath?: string;
};

type CampaignBrief = {
  clientName: string;
  products: Product[];
  targetRegion: string;
  targetAudience: string;
  campaignMessage: string;
  brandPalette?: string[];
  prohibitedWords?: string[];
  logoPath?: string;
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

const ALL_STEPS = Object.keys(STEP_LABELS);

function parseYaml(text: string): CampaignBrief {
  const lines = text.split("\n");
  const result: Record<string, unknown> = {};
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
        arrays[arrayKey]!.push(currentArrayItem);
        currentArrayItem = null;
      }
      inArray = false;
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        if (val) {
          result[key] = val.replace(/^["']|["']$/g, "");
        } else {
          inArray = true;
          arrayKey = key;
          arrays[key] = [];
        }
      }
    } else if (indent === 2 && inArray) {
      if (line.trimStart().startsWith("-")) {
        if (currentArrayItem) arrays[arrayKey]!.push(currentArrayItem);
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
  if (currentArrayItem && arrayKey) arrays[arrayKey]!.push(currentArrayItem);
  return { ...result, ...arrays } as CampaignBrief;
}

function BriefUpload({ onBriefParsed }: { onBriefParsed: (brief: CampaignBrief) => void }) {
  const [dragging, setDragging] = useState(false);
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<string[]>([]);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  useState(() => {
    fetch(`${BASE}/api/samples`)
      .then((r) => r.json())
      .then((d: { samples: string[] }) => setSamples(d.samples ?? []))
      .catch(() => {});
  });

  const parseBriefText = useCallback((text: string, filename: string): CampaignBrief => {
    const parsed = filename.endsWith(".json")
      ? (JSON.parse(text) as CampaignBrief)
      : parseYaml(text);
    if (!parsed.clientName || !parsed.products?.length) {
      throw new Error("Brief must include clientName and at least one product");
    }
    return parsed;
  }, []);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseBriefText(e.target?.result as string, file.name);
        setBrief(parsed);
        setError(null);
        onBriefParsed(parsed);
      } catch (err) {
        setError(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  }, [onBriefParsed, parseBriefText]);

  const loadSample = useCallback(async (filename: string) => {
    setLoadingSample(filename);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/samples/${filename}`);
      if (!res.ok) throw new Error(`Failed to load ${filename}`);
      const text = await res.text();
      const parsed = parseBriefText(text, filename);
      setBrief(parsed);
      onBriefParsed(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSample(null);
    }
  }, [BASE, onBriefParsed, parseBriefText]);

  const PREFERRED_SAMPLES = [
    "vitara-generate.yaml",
    "vitara-reuse.yaml",
    "sample-jewelry.yaml",
    "sterling-reuse.yaml",
  ];

  const SAMPLE_LABELS: Record<string, string> = {
    "vitara-generate.yaml": "Vitara Naturals · Generate",
    "vitara-reuse.yaml": "Vitara Naturals · Reuse",
    "sample-jewelry.yaml": "Sterling Atelier · Generate",
    "sterling-reuse.yaml": "Sterling Atelier · Reuse",
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          dragging ? "border-slate-600 bg-slate-50" : "border-slate-300 hover:border-slate-400"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".yaml,.yml,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <div className="text-4xl mb-3">📄</div>
        <p className="text-slate-600 font-medium">Drop your campaign brief here</p>
        <p className="text-slate-400 text-sm mt-1">Supports YAML or JSON — click to browse</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Or load a sample</p>
        <div className="grid grid-cols-2 gap-2">
          {PREFERRED_SAMPLES.filter((s) => samples.length === 0 || samples.includes(s)).map((s) => {
            const isReuse = s.includes("reuse");
            return (
              <button
                key={s}
                onClick={() => loadSample(s)}
                disabled={loadingSample !== null}
                className="text-left px-3 py-2 rounded-lg border bg-white transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 border-slate-200 hover:border-slate-400 text-slate-600"
              >
                <span>{loadingSample === s ? "Loading…" : (SAMPLE_LABELS[s] ?? s)}</span>
                {loadingSample !== s && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isReuse ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {isReuse ? "Reuse" : "Generate"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>
      )}

      {brief && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Brief Preview</h3>
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
              <span className="text-slate-500">Campaign Message</span>
              <p className="font-medium text-slate-800 text-base italic">&ldquo;{brief.campaignMessage}&rdquo;</p>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500">Products ({brief.products.length})</span>
              <div className="mt-1 space-y-1">
                {brief.products.map((p, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded p-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 text-sm">{p.productName}</p>
                      <p className="text-slate-500 text-xs">{p.productDescription}</p>
                    </div>
                    <span className={`flex-shrink-0 mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      p.existingAssetPath
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {p.existingAssetPath ? "Reuse" : "Generate"}
                    </span>
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
                      <div className="w-5 h-5 rounded border border-slate-200" style={{ backgroundColor: color }} />
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

function LogoUpload({ onLogoUploaded }: { onLogoUploaded: (path: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload a PNG, SVG, or JPEG image.");
      return;
    }
    setError(null);
    setUploading(true);
    setDone(false);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dataUrl = e.target?.result as string;
        setPreview(dataUrl);

        const res = await fetch(`${BASE}/api/upload-logo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: dataUrl }),
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const { logoPath } = (await res.json()) as { logoPath: string };
        onLogoUploaded(logoPath);
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [BASE, onLogoUploaded]);

  return (
    <div className="space-y-2">
      <div
        className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors flex items-center gap-4 ${
          dragging ? "border-slate-600 bg-slate-50" : done ? "border-green-400 bg-green-50" : "border-slate-300 hover:border-slate-400"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {preview ? (
          <img src={preview} alt="Logo preview" className="h-12 w-12 object-contain rounded border border-slate-200 bg-white flex-shrink-0" />
        ) : (
          <div className="text-2xl flex-shrink-0">🏷️</div>
        )}

        <div className="text-left">
          {uploading ? (
            <p className="text-slate-600 text-sm font-medium">Uploading…</p>
          ) : done ? (
            <p className="text-green-700 text-sm font-medium">✓ Logo ready — will appear on all creatives</p>
          ) : (
            <>
              <p className="text-slate-600 text-sm font-medium">Drop brand logo here (optional)</p>
              <p className="text-slate-400 text-xs mt-0.5">PNG with transparent background works best</p>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}

function ProgressBar({ steps }: { steps: Record<string, "running" | "complete" | "error"> }) {
  const stepOrder = ["loadBrief", "gatherAssets", "renderAspectRatios", "applyOverlay", "organizeOutputs", "checkCompliance"];
  return (
    <div className="space-y-2">
      {stepOrder.map((step) => {
        const status = steps[step];
        return (
          <div key={step} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${
              status === "complete" ? "bg-green-500 text-white"
              : status === "running" ? "bg-blue-500 text-white animate-pulse"
              : status === "error" ? "bg-red-500 text-white"
              : "bg-slate-200"
            }`}>
              {status === "complete" ? "✓" : status === "error" ? "✕" : status === "running" ? "…" : ""}
            </div>
            <span className={`text-sm ${
              status === "complete" ? "text-green-700 font-medium"
              : status === "running" ? "text-blue-700 font-medium"
              : status === "error" ? "text-red-600"
              : "text-slate-400"
            }`}>
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

  type GenerationMethod = "reused" | "gemini-2.5-flash-image" | "fallback_to_generated" | string;
  const byProduct: Record<string, { productName: string; productSlug: string; ratios: Ratio[]; generationMethod: GenerationMethod }> = {};
  for (const entry of manifest?.entries ?? []) {
    if (!byProduct[entry.productSlug]) {
      byProduct[entry.productSlug] = { productName: entry.productName, productSlug: entry.productSlug, ratios: [], generationMethod: entry.generationMethod ?? "gemini-2.5-flash-image" };
    }
    byProduct[entry.productSlug]!.ratios.push(entry.aspectRatio as Ratio);
  }

  const sourceCaption = (method: GenerationMethod): string => {
    if (method === "reused") return "Sourced from brand asset";
    if (method === "fallback_to_generated") return "Generated via Nano Banana (asset fallback)";
    return "Generated via Nano Banana";
  };

  const getImageUrl = (slug: string, ratio: Ratio) => `${BASE}/api/output/${slug}/${ratio}/final.png`;
  const colorItem = (slug: string, ratio: Ratio) =>
    (complianceReport?.colorCompliance ?? []).find((i: any) => i.aspectRatio === ratio && i.imagePath?.includes(`/${slug}/`));

  return (
    <div className="space-y-10">
      {Object.values(byProduct).map((product) => (
        <div key={product.productSlug} className="space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
            <h3 className="text-lg font-semibold text-slate-800">{product.productName}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              product.generationMethod === "reused"
                ? "bg-green-100 text-green-700"
                : product.generationMethod === "fallback_to_generated"
                ? "bg-orange-100 text-orange-700"
                : "bg-amber-100 text-amber-700"
            }`}>
              {sourceCaption(product.generationMethod)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {(product.ratios.length ? product.ratios : RATIOS).map((ratio) => {
              const c = colorItem(product.productSlug, ratio);
              return (
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
                  <div className="text-xs text-center text-slate-500 font-medium">{RATIO_LABELS[ratio] ?? ratio}</div>
                  <a href={getImageUrl(product.productSlug, ratio)} download={`${product.productSlug}-${ratio}.png`}
                    className="block text-center text-xs text-slate-500 hover:text-slate-700 underline"
                    onClick={(e) => e.stopPropagation()}>
                    Download
                  </a>
                  {c && (
                    <div className={`text-xs text-center px-2 py-1 rounded ${c.pass ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      Color match {Math.round(c.score * 100)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {complianceReport && (
        <div className="border border-slate-200 rounded-lg p-6 space-y-5">
          <h3 className="text-lg font-semibold text-slate-800">Compliance Report</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-600 mb-2">Color Compliance</div>
              <div className="space-y-1">
                {complianceReport.colorCompliance?.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{item.productName?.split(" ").slice(-1)[0]} {item.aspectRatio}</span>
                    <span className={`font-medium px-1.5 py-0.5 rounded ${item.pass ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
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
                    <span className="text-slate-500">{item.productName?.split(" ").slice(-1)[0]} {item.aspectRatio}</span>
                    <span className="font-medium text-slate-500 px-1.5 py-0.5 rounded bg-slate-100">
                      {item.logoPresent ? "Found" : "None"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-600 mb-2">Legal Compliance</div>
              <div className={`flex items-center gap-2 px-3 py-2 rounded text-sm font-medium ${
                complianceReport.legalCompliance?.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}>
                {complianceReport.legalCompliance?.passed ? "✓ Passed" : "✕ Failed"}
              </div>
              {!complianceReport.legalCompliance?.passed && (
                <div className="mt-2 text-xs text-red-600">Flagged: {complianceReport.legalCompliance?.matches?.join(", ")}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setLightbox(null)}>
          <div className="max-h-full max-w-full overflow-auto" onClick={(e) => e.stopPropagation()}>
            <img src={getImageUrl(lightbox.slug, lightbox.ratio)} alt="Enlarged preview"
              className="max-h-screen max-w-screen object-contain rounded" />
            <button className="absolute top-4 right-4 text-white text-2xl font-bold hover:opacity-70"
              onClick={() => setLightbox(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const [logoServerPath, setLogoServerPath] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [steps, setSteps] = useState<Record<string, "running" | "complete" | "error">>({});
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manifest, setManifest] = useState<any>(null);
  const [complianceReport, setComplianceReport] = useState<any>(null);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runPipeline = useCallback(async () => {
    if (!brief) return;

    if (pollRef.current) clearInterval(pollRef.current);

    setStatus("running");
    setSteps({});
    setErrorMessage(null);
    setManifest(null);
    setComplianceReport(null);
    setCurrentMessage("Starting pipeline...");

    const payload = { ...brief, ...(logoServerPath ? { logoPath: logoServerPath } : {}) };

    try {
      const res = await fetch(`${BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { runId } = await res.json() as { runId: string };

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${BASE}/api/run/${runId}/status`);
          if (!statusRes.ok) return;
          const state = await statusRes.json() as {
            steps: Record<string, "running" | "complete" | "error">;
            currentMessage: string;
            status: "running" | "done" | "error";
            manifest?: unknown;
            complianceReport?: unknown;
            error?: string;
          };

          setSteps({ ...state.steps });
          if (state.currentMessage) setCurrentMessage(state.currentMessage);

          if (state.status === "done") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setSteps(() => Object.fromEntries(ALL_STEPS.map((s) => [s, "complete" as const])));
            setManifest(state.manifest);
            setComplianceReport(state.complianceReport);
            setStatus("done");
            setCurrentMessage("Pipeline complete");
          } else if (state.status === "error") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setErrorMessage(state.error ?? "Unknown error");
            setStatus("error");
          }
        } catch { /* ignore transient network errors */ }
      }, 750);

    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [brief, logoServerPath, BASE]);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Creative Automation Pipeline</h1>
          <p className="text-sm text-slate-500 mt-0.5">Generate localized social ad creatives from a campaign brief</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-slate-800">1. Upload Campaign Brief</h2>
              <p className="text-sm text-slate-500 mt-1">Upload a YAML or JSON file with your campaign details</p>
            </div>
            <BriefUpload onBriefParsed={setBrief} />

            <div>
              <h2 className="text-base font-semibold text-slate-800">Brand Logo <span className="text-slate-400 font-normal text-sm">(optional)</span></h2>
              <p className="text-sm text-slate-500 mt-1 mb-3">
                Stamped bottom-right on every creative, above the campaign message bar
              </p>
              <LogoUpload onLogoUploaded={setLogoServerPath} />
            </div>
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
                !brief ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : status === "running" ? "bg-blue-100 text-blue-500 cursor-not-allowed"
                : status === "done" ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-slate-900 text-white hover:bg-slate-700"
              }`}
            >
              {status === "running" ? "Running..." : status === "done" ? "Run Again" : "Run Pipeline"}
            </button>

            {status !== "idle" && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
                {currentMessage && <p className="text-sm text-slate-600 font-medium">{currentMessage}</p>}
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
