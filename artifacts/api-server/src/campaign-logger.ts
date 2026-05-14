import pino from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const LOGS_DIR = path.resolve(ROOT_DIR, "logs");

fs.mkdirSync(LOGS_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = path.resolve(LOGS_DIR, `run-${timestamp}.json`);

export const campaignLogger = pino(
  {
    level: "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    {
      stream: process.stdout,
      level: "debug",
    },
    {
      stream: pino.destination({ dest: logFile, sync: false }),
      level: "debug",
    },
  ])
);

export const COSTS = {
  CLAUDE_SONNET_INPUT_PER_TOKEN: 3 / 1_000_000,
  CLAUDE_SONNET_OUTPUT_PER_TOKEN: 15 / 1_000_000,
  IMAGE_PER_GENERATION: 0.04,
};

export function calcClaudeCost(inputTokens: number, outputTokens: number): number {
  return (
    inputTokens * COSTS.CLAUDE_SONNET_INPUT_PER_TOKEN +
    outputTokens * COSTS.CLAUDE_SONNET_OUTPUT_PER_TOKEN
  );
}

export function calcImageCost(imageCount: number): number {
  return imageCount * COSTS.IMAGE_PER_GENERATION;
}

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
