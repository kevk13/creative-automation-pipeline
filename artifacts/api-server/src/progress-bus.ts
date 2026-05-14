import { EventEmitter } from "events";

export type ProgressEvent = {
  runId: string;
  step: string;
  status: "running" | "complete" | "error";
  message?: string;
  error?: string;
};

class ProgressBus extends EventEmitter {}

export const progressBus = new ProgressBus();
progressBus.setMaxListeners(100);

export function emitProgress(event: ProgressEvent): void {
  progressBus.emit("progress", event);
}
