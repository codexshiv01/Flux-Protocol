import type { FluxError, FluxErrorCode, FluxResponse } from "./types.js";

/** Retryable transport / server conditions. */
const DEFAULT_RETRYABLE_CODES = new Set<FluxErrorCode>([
  "unavailable",
  "deadline_exceeded",
  "resource_exhausted",
  "aborted",
  "internal",
]);

export interface RetryPolicy {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base backoff before first retry (default 50). */
  initialBackoffMs?: number;
  /** Cap on exponential backoff (default 2000). */
  maxBackoffMs?: number;
  /** Full-jitter on backoff (default true). */
  jitter?: boolean;
  /** Override which outcomes are retryable. */
  retryOn?: (outcome: AttemptOutcome) => boolean;
}

export interface HedgePolicy {
  /** Wait this long before launching a parallel attempt (aim ~p95). */
  delayMs: number;
  /** Max in-flight copies including the original (default 2, max 5). */
  maxAttempts?: number;
}

export interface RetryBudgetOptions {
  /** Max fraction of traffic that may be retries (default 0.2). */
  ratio?: number;
  /** Sliding window for the ratio (default 10_000). */
  windowMs?: number;
  /** Floor retries/sec so tiny traffic is not starved (default 3). */
  minRetriesPerSecond?: number;
}

export interface ResilienceOptions {
  /** Overall deadline; sent as Flux-Timeout-Ms and aborts in-flight work. */
  timeoutMs?: number;
  /** RFC 9218 Priority header value, e.g. `u=1` or `u=3, i=?0`. */
  priority?: string;
  retry?: RetryPolicy | false;
  hedge?: HedgePolicy | false;
  budget?: RetryBudgetOptions | false;
  /**
   * When false, never retry or hedge (safe default for POST mutations).
   * GET helpers set this true automatically.
   */
  idempotent?: boolean;
}

export interface AttemptOutcome {
  httpStatus?: number;
  networkError?: unknown;
  response?: FluxResponse;
}

export class RetryBudget {
  private readonly ratio: number;
  private readonly windowMs: number;
  private readonly minRetriesPerSecond: number;
  private readonly events: Array<{ t: number; retry: boolean }> = [];

  constructor(opts: RetryBudgetOptions = {}) {
    this.ratio = opts.ratio ?? 0.2;
    this.windowMs = opts.windowMs ?? 10_000;
    this.minRetriesPerSecond = opts.minRetriesPerSecond ?? 3;
  }

  /** Record an original (non-retry) attempt. */
  recordOriginal(): void {
    this.prune();
    this.events.push({ t: Date.now(), retry: false });
  }

  /** Returns true if a retry/hedge is allowed under the budget. */
  tryConsumeRetry(): boolean {
    this.prune();
    const now = Date.now();
    const originals = this.events.filter((e) => !e.retry).length;
    const retries = this.events.filter((e) => e.retry).length;
    const retryRate = retries / Math.max(this.windowMs / 1000, 0.001);
    const underFloor = retryRate < this.minRetriesPerSecond;
    // Cap retries to `ratio` of originals (e.g. 20% → at most 2 retries per 10 calls).
    const underRatio = retries < this.ratio * Math.max(originals, 1);
    if (underFloor || underRatio) {
      this.events.push({ t: now, retry: true });
      return true;
    }
    return false;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.events.length && this.events[0]!.t < cutoff) this.events.shift();
  }
}

export function isRetryableOutcome(outcome: AttemptOutcome): boolean {
  if (outcome.networkError) return true;
  if (outcome.httpStatus === 429 || outcome.httpStatus === 408) return true;
  if (outcome.httpStatus !== undefined && outcome.httpStatus >= 500) return true;
  const err = firstError(outcome.response);
  if (!err) return false;
  return DEFAULT_RETRYABLE_CODES.has(err.code);
}

export function firstError(response?: FluxResponse | null): FluxError | null {
  if (!response?.error) return null;
  return Array.isArray(response.error) ? (response.error[0] ?? null) : response.error;
}

