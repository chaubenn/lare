import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from "@playwright/test";

const EXT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.output/chrome-mv3-e2e");
const BASE = "http://localhost:4173";

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

let context: BrowserContext;
let sw: Worker;
let extensionId: string;

test.beforeAll(async () => {
  if (!existsSync(EXT_PATH)) {
    throw new Error(`Extension build missing at ${EXT_PATH}. Run: pnpm build:e2e`);
  }
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // chrome-extension://<id>/sidepanel.html — needed to drive the side panel, which
  // is now the only UI the extension has.
  extensionId = new URL(sw.url()).host;
  // Seed a Supabase session so the extension believes the user is signed in.
  const res = await fetch(`${BASE}/__reset`);
  expect(res.ok).toBe(true);
  const sessionRes = await fetch(`${BASE}/supabase/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const session = await sessionRes.json();
  await sw.evaluate(async (s) => {
    await chrome.storage.local.set({ "sb-localhost-auth-token": JSON.stringify(s) });
  }, session);
});

test.afterAll(async () => {
  await context?.close();
});

/**
 * Wipe the extension's own tracked state between tests.
 *
 * `__reset` only clears what the fixture server recorded; `chrome.storage.local`
 * survives, and a problem left tracked by an earlier test is skipped as already
 * synced by the next one. Auth lives under a different key and is left alone.
 */
async function resetExtensionState(): Promise<void> {
  await sw.evaluate(async () => {
    await chrome.storage.local.remove("lare:state");
  });
}

async function recorded(): Promise<RecordedRequest[]> {
  return (await (await fetch(`${BASE}/__requests`)).json()) as RecordedRequest[];
}

async function openProblem(slug = "two-sum"): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/problems/${slug}/`);
  await page.waitForSelector("body[data-monaco-ready='1']");
  return page;
}

/** Solve the fixture problem so the extension captures a submission for it. */
async function submitOnce(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("result")).toHaveText("submit:Accepted");
}

async function openPanel() {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByText("Tracking submissions")).toBeVisible();
  // Worker and panel come from the same build, so no stale-worker banner.
  await expect(panel.getByRole("button", { name: "Reload Lare" })).toHaveCount(0);
  return panel;
}

const INBOX_SESSION_ID = "00000000-0000-4000-8000-0000000000b0";

test("passive tracking: opening a problem and submitting is captured with no session", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const page = await openProblem();

  // Nothing is injected into the page beyond the (hidden) recording dot: no
  // launcher, no menu, no pill.
  const overlay = page.locator("lare-overlay");
  await expect(overlay.getByRole("button", { name: "Lare" })).toHaveCount(0);
  await expect(overlay.getByTestId("lare-pill")).toHaveCount(0);
  await expect(overlay.locator(".lare-rec")).toHaveCount(0);

  // Opening the problem is enough to register it against the inbox.
  await expect
    .poll(
      async () =>
        (await recorded()).filter((r) => r.path.startsWith("/supabase/rest/v1/session_problems"))
          .length,
    )
    .toBeGreaterThan(0);

  // Solve it.
  await focusEditorEnd(page, "editor");
  await page.keyboard.type("        return [0, 1]\n");

  // Edits from the plaintext testcase editor must still be ignored.
  await focusEditorEnd(page, "tc");
  await page.keyboard.type("\n[3,2,4]\n6");

  // "Run" must not be captured as a submission; "Submit" must.
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByTestId("result")).toHaveText("run:Accepted");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("result")).toHaveText("submit:Accepted");

  // Scoped to the Supabase table: LeetCode's own judge endpoint is
  // /submissions/detail/<id>/check/, which a looser filter would also match.
  await expect
    .poll(
      async () =>
        (await recorded()).filter((r) => r.path.startsWith("/supabase/rest/v1/submissions")).length,
    )
    .toBe(1);

  // ---- assert what the service worker wrote to (mock) Supabase ----------------
  const reqs = await recorded();
  const sb = reqs.filter((r) => r.path.startsWith("/supabase/"));
  const table = (name: string, method: string) =>
    sb.filter((r) => r.method === method && r.path.startsWith(`/supabase/rest/v1/${name}`));

  // The inbox is resolved through the RPC, once.
  const inboxCalls = sb.filter((r) => r.path.includes("/rpc/practice_inbox"));
  expect(inboxCalls.length).toBeGreaterThan(0);

  // No session is opened and no timer is recorded: that is the whole point.
  expect(table("sessions", "POST")).toHaveLength(0);
  expect(table("session_events", "POST")).toHaveLength(0);

  // The problem is attached to the inbox with no duration.
  const problems = table("session_problems", "POST");
  expect(problems).toHaveLength(1);
  const problemRow = problems[0]?.body as Record<string, unknown>;
  expect(problemRow.session_id).toBe(INBOX_SESSION_ID);
  expect(problemRow.slug).toBe("two-sum");
  expect(problemRow.title).toBe("Two Sum");
  expect(problemRow.difficulty).toBe("Easy");
  expect(problemRow.active_ms).toBe(0);
  expect(problemRow.topic_tags).toEqual([
    { name: "Array", slug: "array" },
    { name: "Hash Table", slug: "hash-table" },
  ]);
  expect(String(problemRow.description_html)).toContain("Given an array of integers");
  expect(problems[0]?.headers.authorization).toMatch(/^Bearer /);

  // The submission is captured in full, against that problem row.
  const submissions = table("submissions", "POST");
  expect(submissions).toHaveLength(1);
  const submissionRow = submissions[0]?.body as Record<string, unknown>;
  expect(submissionRow.accepted).toBe(true);
  expect(submissionRow.runtime_ms).toBe(1219);
  expect(submissionRow.runtime_percentile).toBe(17.99);
  expect(submissionRow.memory_mb).toBe(22);
  expect(submissionRow.total_testcases).toBe(57);
  expect(String(submissionRow.code)).toContain("return [0, 1]");
  const dist = submissionRow.runtime_distribution as {
    lang: string;
    bins: { value: number; pct: number }[];
  };
  expect(dist.lang).toBe("python3");
  expect(dist.bins.map((b) => b.value)).toEqual([140, 386, 633, 879, 1126, 1219]);

  // Practice does not upload an edit log (that is interview-only) and does not
  // create a post — publishing is an explicit action in the desktop app.
  expect(sb.filter((r) => r.path.startsWith("/supabase/storage/"))).toHaveLength(0);
  expect(table("posts", "POST")).toHaveLength(0);

  await page.close();
});

