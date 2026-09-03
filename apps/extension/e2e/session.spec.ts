import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
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
const USER_ID = "00000000-0000-4000-8000-000000000001";

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

let context: BrowserContext;
let sw: Worker;

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

async function recorded(): Promise<RecordedRequest[]> {
  return (await (await fetch(`${BASE}/__requests`)).json()) as RecordedRequest[];
}

async function openProblem(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/problems/two-sum/`);
  await page.waitForSelector("body[data-monaco-ready='1']");
  return page;
}

test("practice problem: start, edit, submit, pause, end -> synced draft", async () => {
  await fetch(`${BASE}/__reset`);
  const page = await openProblem();
  const overlay = page.locator("lare-overlay");

  // Idle launcher visible; menu shows the problem title fetched via GraphQL.
  await overlay.getByRole("button", { name: "Lare" }).click();
  await expect(overlay.getByText("Two Sum")).toBeVisible();
  await expect(overlay.getByText("Easy")).toBeVisible();
  await overlay.getByRole("button", { name: /Start problem/ }).click();

  // Active pill with a running timer.
  const pill = overlay.locator(".lare-pill");
  await expect(pill).toBeVisible();
  await expect(pill.locator(".lare-time")).toHaveText(/^0:0[0-9]$/);
  await expect(pill.locator(".lare-kind")).toHaveText("Problem");

  // Type into the code editor (not the plaintext testcase editor).
  await focusEditorEnd(page, "editor");
  await page.keyboard.type("        return [0, 1]\n");

  // Edits from the plaintext testcase editor must be ignored.
  await focusEditorEnd(page, "tc");
  await page.keyboard.type("\n[3,2,4]\n6");

  // "Run" must not be captured as a submission; "Submit" must.
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByTestId("result")).toHaveText("run:Accepted");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("result")).toHaveText("submit:Accepted");
  await expect(overlay.getByText(/Accepted · 1219 ms · beats 17\.99% · captured/)).toBeVisible();
  await expect(pill.getByText("1 problem · 1 submission")).toBeVisible();

  // Pause freezes the timer; resume continues.
  await pill.getByRole("button", { name: "Pause" }).click();
  await expect(pill.getByRole("button", { name: "Resume" })).toBeVisible();
  const frozen = await pill.locator(".lare-time").textContent();
  await page.waitForTimeout(2200);
  expect(await pill.locator(".lare-time").textContent()).toBe(frozen);
  await pill.getByRole("button", { name: "Resume" }).click();
  await expect(pill.getByRole("button", { name: "Pause" })).toBeVisible();

  // End with confirmation.
  await pill.getByRole("button", { name: "End" }).click();
  await pill.getByRole("button", { name: "Confirm end" }).click();
  await expect(overlay.getByText(/Session saved/)).toBeVisible();
  await expect(overlay.locator(".lare-fab")).toBeVisible();
  await expect(overlay.locator(".lare-menu")).toHaveCount(0);

  // ---- assert what the service worker wrote to (mock) Supabase ----------------
  const reqs = await recorded();
  const sb = reqs.filter((r) => r.path.startsWith("/supabase/"));
  const table = (name: string, method: string) =>
    sb.filter((r) => r.method === method && r.path.startsWith(`/supabase/rest/v1/${name}`));

  const sessions = table("sessions", "POST");
  expect(sessions).toHaveLength(1);
  const sessionRow = sessions[0]?.body as Record<string, unknown>;
  expect(sessionRow.user_id).toBe(USER_ID);
  expect(sessionRow.kind).toBe("practice");
  expect(sessionRow.scope).toBe("problem");
  expect(sessions[0]?.headers.authorization).toMatch(/^Bearer /);

  const events = table("session_events", "POST").map((r) => (r.body as { type: string }).type);
  expect(events).toEqual(["start", "problem_open", "pause", "resume"]);

  const problems = table("session_problems", "POST");
  expect(problems).toHaveLength(1);
  const problemRow = problems[0]?.body as Record<string, unknown>;
  expect(problemRow.slug).toBe("two-sum");
  expect(problemRow.title).toBe("Two Sum");
  expect(problemRow.difficulty).toBe("Easy");
  expect(problemRow.topic_tags).toEqual([
    { name: "Array", slug: "array" },
    { name: "Hash Table", slug: "hash-table" },
  ]);
  expect(String(problemRow.description_html)).toContain("Given an array of integers");

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

  // Session ended + timer persisted.
  const sessionPatches = table("sessions", "PATCH").map((r) => r.body as Record<string, unknown>);
  const ended = sessionPatches.find((b) => b.status === "ended");
  expect(ended).toBeTruthy();
  expect(typeof ended?.active_ms).toBe("number");
  expect(ended?.active_ms as number).toBeGreaterThan(1000);

  // Edit log uploaded as gzip JSON and replays to the final code.
  const upload = sb.find((r) => r.path.startsWith("/supabase/storage/v1/object/session-data/"));
  expect(upload).toBeTruthy();
  expect(upload?.path).toMatch(
    new RegExp(`/session-data/${USER_ID}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.json\\.gz`),
  );
  const raw = upload?.body as { base64: string } | undefined;
  expect(raw?.base64).toBeTruthy();
  const buf = Buffer.from(raw?.base64 ?? "", "base64");
  const log = JSON.parse(
    gunzipSync(extractGzipPayload(buf, upload?.headers["content-type"] ?? "")).toString("utf8"),
  ) as {
    version: number;
    slug: string;
    language?: string;
    events: { t: number; v: number; c: [number, number, string][]; full?: string }[];
  };
  expect(log.version).toBe(1);
  expect(log.slug).toBe("two-sum");
  expect(log.language).toBe("python");
  expect(log.events.length).toBeGreaterThan(10);
  expect(log.events[0]?.full).toContain("class Solution");
  // Replay and compare with the code that was submitted.
  const finalText = replay(log.events);
  expect(finalText).toContain("return [0, 1]");
  expect(finalText).not.toContain("[3,2,4]");

  // Draft post created.
  const posts = table("posts", "POST");
  expect(posts).toHaveLength(1);
  const postRow = posts[0]?.body as Record<string, unknown>;
  expect(postRow.status).toBe("draft");
  expect(postRow.title).toBe("Two Sum");

  // Nothing captured after the session ended.
  await focusEditorEnd(page, "editor");
  await page.keyboard.type("x");
  await page.waitForTimeout(2500);
  const after = await recorded();
  expect(after.filter((r) => r.path.startsWith("/supabase/storage/")).length).toBe(1);

  await page.close();
});

test("mock interview is blocked when the desktop app is not running", async () => {
  await fetch(`${BASE}/__reset`);
  const page = await openProblem();
  const overlay = page.locator("lare-overlay");
  await overlay.getByRole("button", { name: "Lare" }).click();
  const interview = overlay.getByRole("button", { name: /Mock interview/ });
  await expect(interview).toBeDisabled();
  await expect(overlay.getByText("Lare desktop app not detected")).toBeVisible();
  await page.close();
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

/** supabase-js uploads with multipart/form-data in some versions; handle both raw and multipart bodies. */
function extractGzipPayload(buf: Buffer, contentType: string): Buffer {
  if (!contentType.startsWith("multipart/form-data")) return buf;
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return buf;
  const marker = Buffer.from(`--${boundary}`);
  let start = buf.indexOf(marker);
  while (start !== -1) {
    const headerEnd = buf.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;
    const header = buf.subarray(start, headerEnd).toString("latin1");
    const next = buf.indexOf(marker, headerEnd);
    const partBody = buf.subarray(headerEnd + 4, next === -1 ? buf.length : next - 2);
    if (/application\/gzip/.test(header) || /filename=/.test(header)) return partBody;
    start = next;
  }
  return buf;
}

function replay(events: { c: [number, number, string][]; full?: string }[]): string {
  let text = "";
  for (const e of events) {
    if (e.full !== undefined) {
      text = e.full;
      continue;
    }
    const changes = [...e.c].sort((a, b) => b[0] - a[0]);
    for (const [o, l, x] of changes) text = text.slice(0, o) + x + text.slice(o + l);
  }
  return text;
}
