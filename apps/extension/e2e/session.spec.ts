import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@lare/shared";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from "@playwright/test";
import { FakeDesktop } from "./fakeDesktop";

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

test("a mock interview needs the desktop app, and the panel says so", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  const panel = await openPanel();

  // Mock interviews live on their own tab, away from tracking.
  await expect(panel.getByRole("button", { name: /Start mock interview/ })).toHaveCount(0);
  await panel.getByRole("tab", { name: "Mock interview" }).click();
  // There is no browser recording and no graded/ungraded choice any more.
  await expect(panel.getByRole("checkbox", { name: "Transcript & AI review" })).toHaveCount(0);
  await expect(panel.getByText(/Open the Lare desktop app/)).toBeVisible();
  await expect(panel.getByRole("button", { name: /Start mock interview/ })).toBeDisabled();

  await panel.close();
  await problem.close();
});

test("publish selected cloud inbox problems hands the draft to the desktop app", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  const panel = await openPanel();
  await panel.getByRole("checkbox", { name: "Select Two Sum" }).check();
  // The hand-off is a `lare://` deep link now — the website is a landing page and has no drafts
  // page to open. A custom scheme never becomes a Playwright page, so record what the worker asks
  // Chrome to open instead of waiting for a tab that will not navigate.
  await sw.evaluate(() => {
    (globalThis as unknown as { __opened: string[] }).__opened = [];
    chrome.tabs.create = ((info: { url?: string }) => {
      (globalThis as unknown as { __opened: string[] }).__opened.push(info.url ?? "");
      return Promise.resolve({} as chrome.tabs.Tab);
    }) as typeof chrome.tabs.create;
  });
  await panel.getByRole("button", { name: "Create draft from selected problems" }).click();
  await expect
    .poll(() => sw.evaluate(() => (globalThis as unknown as { __opened?: string[] }).__opened ?? []))
    .toEqual([expect.stringMatching(/^lare:\/\/drafts\/.+/)]);
  // The draft itself is still made without the desktop app running: only the hand-off needs it.
  const request = (await recorded()).find((r) => r.path.includes("publish_practice_problems"));
  expect(request?.body).toMatchObject({ problem_ids: [expect.any(String)] });
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

const startRequest = (tabId: number | null) => ({
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
  tabId,
});

const USER_ID = "00000000-0000-4000-8000-000000000001";
const dotOn = (page: Page) => page.locator("lare-overlay").locator(".lare-rec");
const problemTabId = () =>
  sw.evaluate(
    async () => (await chrome.tabs.query({ url: "http://localhost/problems/*" }))[0]?.id ?? null,
  );
const sessionWrites = async () =>
  (await recorded()).filter((r) => r.path.startsWith("/supabase/rest/v1/sessions"));

test("without the desktop app a mock interview does not start and writes nothing", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();
  const panel = await openPanel();

  const res = await panel.evaluate(
    (req) => chrome.runtime.sendMessage(req),
    startRequest(await problemTabId()),
  );
  expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/desktop app/) });
  expect(await sessionWrites()).toHaveLength(0);
  await expect(dotOn(problem)).toHaveCount(0);

  await panel.close();
  await problem.close();
});

test("a desktop signed in to another account cannot record the interview", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const desktop = new FakeDesktop({
    userId: "someone-else",
    recordingCapable: true,
    protocol: PROTOCOL_VERSION,
  });
  await desktop.start();
  try {
    const problem = await openProblem();
    const panel = await openPanel();
    const res = await panel.evaluate(
      (req) => chrome.runtime.sendMessage(req),
      startRequest(await problemTabId()),
    );
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/different account/) });
    expect(desktop.received.some((m) => m.type === "session.start")).toBe(false);
    await panel.close();
    await problem.close();
  } finally {
    await desktop.stop();
  }
});

test("the desktop app records the interview: start, consent dot, pause and end reach it", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const desktop = new FakeDesktop({
    userId: USER_ID,
    recordingCapable: true,
    protocol: PROTOCOL_VERSION,
  });
  desktop.onMessage((msg, reply) => {
    if (msg.type === "session.start")
      reply({
        type: "recording.state",
        sessionId: msg.sessionId,
        state: "recording",
        startedAt: Date.now(),
        message: null,
      });
  });
  await desktop.start();
  try {
    const problem = await openProblem();
    const panel = await openPanel();

    const res = await panel.evaluate(
      (req) => chrome.runtime.sendMessage(req),
      startRequest(await problemTabId()),
    );
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    const start = desktop.received.find((m) => m.type === "session.start");
    expect(start).toMatchObject({ kind: "interview", facecam: false, mic: true });
    // The session row exists before the desktop is asked to record: its pipeline writes to it.
    expect((await sessionWrites()).length).toBeGreaterThan(0);
    await expect(dotOn(problem)).toHaveCount(1);

    const paused = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "PAUSE_SESSION" }),
    );
    expect(paused).toMatchObject({ ok: true });
    await expect
      .poll(() => desktop.received.filter((m) => m.type === "session.pause").length)
      .toBe(1);

    const ended = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "END_SESSION" }));
    expect(ended, JSON.stringify(ended)).toMatchObject({ ok: true });
    await expect
      .poll(() => desktop.received.find((m) => m.type === "session.end")?.sessionId)
      .toBe(start?.sessionId);
    await expect(dotOn(problem)).toHaveCount(0);

    await panel.close();
    await problem.close();
  } finally {
    await desktop.stop();
  }
});

test("a desktop recording error cancels the start and closes the session", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const desktop = new FakeDesktop({
    userId: USER_ID,
    recordingCapable: true,
    protocol: PROTOCOL_VERSION,
  });
  desktop.onMessage((msg, reply) => {
    if (msg.type === "session.start")
      reply({
        type: "recording.state",
        sessionId: msg.sessionId,
        state: "error",
        startedAt: null,
        message: "Screen recording permission is not granted.",
      });
  });
  await desktop.start();
  try {
    const problem = await openProblem();
    const panel = await openPanel();
    const res = await panel.evaluate(
      (req) => chrome.runtime.sendMessage(req),
      startRequest(await problemTabId()),
    );
    expect(res).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Screen recording permission/),
    });
    const state = await sw.evaluate(
      async () =>
        (await chrome.storage.local.get("lare:state"))["lare:state"] as { interview?: unknown },
    );
    expect(state?.interview ?? null).toBeNull();
    await expect(dotOn(problem)).toHaveCount(0);
    await panel.close();
    await problem.close();
  } finally {
    await desktop.stop();
  }
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