test("the side panel lists tracked problems without a hand-off button, and keeps listing them", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();

  // Solve one problem: the side panel just shows it. Posting happens in the desktop app,
  // which reads the inbox straight from Supabase, so there is nothing to hand off here.
  const first = await openProblem("two-sum");
  await submitOnce(first);
  let panel = await openPanel();
  await expect(panel.getByText("Two Sum")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Review .* in Lare/ })).toHaveCount(0);
  await panel.close();

  // Nothing local or server-side got cleared just by looking at the side panel.
  const sb = (await recorded()).filter((r) => r.path.startsWith("/supabase/"));
  expect(sb.filter((r) => r.method === "DELETE")).toHaveLength(0);
  expect(
    sb.filter(
      (r) => r.method === "POST" && r.path.startsWith("/supabase/rest/v1/session_problems"),
    ),
  ).toHaveLength(1);

  // A second problem accumulates alongside the first, not on top of it. (The fixture
  // page always reports "Two Sum" regardless of slug, so two rows is the signal.)
  const second = await openProblem("add-two-numbers");
  await submitOnce(second);
  panel = await openPanel();
  await expect(panel.locator(".problems li")).toHaveCount(2);

  await panel.close();
  await second.close();
  await first.close();
});

test("grading is explicit: cloud-only interview is available without desktop", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The side panel is the only control surface now.
  await expect(panel.getByText("Tracking submissions")).toBeVisible();
  // Without a desktop app the panel starts ungraded instead of on a dead, disabled button.
  const start = panel.getByRole("button", { name: /Start mock interview/ });
  const gradedBox = panel.getByRole("checkbox", { name: "Transcript & AI review" });
  await expect(gradedBox).not.toBeChecked();
  await expect(start).toBeEnabled();
  await expect(panel.getByText(/Disables both transcript and AI review/)).toBeVisible();

  // Asking for grading says exactly what is missing.
  await gradedBox.check();
  await expect(start).toBeDisabled();
  await expect(panel.getByText(/desktop app isn't running/)).toBeVisible();

  await panel.close();
  await problem.close();
});

test("publish selected cloud inbox problems opens a draft without desktop", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  const panel = await openPanel();
  await panel.getByRole("checkbox", { name: "Select Two Sum" }).check();
  const draftPromise = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Create draft from selected problems" }).click();
  const draft = await draftPromise;
  await expect.poll(() => draft.url()).toContain("/drafts/");
  const request = (await recorded()).find((r) => r.path.includes("publish_practice_problems"));
  expect(request?.body).toMatchObject({ problem_ids: [expect.any(String)] });
  await draft.close();
  await panel.close();
  await problem.close();
});

