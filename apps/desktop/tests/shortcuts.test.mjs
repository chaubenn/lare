import assert from "node:assert/strict";
import { test } from "node:test";
import { captureAccelerator, describeAccelerator } from "../src/lib/shortcuts.ts";

const press = (code, mods = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("a modifier on its own is still pending", () => {
  assert.deepEqual(captureAccelerator(press("MetaLeft", { metaKey: true }), true), {
    kind: "pending",
  });
  assert.deepEqual(captureAccelerator(press("ShiftRight", { shiftKey: true }), false), {
    kind: "pending",
  });
});

test("Cmd+Space on a Mac and Ctrl+Space elsewhere", () => {
  assert.deepEqual(captureAccelerator(press("Space", { metaKey: true }), true), {
    kind: "accelerator",
    value: "Command+Space",
  });
  assert.deepEqual(captureAccelerator(press("Space", { ctrlKey: true }), false), {
    kind: "accelerator",
    value: "Control+Space",
  });
});

test("the Windows key is Super, and Shift follows the other modifiers", () => {
  assert.deepEqual(captureAccelerator(press("KeyH", { metaKey: true, shiftKey: true }), false), {
    kind: "accelerator",
    value: "Super+Shift+H",
  });
  assert.deepEqual(
    captureAccelerator(press("KeyP", { ctrlKey: true, altKey: true, shiftKey: true }), true),
    { kind: "accelerator", value: "Control+Alt+Shift+P" },
  );
});

test("keys are named by position, not by what Option or Shift turns them into", () => {
  assert.equal(captureAccelerator(press("Digit7", { altKey: true }), true).value, "Alt+7");
  assert.equal(captureAccelerator(press("ArrowUp", { ctrlKey: true }), false).value, "Control+Up");
  assert.equal(captureAccelerator(press("Backquote", { ctrlKey: true }), false).value, "Control+`");
});

test("a chord needs a real modifier, except for function keys", () => {
  assert.equal(captureAccelerator(press("Space"), true).kind, "rejected");
  assert.equal(captureAccelerator(press("KeyA", { shiftKey: true }), false).kind, "rejected");
  assert.equal(captureAccelerator(press("F9"), true).value, "F9");
});

test("keys with no accelerator name are rejected", () => {
  assert.equal(captureAccelerator(press("CapsLock", { ctrlKey: true }), false).kind, "rejected");
  assert.equal(captureAccelerator(press("Escape", { ctrlKey: true }), false).kind, "rejected");
});

test("keycaps follow the platform", () => {
  assert.deepEqual(describeAccelerator("CommandOrControl+Space", true), ["⌘", "Space"]);
  assert.deepEqual(describeAccelerator("CommandOrControl+Space", false), ["Ctrl", "Space"]);
  assert.deepEqual(describeAccelerator("Control+Alt+Shift+p", true), ["⌃", "⌥", "⇧", "P"]);
  assert.deepEqual(describeAccelerator("Super+Up", false), ["Win", "Up"]);
});
