export type StepStatus = "running" | "complete" | "error";

export type RunState = {
  runId: string;
  steps: Record<string, StepStatus>;
  currentMessage: string;
  status: "running" | "done" | "error";
  manifest?: unknown;
  complianceReport?: unknown;
  error?: string;
};

const runs = new Map<string, RunState>();

export function createRun(runId: string): RunState {
  const state: RunState = {
    runId,
    steps: {},
    currentMessage: "Pipeline started",
    status: "running",
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
}

export function errorRun(runId: string, error: string): void {
  const state = runs.get(runId);
  if (!state) return;
  state.status = "error";
  state.error = error;
}
