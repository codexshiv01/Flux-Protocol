import type { SelectionSet } from "./types.js";
import { hashSelection } from "./select.js";

export class ApqStore {
  private readonly map = new Map<string, SelectionSet>();

  get(op: string): SelectionSet | undefined {
    return this.map.get(op);
  }

  set(op: string, select: SelectionSet): void {
    this.map.set(op, select);
  }

  register(select: SelectionSet): string {
    const op = hashSelection(select);
    this.map.set(op, select);
    return op;
  }
}
