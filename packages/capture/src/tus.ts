export interface TusCredentials {
  endpoint: string;
  headers: Record<string, string>;
  metadata: { filetype: string; title: string };
}

export interface CreateUploadResponse {
  videoId: string;
  bunnyVideoId: string;
  libraryId: number;
  tus: TusCredentials;
}

function base64(value: string): string {
  return btoa(Array.from(new TextEncoder().encode(value), (b) => String.fromCharCode(b)).join(""));
}

function offsetOf(response: Response): number {
  const value = response.headers.get("Upload-Offset");
  if (value === null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("TUS response missing a valid Upload-Offset");
  }
  return Number(value);
}

/** A single deferred-length upload. Retry reconciles ambiguous PATCH responses with HEAD. */
export class DeferredTusUpload {
  offset = 0;
  readonly url: string;
  private readonly credentials: TusCredentials;
  private readonly request: typeof fetch;
  private readonly retryDelays: readonly number[];
  private constructor(
    url: string,
    credentials: TusCredentials,
    request: typeof fetch,
    retryDelays: readonly number[],
  ) {
    this.url = url;
    this.credentials = credentials;
    this.request = request;
    this.retryDelays = retryDelays;
  }

  static async create(
    credentials: TusCredentials,
    request: typeof fetch = fetch,
    retryDelays: readonly number[] = [500, 1000, 2000, 4000, 8000, 16000],
  ): Promise<DeferredTusUpload> {
    const response = await request(credentials.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: {
        ...credentials.headers,
        "Tus-Resumable": "1.0.0",
        "Upload-Defer-Length": "1",
        "Upload-Metadata": `filetype ${base64(credentials.metadata.filetype)},title ${base64(credentials.metadata.title)}`,
      },
    });
    if (response.status !== 201) throw new Error(`TUS create: HTTP ${response.status}`);
    const location = response.headers.get("Location");
    if (!location) throw new Error("TUS create missing Location");
    const url = new URL(location, credentials.endpoint);
    if (url.origin !== new URL(credentials.endpoint).origin)
      throw new Error("Unsafe TUS Location origin");
    return new DeferredTusUpload(url.href, credentials, request, retryDelays);
  }

  private async send(
    method: string,
    headers: Record<string, string> = {},
    body?: Blob,
  ): Promise<Response> {
    // Native window.fetch rejects a class-instance receiver in Chromium.
    const request = this.request;
    const response = await request(this.url, {
      method,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { ...this.credentials.headers, "Tus-Resumable": "1.0.0", ...headers },
    });
    if (!response.ok) throw new Error(`TUS ${method}: HTTP ${response.status}`);
    return response;
  }

  /** start is the absolute byte position of the retained blob. */
  async append(blob: Blob, start: number, finalLength?: number): Promise<void> {
    const end = start + blob.size;
    let last: unknown;
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt++) {
      try {
        // Always reconcile, including on explicit retry after a previous exhausted attempt.
        const head = await this.send("HEAD");
        this.offset = offsetOf(head);
        if (this.offset < start || this.offset > end)
          throw new Error("TUS offset outside retained chunk");
        if (
          finalLength !== undefined &&
          head.headers.get("Upload-Length") === String(finalLength) &&
          this.offset === finalLength
        )
          return;
        if (this.offset === end && finalLength === undefined) return;
        const response = await this.send(
          "PATCH",
          {
            "Upload-Offset": String(this.offset),
            "Content-Type": "application/offset+octet-stream",
            ...(finalLength === undefined ? {} : { "Upload-Length": String(finalLength) }),
          },
          blob.slice(this.offset - start),
        );
        const acknowledged = offsetOf(response);
        if (acknowledged !== end) throw new Error("TUS PATCH acknowledged an unexpected offset");
        this.offset = acknowledged;
        return;
      } catch (error) {
        last = error;
        if (attempt < this.retryDelays.length)
          await new Promise((resolve) => setTimeout(resolve, this.retryDelays[attempt]));
      }
    }
    throw last;
  }
}
