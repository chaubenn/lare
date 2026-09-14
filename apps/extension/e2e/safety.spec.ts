import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PROTOCOL_VERSION } from "@lare/shared";
import { expect, test } from "@playwright/test";
import { gradingCapable, PcmStream } from "../src/pcm";
import { repairGroup, restoreGroup, startGroup } from "../src/tabGroup";

test("old desktop recording permission never implies PCM grading capability", () => {
  const old = { protocol: PROTOCOL_VERSION, userId: "owner", recordingCapable: true };
  expect(gradingCapable(old, "owner")).toBe(false);
  expect(gradingCapable({ ...old, capabilities: ["pcm16k-f32-v1"] }, "owner")).toBe(true);
  expect(gradingCapable({ ...old, capabilities: ["pcm16k-f32-v1"] }, "other")).toBe(false);
  expect(gradingCapable({ ...old, capabilities: ["pcm16k-f32-v1"] }, null)).toBe(false);
  expect(gradingCapable({ ...old, protocol: -1, capabilities: ["pcm16k-f32-v1"] }, "owner")).toBe(
    false,
  );
});

test("PCM buffer exhaustion explicitly fails grading instead of dropping samples silently", async () => {
  const reports: { message: string; failed?: boolean }[] = [];
  const pcm = new PcmStream("session", "owner", (message, failed) =>
    reports.push({ message, failed }),
  );
  pcm.push(new Float32Array(16000 * 300 + 1));
  expect(reports).toEqual([{ message: expect.stringContaining("now ungraded"), failed: true }]);
  expect(await pcm.stop()).toBe(false);
});

test("worklet averages channels, batches PCM, flushes the tail and emits nothing while paused", () => {
  const frames: Float32Array[] = [];
  type Processor = {
    process(inputs: Float32Array[][]): boolean;
    port: { onmessage: (event: { data: { paused: boolean; flush?: boolean } }) => void };
  };
  let ProcessorClass: (new () => Processor) | undefined;
  runInNewContext(readFileSync(new URL("../public/pcm-worklet.js", import.meta.url), "utf8"), {
    Float32Array,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (samples: unknown) => {
          if (samples instanceof Float32Array) frames.push(samples);
        },
      };
    },
    registerProcessor: (_name: string, processorClass: new () => Processor) => {
      ProcessorClass = processorClass;
    },
  });
  if (!ProcessorClass) throw new Error("Worklet not registered");
  const processor = new ProcessorClass();
  processor.process([[new Float32Array([1]), new Float32Array([-1])]]);
  expect(frames).toHaveLength(0);
  processor.port.onmessage({ data: { paused: false } });
  processor.process([[new Float32Array(4096).fill(1), new Float32Array(4096).fill(-0.5)]]);
  expect(frames[0]?.length).toBe(4096);
  expect(frames[0]?.every((value) => value === 0.25)).toBe(true);
  processor.process([[new Float32Array([0.5, -0.5])]]);
  processor.port.onmessage({ data: { paused: true, flush: true } });
  expect(Array.from(frames[1] ?? [])).toEqual([0.5, -0.5]);
  processor.process([[new Float32Array([1])]]);
  expect(frames).toHaveLength(2);
});

function browser(grouped: boolean, siblings = false) {
  const storage: Record<string, unknown> = {};
  const groups = new Map<
    number,
    { id: number; title: string; color: string; collapsed: boolean; windowId: number }
  >();
  const tab = { id: 1, groupId: grouped ? 10 : -1, windowId: 1 };
  if (grouped)
    groups.set(10, { id: 10, title: "My work", color: "blue", collapsed: true, windowId: 1 });
  let next = 20;
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: storage[key] }),
          set: async (value: object) => {
            Object.assign(storage, structuredClone(value));
          },
          remove: async (key: string) => {
            delete storage[key];
          },
        },
      },
      tabs: {
        get: async () => ({ ...tab }),
        group: async ({ groupId }: { groupId?: number }) => {
          if (tab.groupId !== -1 && !(siblings && tab.groupId === 10)) groups.delete(tab.groupId);
          const id = groupId ?? next++;
          if (!groups.has(id))
            groups.set(id, {
              id,
              title: "",
              color: "grey",
              collapsed: false,
              windowId: tab.windowId,
            });
          tab.groupId = id;
          return id;
        },
        ungroup: async () => {
          groups.delete(tab.groupId);
          tab.groupId = -1;
        },
      },
      tabGroups: {
        get: async (id: number) => {
          const group = groups.get(id);
          if (!group) throw new Error("Group removed");
          return { ...group };
        },
        update: async (id: number, update: object) => {
          const group = groups.get(id);
          if (!group) throw new Error("Group removed");
          Object.assign(group, update);
        },
      },
    },
  });
  return { tab, groups, storage };
}

