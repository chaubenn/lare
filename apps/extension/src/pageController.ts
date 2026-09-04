/**
 * Isolated-world controller for a LeetCode problem page: detects the current
 * problem, relays Monaco edits and judge results from the MAIN-world script to
 * the service worker, and exposes state/actions to the overlay UI.
 */
import {
  CheckResponseSchema,
  type EditEvent,
  isAccepted,
  isFinalCheck,
  isJudgeFailure,
  type ProblemInfo,
  parseMemoryMb,
  parseRuntimeMs,
  problemSlugFromUrl,
  problemUrl,
  SubmitResponseSchema,
  submissionIdFromPayload,
  submissionIdFromUrl,
  normalizeCheckPayload,
} from "@lare/shared";
import { BRIDGE_MARK, isMainToIsolated, type MainToIsolated } from "./bridge";
import { fetchQuestion, fetchSubmissionDetails, statusLabel } from "./leetcodeApi";
import {
  type CapturedSubmission,
  type QuestionDetails,
  type RuntimeResponse,
  type RuntimeSnapshot,
  type StateBroadcast,
  sendRuntime,
} from "./messages";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export interface PageState {
  snapshot: RuntimeSnapshot | null;
  problem: ProblemInfo | null;
  question: QuestionDetails | null;
  monacoReady: boolean;
  busy: boolean;
  toasts: Toast[];
}

const IGNORED_LANGUAGES = new Set(["plaintext", "json", "markdown", "text"]);
const FLUSH_MS = 2000;

type Listener = () => void;

export class PageController {
  private state: PageState = {
    snapshot: null,
    problem: null,
    question: null,
    monacoReady: false,
    busy: false,
    toasts: [],
  };
  private listeners = new Set<Listener>();
  private toastSeq = 0;

  // Monaco bookkeeping
  private primaryModelId: string | null = null;
  private modelLanguage = new Map<string, string>();
  private buffer: EditEvent[] = [];
  private bufferLanguage: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** True until the first event with a full snapshot has been captured for the current
   *  (session, problem) pair, so a log can always be replayed from its first event. */
  private needsSnapshot = true;
  private lastSnapshotRequestAt = 0;
  private trackedSessionId: string | null = null;

  // Judge bookkeeping
  private pendingSubmissionIds = new Set<number>();
  private handledSubmissionIds = new Set<number>();
  private lastSubmitId: number | null = null;
  private warnedCapture = false;
  private warnedReload = false;

  private currentUrl = "";
  private disposed = false;

