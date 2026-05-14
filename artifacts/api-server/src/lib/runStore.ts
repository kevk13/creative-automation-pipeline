export type StepStatus = "running" | "complete" | "error";

export type CostEvent = {
  tool: string;
  model: string;
  step: string;
  product?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUSD: number;
  timestamp: string;
};

export type RunReport = {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  aiCalls: number;
  durationMs: number;
  costEvents: CostEvent[];
};

export type RunState = {
  runId: string;
  steps: Record<string, StepStatus>;
  currentMessage: string;
  status: "running" | "done" | "error";
  startedAt: number;
  manifest?: unknown;
  complianceReport?: unknown;
  runReport?: RunReport;
  error?: string;
  /** Internal accumulator — not sent to clients directly */
  _costEvents: CostEvent[];
};

const runs = new Map<string, RunState>();

export function createRun(runId: string): RunState {
  const state: RunState = {
    runId,
    steps: {},
    currentMessage: "Pipeline started",
    status: "running",
    startedAt: Date.now(),
    _costEvents: [],
  };
  runs.set(runId, state);
  setTimeout(() => runs.delete(runId), 3_600_000);
  return state;
}

export function getRun(runId: string): RunState | undefined {
  return runs.get(runId);
}

export function updateRunStep(
  runId: string,
  step: string,
  stepStatus: StepStatus,
  message?: string
): void {
  const state = runs.get(runId);
  if (!state) return;
  state.steps[step] = stepStatus;
  if (message) state.currentMessage = message;
}

/** Record one AI call's cost into the run accumulator. */
export function recordCost(runId: string, event: CostEvent): void {
  const state = runs.get(runId);
  if (!state) return;
  state._costEvents.push(event);
}

export function completeRun(
  runId: string,
  manifest: unknown,
  complianceReport: unknown
): void {
  const state = runs.get(runId);
  if (!state) return;
  state.status = "done";
  state.manifest = manifest;
  state.complianceReport = complianceReport;
  state.currentMessage = "Pipeline complete";

  const events = state._costEvents;
  state.runReport = {
    totalCostUSD: round6(events.reduce((s, e) => s + e.costUSD, 0)),
    totalInputTokens: events.reduce((s, e) => s + (e.inputTokens ?? 0), 0),
    totalOutputTokens: events.reduce((s, e) => s + (e.outputTokens ?? 0), 0),
    aiCalls: events.length,
    durationMs: Date.now() - state.startedAt,
    costEvents: events,
  };
}

export function errorRun(runId: string, error: string): void {
  const state = runs.get(runId);
  if (!state) return;
  state.status = "error";
  state.error = error;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
