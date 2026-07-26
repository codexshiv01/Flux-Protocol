import type { IncomingMessage } from "node:http";
import type { FluxServerOptions } from "./server.js";
import type { FluxContext } from "./types.js";

export interface RateLimitState {
  windowMs: number;
  max: number;
  hits: Map<string, { count: number; resetAt: number }>;
}

export function createRateLimiter(windowMs: number, max: number): RateLimitState {
  return { windowMs, max, hits: new Map() };
}

export function rateLimitConsume(state: RateLimitState, key: string): boolean {
  const now = Date.now();
  let entry = state.hits.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + state.windowMs };
    state.hits.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= state.max;
}

export function clientKey(req: IncomingMessage): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Safe defaults for production deployments. */
export function productionOptions(overrides: FluxServerOptions): FluxServerOptions {
  return {
    maxCost: 500,
    maxDepth: 12,
    maxBodyBytes: 1_048_576,
    maxBatchSize: 20,
    strictApq: true,
    requireProtocolVersion: true,
    enableFlatbuffers: false,
    autoCompress: true,
    compressThreshold: 512,
    trustRoleHeader: false,
    rateLimit: { windowMs: 60_000, maxRequests: 600 },
    ...overrides,
  };
}

export type AuthenticateFn = (
  req: IncomingMessage,
) =>
  | Promise<{ roles: string[]; principal?: string } | null>
  | { roles: string[]; principal?: string }
  | null;

export function mergeAuthContext(
  base: FluxContext,
  auth: { roles: string[]; principal?: string } | null | undefined,
  trustRoleHeader: boolean,
): FluxContext {
  if (auth) {
    return { ...base, roles: auth.roles, principal: auth.principal };
  }
  if (!trustRoleHeader) {
    return { ...base, roles: [] };
  }
  return base;
}
