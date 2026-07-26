export type FluxErrorCode =
  | "canceled"
  | "unknown"
  | "invalid_argument"
  | "deadline_exceeded"
  | "not_found"
  | "already_exists"
  | "permission_denied"
  | "resource_exhausted"
  | "failed_precondition"
  | "aborted"
  | "out_of_range"
  | "unimplemented"
  | "internal"
  | "unavailable"
  | "data_loss"
  | "unauthenticated"
  | "persisted_op_not_found";

export interface FluxError {
  code: FluxErrorCode;
  message: string;
  details?: unknown[];
  path?: Array<string | number>;
}

export type SelectionSet = { [field: string]: true | SelectionSet };

export interface FluxRequest<TInput = unknown> {
  input: TInput;
  select?: SelectionSet;
  op?: string;
}

export interface FluxResponse<TData = unknown> {
  data: TData | null;
  error: FluxError | FluxError[] | null;
  extensions?: Record<string, unknown>;
}

export interface FluxContext {
  headers: Record<string, string>;
  roles: string[];
  signal?: AbortSignal;
  /** W3C trace context */
  traceparent?: string;
  tracestate?: string;
  /** Authenticated principal id when authenticate() is configured */
  principal?: string;
}

export function httpStatusFor(code: FluxErrorCode): number {
  switch (code) {
    case "invalid_argument":
      return 400;
    case "unauthenticated":
      return 401;
    case "permission_denied":
      return 403;
    case "not_found":
    case "persisted_op_not_found":
      return 404;
    case "deadline_exceeded":
      return 408;
    case "resource_exhausted":
      return 429;
    case "unimplemented":
      return 501;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}
