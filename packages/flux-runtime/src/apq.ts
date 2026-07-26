import type { SelectionSet } from "./types.js";
import { hashSelection } from "./select.js";

export interface ApqStoreOptions {
  /** When true, unknown ops cannot self-register; only preload/allowlist works. */
  strict?: boolean;
}

export class ApqStore {
  private readonly map = new Map<string, SelectionSet>();
  readonly strict: boolean;

  constructor(opts: ApqStoreOptions = {}) {
    this.strict = !!opts.strict;
  }

  get(op: string): SelectionSet | undefined {
    return this.map.get(op);
  }

  set(op: string, select: SelectionSet): void {
    this.map.set(op, select);
  }

  /** Preload an allowlisted operation (works in strict mode). */
  allow(op: string, select: SelectionSet): void {
    this.map.set(op, select);
  }

  allowSelect(select: SelectionSet): string {
    const op = hashSelection(select);
    this.map.set(op, select);
    return op;
  }

  register(select: SelectionSet): string | undefined {
    if (this.strict) return undefined;
    return this.allowSelect(select);
  }
}
