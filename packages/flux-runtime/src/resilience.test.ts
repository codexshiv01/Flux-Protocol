import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RetryBudget,
  computeBackoffMs,
  isRetryableOutcome,
  withResilience,
  idempotentReadResilience,
} from "./resilience.js";
import type { FluxResponse } from "./types.js";

describe("resilience", () => {
  it("computes full-jitter backoff within bounds", () => {
    const policy = { initialBackoffMs: 100, maxBackoffMs: 1000, jitter: true };
    for (let i = 0; i < 20; i++) {
      const ms = computeBackoffMs(1, policy, () => 0.5);
      assert.ok(ms >= 0 && ms <= 100);
    }
    assert.equal(computeBackoffMs(1, { ...policy, jitter: false }), 100);
    assert.equal(computeBackoffMs(4, { ...policy, jitter: false }), 800);
    assert.equal(computeBackoffMs(10, { ...policy, jitter: false }), 1000);
  });

  it("classifies retryable outcomes", () => {
    assert.equal(isRetryableOutcome({ networkError: new Error("econnreset") }), true);
    assert.equal(isRetryableOutcome({ httpStatus: 503 }), true);
    assert.equal(isRetryableOutcome({ httpStatus: 429 }), true);
    assert.equal(isRetryableOutcome({ httpStatus: 400 }), false);
    assert.equal(
      isRetryableOutcome({
        response: { data: null, error: { code: "unavailable", message: "down" } },
      }),
      true,
    );
    assert.equal(
      isRetryableOutcome({
        response: { data: { ok: true }, error: null },
      }),
      false,
    );
  });

  it("retries idempotent calls until success", async () => {
    let n = 0;
    const result = await withResilience(
      async () => {
        n++;
        if (n < 3) {
          return {
            data: null,
            error: { code: "unavailable", message: "try again" },
          } satisfies FluxResponse;
        }
        return { data: { ok: true }, error: null } satisfies FluxResponse;
      },
      {
        idempotent: true,
        retry: { maxAttempts: 5, initialBackoffMs: 1, jitter: false },
        budget: false,
        classify: (response) => ({ response }),
      },
    );
    assert.equal(n, 3);
    assert.deepEqual(result.data, { ok: true });
  });

  it("does not retry non-idempotent calls", async () => {
    let n = 0;
    const result = await withResilience(
      async () => {
        n++;
        return {
          data: null,
          error: { code: "unavailable", message: "down" },
        } satisfies FluxResponse;
      },
      {
        idempotent: false,
        retry: { maxAttempts: 5, initialBackoffMs: 1 },
        classify: (response) => ({ response }),
      },
    );
    assert.equal(n, 1);
    assert.equal((result.error as { code: string }).code, "unavailable");
  });

  it("hedges and takes the first success", async () => {
    let launches = 0;
    const result = await withResilience(
      async (signal) => {
        const id = ++launches;
        if (id === 1) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 80);
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
              },
              { once: true },
            );
          });
          return { data: { from: "slow" }, error: null } satisfies FluxResponse;
        }
        return { data: { from: "fast" }, error: null } satisfies FluxResponse;
      },
      {
        idempotent: true,
        hedge: { delayMs: 20, maxAttempts: 2 },
        retry: false,
        budget: false,
        classify: (response) => ({ response }),
      },
    );
    assert.equal(launches, 2);
    assert.deepEqual(result.data, { from: "fast" });
  });

  it("enforces retry budget ratio", () => {
    const budget = new RetryBudget({ ratio: 0.2, windowMs: 60_000, minRetriesPerSecond: 0 });
    for (let i = 0; i < 10; i++) budget.recordOriginal();
    // 20% of 10 = 2 retries allowed
    assert.equal(budget.tryConsumeRetry(), true);
    assert.equal(budget.tryConsumeRetry(), true);
    assert.equal(budget.tryConsumeRetry(), false);
  });

  it("exports idempotent read preset", () => {
    assert.equal(idempotentReadResilience.idempotent, true);
    assert.ok(idempotentReadResilience.retry);
  });
});
