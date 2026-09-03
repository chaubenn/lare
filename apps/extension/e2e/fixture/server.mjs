// Fixture server for extension e2e tests: serves a fake LeetCode problem page with
// real Monaco, mocks the judge + GraphQL endpoints, and mocks the Supabase REST /
// Storage / Auth endpoints the service worker talks to. Records every request so
// tests can assert on what the extension wrote.

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const monacoVs = resolve(dirname(require.resolve("monaco-editor/package.json")), "min/vs");
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

/** @type {{ method: string; path: string; body: unknown; headers: Record<string,string> }[]} */
const requests = [];
let checkCalls = new Map();
let submitCounter = 1000;
let submissionIdForRun = 0;

const question = {
  questionId: "1",
  questionFrontendId: "1",
  title: "Two Sum",
  titleSlug: "two-sum",
  content:
    "<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>, return indices.</p>",
  difficulty: "Easy",
  topicTags: [
    { name: "Array", slug: "array" },
    { name: "Hash Table", slug: "hash-table" },
  ],
};

const distribution = JSON.stringify({
  lang: "python3",
  distribution: [
    ["140", "0.1"],
    ["386", "2.5"],
    ["633", "15.2"],
    ["879", "5"],
    ["1126", "1.2"],
    ["1219", "0.9"],
  ],
});

function submissionDetails(id, code) {
  return {
    runtime: 1219,
    runtimeDisplay: "1219 ms",
    runtimePercentile: 17.99,
    runtimeDistribution: distribution,
    memory: 22000000,
    memoryDisplay: "22 MB",
    memoryPercentile: 5.34,
    memoryDistribution: JSON.stringify({
      lang: "python3",
      distribution: [
        ["21.5", "10"],
        ["22", "5.34"],
      ],
    }),
    code,
    timestamp: Math.floor(Date.now() / 1000),
    statusCode: 10,
    lang: { name: "python3", verboseName: "Python3" },
    question: { questionId: "1", titleSlug: "two-sum" },
    runtimeError: null,
    compileError: null,
    lastTestcase: null,
    _id: id,
  };
}

