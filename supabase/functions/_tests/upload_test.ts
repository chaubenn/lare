// No environment secrets, live HTTP, or real Deno server: all boundaries are stubbed.
Deno.test("upload endpoints authenticate, authorize, validate, and preserve ready state", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const originalEnv = Deno.env.get;
  const handlers: ((req: Request) => Promise<Response>)[] = [];
  let foreignSession = false;
  let missingVideo = false;
  let bunnyStatus = 2;
  let videoStatus = "processing";
  let created = 0;
  let patch: Record<string, unknown> | undefined;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  const assert = (value: unknown, message: string) => {
    if (!value) throw new Error(message);
  };
  Deno.env.get = (name: string) =>
    name === "SUPABASE_URL"
      ? "https://supabase.invalid"
      : name === "BUNNY_LIBRARY_ID"
        ? "1"
        : "fake-test-value";
  Deno.serve = ((handler: (req: Request) => Promise<Response>) => {
    handlers.push(handler);
  }) as unknown as typeof Deno.serve;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    if (url.pathname === "/auth/v1/user") return json({ id: "owner" });
    if (url.pathname === "/rest/v1/sessions")
      return json({ id: "session", user_id: foreignSession ? "other" : "owner" });
    if (url.pathname === "/rest/v1/videos") {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body));
        assert(body.capture_source === "web", "capture source must be stored");
        return json({ id: "video" });
      }
      assert(
        url.searchParams.get("user_id") === "eq.owner",
        "service role queries must constrain owner",
      );
      if (method === "PATCH") {
        assert(
          url.searchParams.get("status") === `eq.${videoStatus}`,
          "finalize must compare-and-set state",
        );
        patch = JSON.parse(String(init?.body));
        return json({ id: "video" });
      }
      return json(
        missingVideo
          ? null
          : {
              id: "video",
              user_id: "owner",
              bunny_video_id: "bunny",
              library_id: 1,
              status: videoStatus,
            },
      );
    }
    if (url.hostname === "video.bunnycdn.com") {
      if (method === "POST") created++;
      return json({ guid: "bunny", status: bunnyStatus, width: 1920, height: 1080 });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  try {
    await import("../bunny-create-upload/index.ts");
    await import("../bunny-finalize-recording/index.ts");
    const invoke = (index: number, body: unknown, authenticated = true) => {
      const handler = handlers[index];
      if (!handler) throw new Error("Handler not registered");
      return handler(
        new Request("https://edge.invalid", {
          method: "POST",
          headers: authenticated ? { Authorization: "Bearer fake.user.jwt" } : {},
          body: JSON.stringify(body),
        }),
      );
    };
    await t.step("anonymous creation rejected", async () => {
      assert((await invoke(0, {}, false)).status === 401, "Expected 401");
      assert(created === 0, "Must not provision anonymously");
    });
    await t.step("foreign session rejected before Bunny provisioning", async () => {
      foreignSession = true;
      assert((await invoke(0, { sessionId: "session" })).status === 404, "Expected 404");
      assert(created === 0, "Must not provision for someone else's session");
      foreignSession = false;
    });
    await t.step("browser MIME and original credential shape preserved", async () => {
      const response = await invoke(0, {
        captureSource: "web",
        mimeType: "video/webm;codecs=vp8,opus",
      });
      const body = await response.json();
      assert(response.status === 200 && body.videoId === "video", "Expected created video");
      assert(body.tus.metadata.filetype === "video/webm;codecs=vp8,opus", "Wrong MIME");
      assert(body.tus.headers.VideoId === "bunny", "Wrong credential shape");
    });
    const recording = { videoId: "video", sizeBytes: 100, durationMs: 500 };
    await t.step("foreign video cannot be finalized", async () => {
      missingVideo = true;
      assert((await invoke(1, recording)).status === 404, "Expected 404");
      missingVideo = false;
    });
    await t.step("created video is not receipt confirmation", async () => {
      bunnyStatus = 0;
      assert((await invoke(1, recording)).status === 409, "Expected retryable receipt delay");
      assert(!patch, "Unreceived recording must not be updated");
    });
    await t.step("first resolution is playable", async () => {
      bunnyStatus = 4;
      assert((await invoke(1, recording)).status === 200, "Expected success");
      assert(patch?.status === "ready", "Expected ready status");
    });
    await t.step("late finalization never regresses ready", async () => {
      bunnyStatus = 2;
      videoStatus = "ready";
      assert((await invoke(1, recording)).status === 200, "Expected success");
      assert(patch && !("status" in patch), "Ready must not regress");
    });
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    Deno.env.get = originalEnv;
  }
});
