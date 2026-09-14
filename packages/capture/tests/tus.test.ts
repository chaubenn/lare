import assert from "node:assert/strict";
import { test } from "node:test";
import { DeferredTusUpload } from "../src/tus.ts";

const credentials = {
  endpoint: "https://video.example/tusupload",
  headers: { AuthorizationSignature: "test-signature" },
  metadata: { filetype: "video/webm", title: "Unicode title: \u00e9" },
};

function server(options: { losePatch?: boolean; loseFinal?: boolean; partial?: boolean } = {}) {
  let bytes = new Uint8Array();
  let length: number | undefined;
  const calls: { method: string; headers: Headers }[] = [];
  const request: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    calls.push({ method, headers });
    assert.equal(headers.get("AuthorizationSignature"), "test-signature");
    assert.equal(headers.get("Tus-Resumable"), "1.0.0");
    if (method === "POST") {
      assert.equal(headers.get("Upload-Defer-Length"), "1");
      assert.equal(headers.get("Upload-Length"), null);
      return new Response(null, { status: 201, headers: { Location: "/tusupload/one" } });
    }
    assert.equal(String(url), "https://video.example/tusupload/one");
    if (method === "HEAD")
      return new Response(null, {
        headers: {
          "Upload-Offset": String(bytes.length),
          ...(length === undefined ? {} : { "Upload-Length": String(length) }),
        },
      });
    assert.equal(headers.get("Upload-Offset"), String(bytes.length));
    assert.ok(init?.body instanceof Blob);
    let payload = new Uint8Array(await init.body.arrayBuffer());
    const partial = options.partial;
    if (partial) {
      payload = payload.slice(0, 2);
      options.partial = false;
    }
    bytes = new Uint8Array([...bytes, ...payload]);
    if (headers.has("Upload-Length")) length = Number(headers.get("Upload-Length"));
    if (partial || options.losePatch || (options.loseFinal && length !== undefined)) {
      options.losePatch = false;
      options.loseFinal = false;
      throw new TypeError("response lost after committing bytes");
    }
    return new Response(null, { status: 204, headers: { "Upload-Offset": String(bytes.length) } });
  };
  return { request, calls, bytes: () => bytes, length: () => length };
}

test("deferred creation, relative Location, sequential bytes, empty final PATCH", async () => {
  const mock = server();
  const upload = await DeferredTusUpload.create(credentials, mock.request, [0]);
  await upload.append(new Blob(["abc"]), 0);
  await upload.append(new Blob(["def"]), 3);
  await upload.append(new Blob([]), 6, 6);
  assert.equal(new TextDecoder().decode(mock.bytes()), "abcdef");
  assert.equal(mock.length(), 6);
  assert.equal(upload.offset, 6);
});

test("ambiguous partial PATCH resumes only the remaining bytes", async () => {
  const mock = server({ partial: true });
  const upload = await DeferredTusUpload.create(credentials, mock.request, [0]);
  await upload.append(new Blob(["abcdef"]), 0);
  assert.equal(new TextDecoder().decode(mock.bytes()), "abcdef");
  assert.equal(
    mock.calls.filter((c) => c.method === "PATCH")[1]?.headers.get("Upload-Offset"),
    "2",
  );
});

test("lost final response is confirmed by HEAD without re-declaring length", async () => {
  const mock = server({ loseFinal: true });
  const upload = await DeferredTusUpload.create(credentials, mock.request, [0]);
  await upload.append(new Blob(["abc"]), 0);
  await upload.append(new Blob([]), 3, 3);
  assert.equal(mock.calls.filter((c) => c.headers.has("Upload-Length")).length, 1);
});

test("failed append can be retried explicitly using the retained blob", async () => {
  const mock = server({ losePatch: true });
  const upload = await DeferredTusUpload.create(credentials, mock.request, []);
  const blob = new Blob(["abc"]);
  await assert.rejects(upload.append(blob, 0));
  await upload.append(blob, 0);
  assert.equal(new TextDecoder().decode(mock.bytes()), "abc");
});

test("cross-origin Location never receives credentials", async () => {
  await assert.rejects(
    DeferredTusUpload.create(
      credentials,
      async () =>
        new Response(null, {
          status: 201,
          headers: { Location: "https://attacker.example/upload" },
        }),
      [],
    ),
    /origin/,
  );
});

test("missing HEAD offset fails closed", async () => {
  const upload = await DeferredTusUpload.create(
    credentials,
    async (_, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 201, headers: { Location: "/one" } })
        : new Response(null),
    [],
  );
  await assert.rejects(upload.append(new Blob(["abc"]), 0), /Upload-Offset/);
});

test("fetch is invoked without a class-instance receiver (native browser requirement)", async () => {
  const mock = server();
  const request: typeof fetch = function (this: unknown, input, init) {
    assert.equal(this, undefined);
    return mock.request(input, init);
  };
  const upload = await DeferredTusUpload.create(credentials, request, []);
  await upload.append(new Blob(["abc"]), 0);
});
