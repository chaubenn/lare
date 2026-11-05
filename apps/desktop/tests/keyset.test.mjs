import assert from "node:assert/strict";
import { test } from "node:test";
import { keysetFilter, nextCursor } from "../src/lib/keyset.ts";

const at = "2026-11-04T10:00:00.123456+00:00";

test("the filter quotes timestamps and breaks ties on id", () => {
  assert.equal(
    keysetFilter("created_at", { at, id: "b" }),
    `created_at.lt."${at}",and(created_at.eq."${at}",id.lt."b")`,
  );
});

test("a full page continues from its last row", () => {
  const rows = [
    { id: "c", t: "2026-11-04T12:00:00Z" },
    { id: "b", t: at },
  ];
  assert.deepEqual(
    nextCursor(rows, 2, (r) => r.t),
    { at, id: "b" },
  );
});

test("a short page is the last one", () => {
  assert.equal(
    nextCursor([{ id: "a", t: at }], 2, (r) => r.t),
    undefined,
  );
});

test("a last row without an ordering value ends the list", () => {
  assert.equal(
    nextCursor([{ id: "a", t: null }], 1, (r) => r.t),
    undefined,
  );
});
