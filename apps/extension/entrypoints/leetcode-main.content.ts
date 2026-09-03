/**
 * MAIN-world content script: runs inside the page's JS context so it can reach
 * `window.monaco` and observe the judge endpoints. It has no chrome.* access and
 * forwards everything to the isolated content script via window.postMessage.
 */
import {
  SNAPSHOT_EVERY_EVENTS,
  SNAPSHOT_EVERY_MS,
  isCheckUrl,
  isSubmitUrl,
} from "@lare/shared";
import {
  BRIDGE_MARK,
  type DistributiveOmit,
  type IsolatedToMain,
  type MainToIsolated,
  isIsolatedToMain,
} from "@/src/bridge";

// Minimal structural types for the parts of Monaco we touch.
interface MonacoChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}
interface MonacoModel {
  uri: { toString(): string };
  getValue(): string;
  getVersionId(): number;
  getLanguageId(): string;
  onDidChangeContent(cb: (e: { changes: MonacoChange[]; versionId: number }) => void): unknown;
  isDisposed?(): boolean;
}
interface MonacoEditor {
  getModel(): MonacoModel | null;
  hasTextFocus(): boolean;
}
interface MonacoNamespace {
  editor: {
    getModels(): MonacoModel[];
    getEditors?(): MonacoEditor[];
    onDidCreateModel(cb: (m: MonacoModel) => void): unknown;
  };
}

const MATCHES = ["https://leetcode.com/problems/*", "https://leetcode.com/contest/*/problems/*"];
const fixtureOrigin = import.meta.env.WXT_DEV_FIXTURE_ORIGIN;
if (import.meta.env.DEV && fixtureOrigin) MATCHES.push(`${fixtureOrigin}/*`);

export default defineContentScript({
  matches: MATCHES,
  world: "MAIN",
  runAt: "document_start",
  main() {
    const post = (msg: DistributiveOmit<MainToIsolated, typeof BRIDGE_MARK>) => {
      window.postMessage({ [BRIDGE_MARK]: 1, ...msg }, window.location.origin);
    };

    // ---- judge endpoint taps ------------------------------------------------
    const absolute = (u: string) => {
      try {
        return new URL(u, window.location.href).href;
      } catch {
        return u;
      }
    };
    const consider = (url: string, bodyText: string) => {
      const abs = absolute(url);
      const kind = isSubmitUrl(abs) ? "submit" : isCheckUrl(abs) ? "check" : null;
      if (!kind) return;
      try {
        post({ kind, url: abs, body: JSON.parse(bodyText) });
      } catch {
        // non-JSON body; ignore
      }
    };

    const originalFetch = window.fetch;
    window.fetch = async function lareFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const res = await originalFetch.call(this, input, init);
      try {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
        const abs = absolute(url);
        if (isSubmitUrl(abs) || isCheckUrl(abs)) {
          res
            .clone()
            .text()
            .then((t) => consider(url, t))
            .catch(() => undefined);
        }
      } catch {
        // ignore
      }
      return res;
    } as typeof window.fetch;

    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function lareOpen(this: XMLHttpRequest & { __lareUrl?: string }, ...args: unknown[]) {
      this.__lareUrl = String(args[1] ?? "");
      return (xhrOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function lareSend(this: XMLHttpRequest & { __lareUrl?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
      this.addEventListener("load", () => {
        const url = this.__lareUrl;
        if (!url) return;
        const abs = absolute(url);
        if (isSubmitUrl(abs) || isCheckUrl(abs)) {
          try {
            consider(url, typeof this.responseText === "string" ? this.responseText : "");
          } catch {
            // ignore
          }
        }
      });
      return xhrSend.call(this, body);
    };

    // ---- SPA route changes --------------------------------------------------
    const notifyRoute = () => post({ kind: "route", url: window.location.href });
    const wrapHistory = (name: "pushState" | "replaceState") => {
      const original = history[name];
      history[name] = function lareHistory(this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        queueMicrotask(notifyRoute);
        return result;
      } as History["pushState"];
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
    window.addEventListener("popstate", notifyRoute);

    // ---- Monaco -------------------------------------------------------------
    const attached = new WeakSet<MonacoModel>();
    const counters = new WeakMap<MonacoModel, { events: number; lastSnapshotAt: number }>();
    let monacoRef: MonacoNamespace | null = null;

    const isFocused = (model: MonacoModel): boolean => {
      const editors = monacoRef?.editor.getEditors?.() ?? [];
      return editors.some((ed) => ed.getModel() === model && ed.hasTextFocus());
    };

    const snapshotOf = (model: MonacoModel) => ({
      t: Date.now(),
      v: model.getVersionId(),
      c: [],
      full: model.getValue(),
    });

    const attachModel = (model: MonacoModel) => {
      if (attached.has(model)) return;
      attached.add(model);
      counters.set(model, { events: 0, lastSnapshotAt: Date.now() });
      const modelId = model.uri.toString();
      post({
        kind: "edits",
        modelId,
        language: model.getLanguageId(),
        focused: isFocused(model),
        events: [snapshotOf(model)],
      });
      model.onDidChangeContent((e) => {
        const c = counters.get(model) ?? { events: 0, lastSnapshotAt: 0 };
        c.events += 1;
        const now = Date.now();
        const snapshot = c.events >= SNAPSHOT_EVERY_EVENTS || now - c.lastSnapshotAt >= SNAPSHOT_EVERY_MS;
        if (snapshot) {
          c.events = 0;
          c.lastSnapshotAt = now;
        }
        counters.set(model, c);
        const event = {
          t: now,
          v: e.versionId,
          c: e.changes.map((ch) => [ch.rangeOffset, ch.rangeLength, ch.text] as [number, number, string]),
          ...(snapshot ? { full: model.getValue() } : {}),
        };
        post({
          kind: "edits",
          modelId,
          language: model.getLanguageId(),
          focused: isFocused(model),
          events: [event],
        });
      });
    };

    const attachMonaco = (monaco: MonacoNamespace) => {
      monacoRef = monaco;
      for (const m of monaco.editor.getModels()) attachModel(m);
      monaco.editor.onDidCreateModel(attachModel);
      post({ kind: "monaco-ready" });
    };

    let tries = 0;
    const poll = setInterval(() => {
      const monaco = (window as unknown as { monaco?: MonacoNamespace }).monaco;
      if (monaco?.editor) {
        clearInterval(poll);
        attachMonaco(monaco);
      } else if (++tries > 600) {
        clearInterval(poll); // give up after 5 minutes
      }
    }, 500);

    // ---- requests from the isolated script ----------------------------------
    window.addEventListener("message", (ev: MessageEvent) => {
      if (ev.source !== window || !isIsolatedToMain(ev.data)) return;
      const msg: IsolatedToMain = ev.data;
      if (msg.kind === "request-snapshot" && monacoRef) {
        const model = monacoRef.editor.getModels().find((m) => m.uri.toString() === msg.modelId);
        if (model) {
          post({
            kind: "edits",
            modelId: msg.modelId,
            language: model.getLanguageId(),
            focused: isFocused(model),
            events: [snapshotOf(model)],
          });
        }
      }
    });
  },
});