  constructor() {
    window.addEventListener("message", this.onWindowMessage);
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    void this.refresh();
    void this.detectProblem(window.location.href);
    // Fallback for SPA navigations the MAIN script might miss.
    setInterval(() => {
      if (window.location.href !== this.currentUrl) void this.detectProblem(window.location.href);
    }, 1000);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("message", this.onWindowMessage);
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  // ---- store ---------------------------------------------------------------
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = (): PageState => this.state;

  private set(patch: Partial<PageState>) {
    this.state = { ...this.state, ...patch };
    const sessionId = this.state.snapshot?.state.session?.sessionId ?? null;
    if (sessionId !== this.trackedSessionId) {
      this.trackedSessionId = sessionId;
      this.buffer = [];
      if (sessionId) {
        this.needsSnapshot = true;
        this.requestSnapshot();
      }
    }
    for (const l of this.listeners) l();
  }

  private requestSnapshot() {
    if (!this.primaryModelId) return;
    const now = Date.now();
    if (now - this.lastSnapshotRequestAt < 500) return;
    this.lastSnapshotRequestAt = now;
    window.postMessage(
      { [BRIDGE_MARK]: 2, kind: "request-snapshot", modelId: this.primaryModelId },
      window.location.origin,
    );
  }

  toast(kind: Toast["kind"], text: string) {
    const id = ++this.toastSeq;
    this.set({ toasts: [...this.state.toasts, { id, kind, text }].slice(-3) });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) }), 5000);
  }

  // ---- runtime -------------------------------------------------------------
  async refresh(): Promise<void> {
    const res = await sendRuntime({ type: "GET_STATE" });
    if (res.ok && res.state) {
      this.set({
        snapshot: {
          state: res.state,
          auth: res.auth ?? null,
          appConnected: res.appConnected ?? false,
        },
      });
      return;
    }
    if (
      !res.ok &&
      !this.warnedReload &&
      /Receiving end does not exist|Extension context invalidated/i.test(res.error)
    ) {
      this.warnedReload = true;
      this.toast("error", "Reload this LeetCode tab — the Lare extension restarted");
    }
  }

  async probeApp(): Promise<boolean> {
    const res = await sendRuntime({ type: "PROBE_APP" });
    if (res.ok && res.state) {
      this.set({
        snapshot: {
          state: res.state,
          auth: res.auth ?? null,
          appConnected: res.appConnected ?? false,
        },
      });
    }
    return res.ok ? (res.appConnected ?? false) : false;
  }

  private onRuntimeMessage = (raw: unknown) => {
    const msg = raw as Partial<StateBroadcast>;
    if (msg?.type !== "STATE_CHANGED" || !msg.state) return;
    this.set({
      snapshot: {
        state: msg.state,
        auth: msg.auth ?? null,
        appConnected: msg.appConnected ?? false,
      },
    });
    if (msg.toast) this.toast(msg.toast.kind, msg.toast.text);
  };

  private async run(fn: () => Promise<RuntimeResponse>): Promise<RuntimeResponse> {
    this.set({ busy: true });
    try {
      const res = await fn();
      if (!res.ok) this.toast("error", res.error);
      else if (res.state) {
        this.set({
          snapshot: {
            state: res.state,
            auth: res.auth ?? null,
            appConnected: res.appConnected ?? false,
          },
        });
      }
      return res;
    } finally {
      this.set({ busy: false });
    }
  }

  start(kind: "practice" | "interview", scope: "session" | "problem", facecam = false) {
    const { problem, question } = this.state;
    return this.run(() =>
      sendRuntime({ type: "START_SESSION", kind, scope, problem, question, facecam, tabId: null }),
    );
  }
  pause = () => this.run(() => sendRuntime({ type: "PAUSE_SESSION" }));
  resume = () => this.run(() => sendRuntime({ type: "RESUME_SESSION" }));
  end = () => this.run(() => sendRuntime({ type: "END_SESSION" }));
  signIn = (provider: "github" | "google") =>
    this.run(() => sendRuntime({ type: "SIGN_IN", provider }));
  openApp = () => sendRuntime({ type: "OPEN_APP" });

  // ---- problem detection ---------------------------------------------------
  private async detectProblem(url: string): Promise<void> {
    this.currentUrl = url;
    const slug = problemSlugFromUrl(url);
    if (!slug) {
      this.set({ problem: null, question: null });
      return;
    }
    if (this.state.problem?.slug === slug) return;
    // Reset Monaco bookkeeping for the new problem.
    this.primaryModelId = null;
    this.buffer = [];
    this.needsSnapshot = true;
    const question = await fetchQuestion(slug);
    if (this.disposed || problemSlugFromUrl(window.location.href) !== slug) return;
    const problem: ProblemInfo = {
      slug,
      frontendId: question?.questionFrontendId ?? null,
      title: question?.title ?? titleFromDocument(slug),
      difficulty: question?.difficulty ?? null,
      url: problemUrl(slug),
      language: this.currentLanguage(),
    };
    const details: QuestionDetails | null = question
      ? { descriptionHtml: question.content, topicTags: question.topicTags }
      : null;
    this.set({ problem, question: details });
    if (this.state.snapshot?.state.session) {
      await sendRuntime({ type: "PROBLEM_OPENED", problem, question: details });
    }
  }

  private currentLanguage(): string | null {
    if (this.primaryModelId) return this.modelLanguage.get(this.primaryModelId) ?? null;
    return null;
  }

  // ---- MAIN-world bridge ---------------------------------------------------
  private onWindowMessage = (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin || !isMainToIsolated(ev.data)) return;
    const msg: MainToIsolated = ev.data;
    switch (msg.kind) {
      case "monaco-ready":
        this.set({ monacoReady: true });
        break;
      case "route":
        void this.detectProblem(msg.url);
        break;
      case "edits":
        this.onEdits(msg);
        break;
      case "submit":
        this.onSubmit(msg.body);
        break;
      case "check":
        void this.onCheck(msg.url, msg.body);
        break;
    }
  };

  private onEdits(msg: Extract<MainToIsolated, { kind: "edits" }>) {
    this.modelLanguage.set(msg.modelId, msg.language);
    if (IGNORED_LANGUAGES.has(msg.language)) return;
    const hasRealChange = msg.events.some((e) => e.c.length > 0);
    if (this.primaryModelId === null) {
      // First code model seen becomes primary; a focused edit elsewhere can take over.
      this.primaryModelId = msg.modelId;
    } else if (msg.modelId !== this.primaryModelId) {
      if (!(msg.focused && hasRealChange)) return;
      // Switch primary model: ask for a fresh snapshot so replay has a base.
      this.primaryModelId = msg.modelId;
      this.needsSnapshot = true;
      this.lastSnapshotRequestAt = 0;
      this.requestSnapshot();
      return;
    }
    if (!this.state.snapshot?.state.session) return;
    let events = msg.events;
    if (this.needsSnapshot) {
      const idx = events.findIndex((e) => e.full !== undefined);
      if (idx === -1) {
        // Deltas without a base are useless for replay; ask for a snapshot and drop them.
        this.requestSnapshot();
        return;
      }
      events = events.slice(idx);
      this.needsSnapshot = false;
    }
    this.bufferLanguage = msg.language;
    this.buffer.push(...events);
    if (this.buffer.length >= 50) this.flush();
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const slug = this.state.problem?.slug;
    if (!slug || this.buffer.length === 0) {
      this.buffer = [];
      return;
    }
    const events = this.buffer;
    this.buffer = [];
    void sendRuntime({ type: "EDITS", slug, language: this.bufferLanguage, events });
  }

  private onSubmit(body: unknown) {
    const parsed = SubmitResponseSchema.safeParse(body);
    const id = parsed.success
      ? Number(parsed.data.submission_id)
      : (submissionIdFromPayload(body) ?? Number.NaN);
    if (!Number.isFinite(id)) return;
    this.lastSubmitId = id;
    this.pendingSubmissionIds.add(id);
    if (this.state.snapshot?.state.session) {
      this.toast("info", "Submission sent — waiting for the judge");
    }
  }

  private async onCheck(url: string, body: unknown) {
    const checkPayload = normalizeCheckPayload(body);
    const parsed = CheckResponseSchema.safeParse(checkPayload);
    if (!parsed.success || !isFinalCheck(parsed.data)) return;
    const check = parsed.data;
    let id =
      submissionIdFromUrl(url) ??
      submissionIdFromPayload(check.submission_id) ??
      submissionIdFromPayload(checkPayload) ??
      submissionIdFromPayload(body);
    if (id == null && this.lastSubmitId != null && this.pendingSubmissionIds.has(this.lastSubmitId)) {
      id = this.lastSubmitId;
    } else if (id == null && this.pendingSubmissionIds.size === 1) {
      id = [...this.pendingSubmissionIds][0]!;
    }
    if (id == null || this.handledSubmissionIds.has(id)) return;
    // Only capture real submissions (not "Run" interpretations) when we saw the submit call,
    // or when the check payload carries judge totals (submissions do, test runs don't).
    const looksLikeSubmission =
      this.pendingSubmissionIds.has(id) || typeof check.total_testcases === "number";
    if (!looksLikeSubmission) return;
    this.handledSubmissionIds.add(id);
    this.pendingSubmissionIds.delete(id);
    if (isJudgeFailure(check)) {
      // Judge/server error: LeetCode shows no verdict, so there is nothing to capture.
      if (this.state.snapshot?.state.session) {
        this.toast("error", "LeetCode's judge failed — submission not captured");
      }
      return;
    }
    const slug = this.state.problem?.slug ?? problemSlugFromUrl(window.location.href);
    if (!slug) return;
    if (!this.state.snapshot?.state.session) {
      if (!this.warnedCapture) {
        this.warnedCapture = true;
        this.toast("info", "Start a Lare session to capture submissions");
      }
      return;
    }

    this.flush();
    const accepted = isAccepted(check);
    // Percentile histograms are computed asynchronously by LeetCode after the verdict;
    // give them a few seconds, but never hold the capture hostage to them.
    const { details, runtimeDistribution, memoryDistribution } = await Promise.race([
      fetchSubmissionDetails(id, { retries: accepted ? 4 : 1, delayMs: 800 }),
      new Promise<Awaited<ReturnType<typeof fetchSubmissionDetails>>>((resolve) => {
        setTimeout(
          () => resolve({ details: null, runtimeDistribution: null, memoryDistribution: null }),
          8000,
        );
      }),
    ]);

    const submission: CapturedSubmission = {
      leetcodeSubmissionId: id,
      submittedAt: Date.now(),
      lang: details?.lang?.name ?? check.lang ?? null,
      langVerbose: details?.lang?.verboseName ?? check.pretty_lang ?? null,
      statusDisplay: statusLabel(
        details?.statusCode ?? check.status_code,
        check.status_msg ?? null,
      ),
      statusCode: details?.statusCode ?? check.status_code ?? null,
      accepted,
      runtimeMs: details?.runtime ?? parseRuntimeMs(check.status_runtime ?? check.display_runtime),
      runtimeDisplay: details?.runtimeDisplay ?? check.status_runtime ?? null,
      runtimePercentile: details?.runtimePercentile ?? check.runtime_percentile ?? null,
      memoryMb: parseMemoryMb(details?.memory ?? check.memory ?? check.status_memory ?? null),
      memoryDisplay: details?.memoryDisplay ?? check.status_memory ?? null,
      memoryPercentile: details?.memoryPercentile ?? check.memory_percentile ?? null,
      totalCorrect: check.total_correct ?? null,
      totalTestcases: check.total_testcases ?? null,
      code: details?.code ?? null,
      runtimeDistribution,
      memoryDistribution,
    };
    const res = await sendRuntime({ type: "SUBMISSION", slug, submission });
    if (!res.ok) {
      this.toast("error", res.error ?? "Could not save submission");
    }
  }
}

function titleFromDocument(slug: string): string {
  const t = document.title.replace(/\s*-\s*LeetCode\s*$/i, "").trim();
  if (t && !/^leetcode$/i.test(t)) return t;
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