const submittedCode = new Map();

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const type = req.headers["content-type"] ?? "";
  if (type.includes("json") && buf.length) {
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return buf.toString("utf8");
    }
  }
  return buf;
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, filePath) {
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error("not file");
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "OPTIONS") return json(res, 204, {});

  // ---- test control ---------------------------------------------------------
  if (path === "/__requests") return json(res, 200, requests);
  if (path === "/__reset") {
    requests.length = 0;
    checkCalls = new Map();
    submittedCode.clear();
    return json(res, 200, { ok: true });
  }

  // ---- static: fixture page + monaco -----------------------------------------
  if (path.startsWith("/problems/") && method === "GET") {
    return serveStatic(res, join(here, "index.html"));
  }
  if (path.startsWith("/vs/")) {
    return serveStatic(res, join(monacoVs, path.slice("/vs/".length)));
  }

  const body = await readBody(req);
  const isBuffer = Buffer.isBuffer(body);
  requests.push({
    method,
    path: path + url.search,
    body: isBuffer ? { bytes: body.length, base64: body.toString("base64") } : body,
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
  });

  // ---- LeetCode judge ----------------------------------------------------------
  if (method === "POST" && /^\/problems\/[a-z0-9-]+\/submit\/?$/.test(path)) {
    const id = ++submitCounter;
    submittedCode.set(id, body?.typed_code ?? "");
    return json(res, 200, { submission_id: id });
  }
  if (method === "POST" && /^\/problems\/[a-z0-9-]+\/interpret_solution\/?$/.test(path)) {
    submissionIdForRun = ++submitCounter;
    return json(res, 200, { interpret_id: `runcode_${submissionIdForRun}` });
  }
  const check = /^\/submissions\/detail\/([^/]+)\/check\/?$/.exec(path);
  if (check && method === "GET") {
    const key = check[1];
    const n = (checkCalls.get(key) ?? 0) + 1;
    checkCalls.set(key, n);
    if (n === 1) return json(res, 200, { state: "PENDING" });
    if (key.startsWith("runcode_")) {
      // "Run" results carry no judge totals.
      return json(res, 200, {
        state: "SUCCESS",
        status_code: 10,
        status_msg: "Accepted",
        run_success: true,
        status_runtime: "40 ms",
        code_answer: ["[0,1]"],
        lang: "python3",
      });
    }
    return json(res, 200, {
      state: "SUCCESS",
      status_code: 10,
      status_msg: "Accepted",
      submission_id: key,
      lang: "python3",
      pretty_lang: "Python3",
      run_success: true,
      status_runtime: "1219 ms",
      display_runtime: "1219",
      memory: 22000000,
      status_memory: "22 MB",
      runtime_percentile: 17.99,
      memory_percentile: 5.34,
      total_correct: 57,
      total_testcases: 57,
      question_id: "1",
      finished: true,
    });
  }
  if (method === "POST" && path === "/graphql") {
    const q = String(body?.query ?? "");
    if (q.includes("lareQuestion")) return json(res, 200, { data: { question } });
    if (q.includes("lareSubmissionDetails")) {
      const id = Number(body?.variables?.submissionId);
      return json(res, 200, {
        data: { submissionDetails: submissionDetails(id, submittedCode.get(id) ?? "") },
      });
    }
    return json(res, 200, { data: {} });
  }

  // ---- Supabase mock -----------------------------------------------------------
  if (path.startsWith("/supabase/")) {
    const sub = path.slice("/supabase".length);
    if (sub.startsWith("/auth/v1/token")) {
      return json(res, 200, fakeSession());
    }
    if (sub.startsWith("/auth/v1/user")) {
      return json(res, 200, fakeSession().user);
    }
    if (sub.startsWith("/rest/v1/profiles")) {
      return json(res, 200, [{ handle: "tester", display_name: "Test User", avatar_url: null }]);
    }
    const table = /^\/rest\/v1\/([a-z_]+)/.exec(sub)?.[1];
    if (table) {
      const wantsRepresentation = String(req.headers.prefer ?? "").includes(
        "return=representation",
      );
      if (method === "POST") {
        const rows = Array.isArray(body) ? body : [body ?? {}];
        const withIds = rows.map((r) => ({ id: crypto.randomUUID(), ...r }));
        if (wantsRepresentation) {
          const accept = String(req.headers.accept ?? "");
          return json(res, 201, accept.includes("vnd.pgrst.object") ? withIds[0] : withIds);
        }
        return json(res, 201, []);
      }
      if (method === "PATCH") return json(res, 200, wantsRepresentation ? [body] : []);
      if (method === "GET") return json(res, 200, []);
    }
    if (sub.startsWith("/storage/v1/object/")) {
      const key = sub.slice("/storage/v1/object/".length);
      return json(res, 200, { Key: key, Id: crypto.randomUUID() });
    }
    return json(res, 404, { message: `unmocked supabase path ${sub}` });
  }

  res.writeHead(404);
  res.end("not found");
});

export function fakeSession() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  const payload = Buffer.from(
    JSON.stringify({
      sub: "00000000-0000-4000-8000-000000000001",
      role: "authenticated",
      aud: "authenticated",
      exp,
    }),
  ).toString("base64url");
  return {
    access_token: `${header}.${payload}.fakesignature`,
    token_type: "bearer",
    expires_in: 86400,
    expires_at: exp,
    refresh_token: "fake-refresh-token",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "tester@example.com",
      app_metadata: { provider: "email" },
      user_metadata: { name: "Test User" },
      created_at: new Date().toISOString(),
    },
  };
}

server.listen(PORT, () => {
  console.log(`fixture server listening on http://localhost:${PORT}`);
});
