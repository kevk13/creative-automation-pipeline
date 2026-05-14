import { logStep } from "../campaign-logger.js";

export type RetryableErrorType =
  | "rate_limit"
  | "server_error"
  | "timeout"
  | "connection_reset"
  | "unknown_transient";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  jitterFactor?: number;
  agentName: string;
  context: Record<string, unknown>;
};

type ErrorClassification =
  | { retryable: true; errorType: RetryableErrorType; statusCode?: number }
  | { retryable: false; errorType: "non_retryable"; statusCode?: number };

function classifyError(err: unknown): ErrorClassification {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  const statusMatch = msg.match(/\b([45]\d{2})\b/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : undefined;

  if (statusCode !== undefined) {
    if (statusCode === 429) return { retryable: true, errorType: "rate_limit", statusCode };
    if (statusCode >= 500) return { retryable: true, errorType: "server_error", statusCode };
    return { retryable: false, errorType: "non_retryable", statusCode };
  }

  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return { retryable: true, errorType: "timeout" };
  }
  if (lower.includes("econnreset") || lower.includes("connection reset") || lower.includes("econnrefused")) {
    return { retryable: true, errorType: "connection_reset" };
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return { retryable: true, errorType: "rate_limit" };
  }
  if (lower.includes("bad request") || lower.includes("invalid request")) {
    return { retryable: false, errorType: "non_retryable" };
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("not found")) {
    return { retryable: false, errorType: "non_retryable" };
  }

  return { retryable: true, errorType: "unknown_transient" };
}

function calcDelayMs(attempt: number, baseDelayMs: number, jitterFactor: number): number {
  const base = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = base * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 1000,
    jitterFactor = 0.2,
    agentName,
    context,
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();

      const elapsedMs = Date.now() - startTime;
      if (attempt === 1) {
        logStep(agentName, "API call succeeded on first attempt", {
          ...context,
          attempt,
          totalAttempts: 1,
          elapsedMs,
          timestamp: new Date().toISOString(),
        });
      } else {
        logStep(agentName, "API call succeeded after retry", {
          ...context,
          attempt,
          totalAttempts: attempt,
          elapsedMs,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (err) {
      lastError = err;
      const { retryable, errorType, statusCode } = classifyError(err);
      const isLastAttempt = attempt >= maxAttempts;

      if (!retryable || isLastAttempt) {
        const reason = !retryable ? "non_retryable_error" : "retries_exhausted";
        logStep(agentName, "API call failed permanently", {
          ...context,
          attempt,
          totalAttempts: attempt,
          errorType: !retryable ? "non_retryable" : errorType,
          statusCode,
          reason,
          error: err instanceof Error ? err.message : String(err),
          elapsedMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        const productName = typeof context["productName"] === "string" ? context["productName"] : "unknown";
        throw new Error(
          `Image generation failed for "${productName}" after ${attempt} attempt(s) [${reason}]: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      const delayMs = calcDelayMs(attempt, baseDelayMs, jitterFactor);

      logStep(agentName, "API call failed — will retry", {
        ...context,
        attempt,
        nextAttempt: attempt + 1,
        errorType,
        statusCode,
        delayMs,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
