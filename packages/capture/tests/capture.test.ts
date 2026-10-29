import assert from "node:assert/strict";
import { test } from "node:test";
import { startCapture } from "../src/index.ts";

class Recorder {
  static latest: Recorder;
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() {
    Recorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop() {
    this.state = "inactive";
    setTimeout(() => {
      this.emit("final");
      this.onstop?.();
    }, 0);
  }
}

test("OPFS spills while offline, stop includes last event, acknowledged bytes are removed", async () => {
  const originalFetch = globalThis.fetch;
  const originalRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  let clock = 0;
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => clock },
    configurable: true,
  });
  const files = new Map<string, Blob>();
  let removed = false;
  const directory = {
    async getFileHandle(name: string) {
      return {
        async createWritable() {
          return {
            async write(blob: Blob) {
              files.set(name, blob);
            },
            async close() {},
            async abort() {},
          };
        },
        async getFile() {
          const file = files.get(name);
          assert.ok(file);
          return file;
        },
      };
    },
    async removeEntry(name: string) {
      files.delete(name);
    },
  };
  let release: () => void = () => {};
  const offline = new Promise<void>((resolve) => {
    release = resolve;
  });
  let bytes = "";
  let length: string | null = null;
  let finalized = false;
  globalThis.fetch = async (_, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === "POST")
      return new Response(null, { status: 201, headers: { Location: "/upload/1" } });
    await offline;
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: {
          "Upload-Offset": String(bytes.length),
          ...(length === null ? {} : { "Upload-Length": length }),
        },
      });
    assert.equal(headers.get("Upload-Offset"), String(bytes.length));
    assert.ok(init?.body instanceof Blob);
    bytes += await init.body.text();
    length = headers.get("Upload-Length") ?? length;
    return new Response(null, { status: 204, headers: { "Upload-Offset": String(bytes.length) } });
  };
  Object.defineProperty(globalThis, "MediaRecorder", { value: Recorder, configurable: true });
  Object.defineProperty(globalThis, "navigator", {
    value: {
      storage: {
        async getDirectory() {
          return {
            async getDirectoryHandle() {
              return directory;
            },
            async removeEntry() {
              removed = true;
            },
          };
        },
      },
    },
    configurable: true,
  });
  try {
    const session = await startCapture({
      stream: {} as MediaStream,
      async createUpload({ mimeType }) {
        assert.match(mimeType, /video\/webm/);
        return {
          videoId: "one",
          bunnyVideoId: "bunny",
          libraryId: 1,
          tus: {
            endpoint: "https://example.com/tus",
            headers: {},
            metadata: { filetype: mimeType, title: "Test" },
          },
        };
      },
      async finalizeUpload(result) {
        assert.equal(result.sizeBytes, 11);
        assert.equal(length, "11");
        finalized = true;
      },
    });
    Recorder.latest.emit("abc");
    Recorder.latest.emit("def");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(files.size, 2, "network stall must spill both chunks to disk");
    assert.equal(bytes, "");
    clock = 100;
    session.pause();
    assert.equal(Recorder.latest.state, "paused");
    clock = 1100;
    session.resume();
    assert.equal(Recorder.latest.state, "recording");
    clock = 1200;
    session.pause();
    clock = 1400;
    const stopping = session.stop();
    release();
    const result = await stopping;
    assert.equal(bytes, "abcdeffinal");
    assert.equal(result.sizeBytes, 11);
    assert.equal(result.durationMs, 200, "paused time, including stop-while-paused, is excluded");
    assert.equal(finalized, true);
    assert.equal(files.size, 0);
    assert.equal(removed, true);
    assert.equal(await session.stop(), result, "stop is idempotent");
  } finally {
    release();
    globalThis.fetch = originalFetch;
    if (originalRecorder) Object.defineProperty(globalThis, "MediaRecorder", originalRecorder);
    else Reflect.deleteProperty(globalThis, "MediaRecorder");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalPerformance) Object.defineProperty(globalThis, "performance", originalPerformance);
    else Reflect.deleteProperty(globalThis, "performance");
  }
});

for (const failure of ["memory", "quota"] as const) {
  test(`${failure} pressure stops explicitly, never finalizes a partial recording, and allows discard`, async () => {
    const originalFetch = globalThis.fetch;
    const originalRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let offset = 0;
    let finalPatch = false;
    let finalized = false;
    let reported = false;
    globalThis.fetch = async (_, init) => {
      if (init?.method === "POST")
        return new Response(null, { status: 201, headers: { Location: "/upload" } });
      if (init?.method === "PATCH") {
        assert.ok(init.body instanceof Blob);
        offset += init.body.size;
        finalPatch ||= new Headers(init.headers).has("Upload-Length");
      }
      return new Response(null, { status: 200, headers: { "Upload-Offset": String(offset) } });
    };
    Object.defineProperty(globalThis, "MediaRecorder", { value: Recorder, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          async getDirectory() {
            if (failure === "memory") throw new Error("OPFS unavailable");
            return {
              async getDirectoryHandle() {
                return {
                  async getFileHandle() {
                    return {
                      async createWritable() {
                        throw new Error("Quota exceeded");
                      },
                    };
                  },
                };
              },
              async removeEntry() {},
            };
          },
        },
      },
    });
    try {
      const session = await startCapture({
        stream: {} as MediaStream,
        maxMemoryBytes: failure === "memory" ? 2 : 1024,
        async createUpload() {
          return {
            videoId: "failed",
            bunnyVideoId: "bunny",
            libraryId: 1,
            tus: {
              endpoint: "https://example.com/tus",
              headers: {},
              metadata: { filetype: "video/webm", title: "Test" },
            },
          };
        },
        async finalizeUpload() {
          finalized = true;
        },
        onError() {
          reported = true;
        },
      });
      Recorder.latest.emit("abc");
      await assert.rejects(
        session.stop(),
        failure === "memory" ? /buffer exhausted/ : /Quota exceeded/,
      );
      assert.equal(reported, true);
      assert.equal(finalized, false);
      assert.equal(finalPatch, false);
      await session.discard();
      await assert.rejects(session.retry(), /discarded/);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalRecorder) Object.defineProperty(globalThis, "MediaRecorder", originalRecorder);
      else Reflect.deleteProperty(globalThis, "MediaRecorder");
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });
}