export function computeBackoffMs(
  attemptIndex: number,
  policy: Required<Pick<RetryPolicy, "initialBackoffMs" | "maxBackoffMs" | "jitter">>,
  random: () => number = Math.random,
): number {
  const exp = Math.min(
    policy.maxBackoffMs,
    policy.initialBackoffMs * 2 ** Math.max(0, attemptIndex - 1),
  );
  if (!policy.jitter) return exp;
  return Math.floor(random() * (exp + 1));
}

export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  for (const s of active) {
    if (s.aborted) {
      ac.abort();
      return ac.signal;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return ac.signal;
}

export function deadlineSignal(timeoutMs: number | undefined, parent?: AbortSignal): {
  signal?: AbortSignal;
  clear: () => void;
} {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: parent, clear: () => undefined };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const signal = mergeAbortSignals(ac.signal, parent);
  return {
    signal,
    clear: () => clearTimeout(timer),
  };
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

export type AttemptFn<T> = (signal: AbortSignal | undefined) => Promise<T>;

/** Sensible defaults for idempotent GET / safe reads. */
export const idempotentReadResilience: ResilienceOptions = {
  idempotent: true,
  timeoutMs: 10_000,
  priority: "u=1",
  retry: { maxAttempts: 3, initialBackoffMs: 50, maxBackoffMs: 2000, jitter: true },
  budget: { ratio: 0.2, windowMs: 10_000, minRetriesPerSecond: 3 },
};

/** Tail-latency hedging on top of idempotent reads (use ~p95 delay). */
export function hedgedReadResilience(delayMs: number): ResilienceOptions {
  return {
    ...idempotentReadResilience,
    hedge: { delayMs, maxAttempts: 2 },
  };
}

/**
 * Run an operation with optional retries, hedging, and a shared retry budget.
 * Hedging only runs when `idempotent` is true.
 */
export async function withResilience<T>(
  attempt: AttemptFn<T>,
  opts: ResilienceOptions & {
    classify: (result: T) => AttemptOutcome;
    budgetInstance?: RetryBudget;
  },
): Promise<T> {
  const idempotent = opts.idempotent === true;
  const retryPolicy =
    opts.retry === undefined || opts.retry === false
      ? null
      : {
          maxAttempts: opts.retry.maxAttempts ?? 3,
          initialBackoffMs: opts.retry.initialBackoffMs ?? 50,
          maxBackoffMs: opts.retry.maxBackoffMs ?? 2000,
          jitter: opts.retry.jitter ?? true,
          retryOn: opts.retry.retryOn ?? isRetryableOutcome,
        };

  const hedge =
    idempotent && opts.hedge
      ? {
          delayMs: opts.hedge.delayMs,
          maxAttempts: Math.min(5, Math.max(2, opts.hedge.maxAttempts ?? 2)),
        }
      : null;

  // No shared budget unless retries/hedges are enabled.
  const budget =
    !retryPolicy && !hedge
      ? null
      : opts.budget === false
        ? null
        : (opts.budgetInstance ?? new RetryBudget(opts.budget ?? {}));

  const { signal: outerSignal, clear } = deadlineSignal(opts.timeoutMs);
  try {
    if (!retryPolicy && !hedge) {
      return await attempt(outerSignal);
    }
    if (!idempotent) {
      // Mutations: honor timeout only; never retry/hedge.
      return await attempt(outerSignal);
    }

    // Hedged path: launch parallel attempts after delay.
    if (hedge) {
      return await runHedged(attempt, {
        hedge,
        retryPolicy,
        budget,
        signal: outerSignal,
        classify: opts.classify,
      });
    }

    // Sequential retries only.
    let last: T | undefined;
    let lastOutcome: AttemptOutcome | undefined;
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;
    for (let i = 0; i < maxAttempts; i++) {
      if (i === 0) budget?.recordOriginal();
      else if (budget && !budget.tryConsumeRetry()) break;

      if (i > 0 && retryPolicy) {
        const wait = computeBackoffMs(i, retryPolicy);
        await sleep(wait, outerSignal);
      }

      try {
        last = await attempt(outerSignal);
        lastOutcome = opts.classify(last);
        if (!retryPolicy || !retryPolicy.retryOn(lastOutcome)) return last;
      } catch (e) {
        lastOutcome = { networkError: e };
        if (!retryPolicy || !retryPolicy.retryOn(lastOutcome)) throw e;
        if (i === maxAttempts - 1) throw e;
      }
    }
    if (last !== undefined) return last;
    throw lastOutcome?.networkError ?? new Error("resilience: exhausted retries");
  } finally {
    clear();
  }
}

async function runHedged<T>(
  attempt: AttemptFn<T>,
  ctx: {
    hedge: { delayMs: number; maxAttempts: number };
    retryPolicy: {
      maxAttempts: number;
      initialBackoffMs: number;
      maxBackoffMs: number;
      jitter: boolean;
      retryOn: (o: AttemptOutcome) => boolean;
    } | null;
    budget: RetryBudget | null;
    signal?: AbortSignal;
    classify: (result: T) => AttemptOutcome;
  },
): Promise<T> {
  const { hedge, budget, signal, classify, retryPolicy } = ctx;
  budget?.recordOriginal();

  const controllers: AbortController[] = [];
  const cancelOthers = (winner: AbortController) => {
    for (const ac of controllers) {
      if (ac !== winner) ac.abort();
    }
  };

  type RaceResult =
    | { kind: "success"; value: T }
    | { kind: "soft_fail"; value: T }
    | { kind: "hard_fail"; error: unknown };

  const launchOne = (isExtra: boolean): Promise<RaceResult> => {
    if (isExtra && budget && !budget.tryConsumeRetry()) {
      return Promise.resolve({ kind: "hard_fail", error: new Error("retry budget exhausted") });
    }
    const local = new AbortController();
    controllers.push(local);
    const combined = mergeAbortSignals(local.signal, signal);
    return attempt(combined)
      .then((value) => {
        const outcome = classify(value);
        if (retryPolicy?.retryOn(outcome)) return { kind: "soft_fail" as const, value };
        cancelOthers(local);
        return { kind: "success" as const, value };
      })
      .catch((error: unknown) => {
        if (local.signal.aborted && !(signal?.aborted)) {
          return { kind: "hard_fail" as const, error: abortError() };
        }
        return { kind: "hard_fail" as const, error };
      });
  };

  const races: Promise<RaceResult>[] = [launchOne(false)];
  for (let i = 1; i < hedge.maxAttempts; i++) {
    const delay = hedge.delayMs * i;
    races.push(
      sleep(delay, signal).then(() => launchOne(true)),
    );
  }

  let soft: T | undefined;
  let lastHard: unknown;
  const pending = new Set(races);
  while (pending.size > 0) {
    const winner = await Promise.race(
      [...pending].map((p) => p.then((r) => ({ p, r }))),
    );
    pending.delete(winner.p);
    if (winner.r.kind === "success") {
      await Promise.allSettled([...pending]);
      return winner.r.value;
    }
    if (winner.r.kind === "soft_fail") soft = winner.r.value;
    else lastHard = winner.r.error;
  }

  if (retryPolicy && retryPolicy.maxAttempts > hedge.maxAttempts) {
    for (let i = hedge.maxAttempts; i < retryPolicy.maxAttempts; i++) {
      if (budget && !budget.tryConsumeRetry()) break;
      await sleep(computeBackoffMs(i, retryPolicy), signal);
      try {
        const value = await attempt(signal);
        const outcome = classify(value);
        if (!retryPolicy.retryOn(outcome)) return value;
        soft = value;
      } catch (e) {
        lastHard = e;
        if (!retryPolicy.retryOn({ networkError: e })) throw e;
        if (i === retryPolicy.maxAttempts - 1) throw e;
      }
    }
  }

  if (soft !== undefined) return soft;
  if (lastHard instanceof Error) throw lastHard;
  throw new Error("resilience: hedged attempts failed");
}