test("recording group restores an originally ungrouped tab", async () => {
  const b = browser(false);
  await startGroup(1);
  expect(b.groups.get(b.tab.groupId)?.color).toBe("red");
  await restoreGroup();
  expect(b.tab.groupId).toBe(-1);
  expect(b.storage["lare:recording-group"]).toBeUndefined();
});

test("recording group restores existing user grouping without editing siblings", async () => {
  const b = browser(true, true);
  await startGroup(1);
  expect(b.groups.get(10)?.title).toBe("My work");
  await restoreGroup();
  expect(b.tab.groupId).toBe(10);
  expect(b.groups.get(10)?.color).toBe("blue");
});

test("single-tab original group is recreated with its title, color and collapse state", async () => {
  const b = browser(true);
  await startGroup(1);
  expect(b.groups.has(10)).toBe(false);
  await restoreGroup();
  expect(b.groups.get(b.tab.groupId)).toMatchObject({
    title: "My work",
    color: "blue",
    collapsed: true,
  });
});

test("only one repair is allowed, persisted across subsequent repair calls", async () => {
  const b = browser(false);
  await startGroup(1);
  b.tab.groupId = -1;
  await repairGroup();
  expect(b.tab.groupId).not.toBe(-1);
  b.tab.groupId = -1;
  await repairGroup();
  await repairGroup();
  await restoreGroup();
  expect(b.tab.groupId).toBe(-1);
});

test("PCM sends ordered float samples, resumes from desktop offset, and completes grading", async () => {
  const frames: Float32Array[] = [];
  const controls: Record<string, unknown>[] = [];
  let nextSample = 0;
  let socket: FakeSocket | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() {
      socket = this;
      setTimeout(() => this.onopen?.(), 0);
    }
    reply(value: object) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
    send(value: string | ArrayBuffer) {
      if (typeof value !== "string") {
        const samples = new Float32Array(value);
        frames.push(samples);
        nextSample += samples.length;
        this.reply({ type: "pcm.ack", sessionId: "session", nextSample });
        return;
      }
      const msg = JSON.parse(value);
      controls.push(msg);
      if (msg.type === "hello")
        this.reply({
          type: "hello.ack",
          protocol: PROTOCOL_VERSION,
          userId: "owner",
          capabilities: ["pcm16k-f32-v1"],
        });
      if (msg.type === "pcm.start")
        this.reply({ type: "pcm.ready", sessionId: "session", nextSample });
      if (msg.type === "pcm.end") this.reply({ type: "pcm.complete", sessionId: "session" });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const original = globalThis.WebSocket;
  Object.assign(globalThis, { WebSocket: FakeSocket, __EXT_VERSION__: "1.0.0" });
  const messages: string[] = [];
  const pcm = new PcmStream("session", "owner", (message) => messages.push(message));
  try {
    await pcm.start();
    pcm.push(new Float32Array([0.5, -0.5]));
    if (!socket) throw new Error("Socket was not created");
    socket.close();
    pcm.push(new Float32Array([0.25, -0.25]));
    await expect.poll(() => frames.length).toBe(2);
    expect(frames.flatMap((f) => [...f])).toEqual([0.5, -0.5, 0.25, -0.25]);
    expect(controls.filter((c) => c.type === "pcm.start").map((c) => c.resumeFrom)).toEqual([0, 2]);
    expect(await pcm.stop()).toBe(true);
    expect(controls.find((c) => c.type === "pcm.end")?.totalSamples).toBe(4);
    expect(messages.some((m) => m.includes("Buffering"))).toBe(true);
  } finally {
    pcm.close();
    Object.assign(globalThis, { WebSocket: original });
  }
});