const badgeText = () => sw.evaluate(() => chrome.action.getBadgeText({}));

test("clear all removes tracked problems from the panel, the badge and the inbox", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  await submitOnce(problem);
  await expect.poll(badgeText).toBe("1");

  const panel = await openPanel();
  await expect(panel.getByText("Two Sum")).toBeVisible();
  await panel.getByRole("button", { name: "Clear all" }).click();
  await panel.getByRole("button", { name: "Confirm clear" }).click();
  await expect(panel.getByText(/Nothing tracked yet/)).toBeVisible();
  await expect.poll(badgeText).toBe("");

  const deletes = (await recorded()).filter(
    (r) => r.method === "DELETE" && r.path.startsWith("/supabase/rest/v1/session_problems"),
  );
  expect(deletes).toHaveLength(1);
  expect(deletes[0]?.path).toContain(`session_id=eq.${INBOX_SESSION_ID}`);

  await panel.close();
  await problem.close();
});

test("problems posted from another client drop off the panel and the badge", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  await submitOnce(problem);
  await expect.poll(badgeText).toBe("1");

  // The desktop app publishes (or clears) them: they leave the server inbox.
  await fetch(`${BASE}/__inbox/empty`);
  const panel = await openPanel();
  await expect(panel.getByText(/Nothing tracked yet/)).toBeVisible();
  await expect.poll(badgeText).toBe("");

  await panel.close();
  await problem.close();
});

test("a refused tab capture parks Start on the toolbar icon, and Cancel restores the panel", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  const panel = await openPanel();
  const tabId = await sw.evaluate(
    async () => (await chrome.tabs.query({ url: "http://localhost/problems/*" }))[0]?.id ?? null,
  );

  // Nobody clicked the toolbar icon on this tab, so Chrome refuses capture, exactly as it does
  // after a click inside the side panel.
  const res = await panel.evaluate(
    (id) =>
      chrome.runtime.sendMessage({
        type: "START_INTERVIEW",
        problem: {
          slug: "two-sum",
          frontendId: "1",
          title: "Two Sum",
          difficulty: "Easy",
          url: "http://localhost:4173/problems/two-sum/",
          language: null,
        },
        question: null,
        facecam: false,
        graded: false,
        tabId: id,
      }),
    tabId,
  );
  expect(res).toMatchObject({ ok: true, awaitingToolbarClick: true });
  await expect(panel.getByText("Click the Lare icon in your toolbar")).toBeVisible();
  await expect.poll(badgeText).toBe("REC");
  // Parked, not started: nothing was written for a session that may never happen.
  const writes = (await recorded()).filter((r) => r.path.startsWith("/supabase/rest/v1/sessions"));
  expect(writes).toHaveLength(0);

  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByRole("button", { name: "Start mock interview" })).toBeVisible();
  await expect.poll(badgeText).not.toBe("REC");

  await panel.close();
  await problem.close();
});

test("a recording survives the tab loading frames or reloading, and keeps its consent dot", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  const tabId = await sw.evaluate(
    async () => (await chrome.tabs.query({ url: "http://localhost/problems/*" }))[0]?.id ?? null,
  );
  // An interview recording on this tab, as the background and offscreen document record it.
  await sw.evaluate(async (id) => {
    const sessionId = "00000000-0000-4000-8000-0000000000c1";
    const t = Date.now();
    await chrome.storage.local.set({
      "lare:capture": { sessionId, tabId: id, graded: false, state: "recording" },
      "lare:state": {
        version: 2,
        interview: {
          sessionId,
          kind: "interview",
          scope: "problem",
          startedAt: t,
          events: [{ t, type: "start" }],
          problems: [],
          currentSlug: null,
          tabId: id,
          facecam: false,
          synced: true,
        },
        tracking: { inboxSessionId: null, problems: [] },
        appConnected: false,
        pendingSync: [],
      },
    });
  }, tabId);
  // Ending the session would stop the capture; with no offscreen document here that fails and
  // parks the session in pendingSync, so an empty pendingSync means nothing tried to end it.
  const status = () =>
    sw.evaluate(async () => {
      const got = await chrome.storage.local.get(["lare:capture", "lare:state"]);
      const capture = got["lare:capture"] as { state?: string } | undefined;
      const state = got["lare:state"] as { interview: unknown; pendingSync: string[] } | undefined;
      return {
        capture: capture?.state,
        interview: !!state?.interview,
        pendingSync: state?.pendingSync.length ?? 0,
      };
    });
  const alive = { capture: "recording", interview: true, pendingSync: 0 };
  const dot = (page: Page) => page.locator("lare-overlay").locator(".lare-rec");

  // LeetCode's Run (and plenty else) loads frames inside the page: the tab reports "loading".
  await problem.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/problems/two-sum/?frame=1";
    document.body.append(frame);
  });
  await expect(dot(problem)).toHaveCount(1);
  await problem.waitForTimeout(1500);
  expect(await status()).toEqual(alive);

  // A real reload loses the dot for a moment; it comes back and the recording carries on.
  await problem.reload();
  await problem.waitForSelector("body[data-monaco-ready='1']");
  await expect(dot(problem)).toHaveCount(1);
  await problem.waitForTimeout(1500);
  expect(await status()).toEqual(alive);

  await sw.evaluate(async () => {
    await chrome.storage.local.remove(["lare:capture", "lare:state"]);
  });
  await problem.close();
});

