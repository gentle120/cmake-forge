/**
 * Minimal subset of the DOM fetch API used by the Pack code.
 *
 * Requests carry the caller's cancellation signal (cancelling a progress
 * notification must stop the network work) and, for ranged downloads, a Range
 * header. Responses expose the headers and the byte stream so a download can
 * report progress and be resumed in chunks.
 */
export interface FetchRequestInit {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface FetchResponseHeaders {
  get(name: string): string | null;
}

export interface FetchResponseBody {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
  };
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: FetchResponseHeaders;
  body: FetchResponseBody | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;
