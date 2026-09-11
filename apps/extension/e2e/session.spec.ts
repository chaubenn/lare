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
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // chrome-extension://<id>/popup.html — needed to drive the popup, which is now
  // the only UI the extension has.
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

async function openPopup() {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText("Tracking submissions")).toBeVisible();
  return popup;
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

test("the popup lists tracked problems without a hand-off button, and keeps listing them", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();

  // Solve one problem: the popup just shows it. Posting happens in the desktop app,
  // which reads the inbox straight from Supabase, so there is nothing to hand off here.
  const first = await openProblem("two-sum");
  await submitOnce(first);
  let popup = await openPopup();
  await expect(popup.getByText("Two Sum")).toBeVisible();
  await expect(popup.getByRole("button", { name: /Review .* in Lare/ })).toHaveCount(0);
  await popup.close();

  // Nothing local or server-side got cleared just by looking at the popup.
  const sb = (await recorded()).filter((r) => r.path.startsWith("/supabase/"));
  expect(sb.filter((r) => r.method === "DELETE")).toHaveLength(0);
  expect(sb.filter((r) => r.path.startsWith("/supabase/rest/v1/session_problems"))).toHaveLength(1);

  // A second problem accumulates alongside the first, not on top of it. (The fixture
  // page always reports "Two Sum" regardless of slug, so two rows is the signal.)
  const second = await openProblem("add-two-numbers");
  await submitOnce(second);
  popup = await openPopup();
  await expect(popup.locator(".problems li")).toHaveCount(2);

  await popup.close();
  await second.close();
  await first.close();
});

test("mock interview cannot be started from the popup without the desktop app", async () => {
  await fetch(`${BASE}/__reset`);
  await resetExtensionState();
  const problem = await openProblem();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // The popup is the only control surface now.
  await expect(popup.getByText("Tracking submissions")).toBeVisible();
  const start = popup.getByRole("button", { name: /Start mock interview/ });
  await expect(start).toBeDisabled();
  await expect(popup.getByText(/Open the Lare desktop app/)).toBeVisible();

  await popup.close();
  await problem.close();
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