test("the permission tab asks for the microphone, reports back and closes itself", async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const result = panel.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg?.type === "LARE_MEDIA_PERMISSION_RESULT") resolve(msg);
        });
      }),
  );
  const tab = await context.newPage();
  await tab.goto(`chrome-extension://${extensionId}/permissions.html?camera=0`);
  expect(await result).toMatchObject({ granted: true, error: null });
  await tab.waitForEvent("close");
  await panel.close();
});

test("offscreen code records real media chunks, uploads during recording and finalizes", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  await sw.evaluate(async () => {
    await chrome.storage.local.remove("lare:capture");
  });
  const document = await context.newPage();
  // Exercise the real recorder/compositor/uploader with Chrome's fake physical devices.
  // Only tabCapture's user-gesture stream token is substituted in this harness.
  await document.addInitScript(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) =>
      get({ audio: !!constraints?.audio, video: !!constraints?.video });
  });
  await document.goto(`chrome-extension://${extensionId}/offscreen.html`);
  const result = await sw.evaluate(async () =>
    chrome.runtime.sendMessage({
      target: "offscreen",
      command: "start",
      sessionId: "00000000-0000-4000-8000-000000000099",
      tabId: 1,
      streamId: "test-device",
      userId: "00000000-0000-4000-8000-000000000001",
      graded: false,
      facecam: true,
    }),
  );
  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    state: { state: "recording", graded: false },
  });
  try {
    await expect
      .poll(
        async () =>
          (await recorded()).filter((r) => r.method === "PATCH" && r.path.startsWith("/tus/"))
            .length,
      )
      .toBeGreaterThan(0);
  } catch (error) {
    throw new Error(
      `${error}\nCapture: ${JSON.stringify(await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", command: "status" })))}\nRequests: ${JSON.stringify((await recorded()).map((r) => ({ method: r.method, path: r.path, headers: r.headers })))}`,
    );
  }
  const paused = await sw.evaluate(() =>
    chrome.runtime.sendMessage({ target: "offscreen", command: "pause" }),
  );
  expect(paused).toMatchObject({ ok: true, state: { state: "paused" } });
  const resumed = await sw.evaluate(() =>
    chrome.runtime.sendMessage({ target: "offscreen", command: "resume" }),
  );
  expect(resumed).toMatchObject({ ok: true, state: { state: "recording" } });
  const stopped = await sw.evaluate(async () =>
    chrome.runtime.sendMessage({ target: "offscreen", command: "stop" }),
  );
  expect(stopped, JSON.stringify(stopped)).toMatchObject({
    ok: true,
    state: { state: "complete", graded: false },
  });
  const finalized = (await recorded()).find((r) => r.path.includes("bunny-finalize-recording"));
  if (!finalized) throw new Error("Missing finalization request");
  expect((finalized.body as { sizeBytes: number }).sizeBytes).toBeGreaterThan(0);
  const roots = await document.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys())
      names.push(name);
    return names;
  });
  expect(roots.filter((name) => name.startsWith("lare-capture-"))).toHaveLength(0);
  await document.close();
});

/** Focus a fixture Monaco instance and put the cursor at the very end of its model. */
async function focusEditorEnd(page: Page, which: "editor" | "tc"): Promise<void> {
  await page.evaluate((name) => {
    type Ed = {
      focus(): void;
      getModel(): { getLineCount(): number; getLineMaxColumn(n: number): number };
      setPosition(p: { lineNumber: number; column: number }): void;
    };
    const ed = (window as unknown as Record<string, Ed | undefined>)[name];
    if (!ed) throw new Error(`fixture editor ${name} missing`);
    ed.focus();
    const model = ed.getModel();
    const line = model.getLineCount();
    ed.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
  }, which);
}
