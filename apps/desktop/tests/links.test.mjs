import assert from "node:assert/strict";
import { test } from "node:test";
import { leetCodeImageSrc, leetCodeProblemUrl } from "../src/lib/links.ts";

test("the LeetCode link is built from the slug", () => {
  assert.equal(leetCodeProblemUrl("two-sum"), "https://leetcode.com/problems/two-sum/");
  assert.equal(leetCodeProblemUrl("3sum"), "https://leetcode.com/problems/3sum/");
});

test("a slug that is not one gets no link", () => {
  for (const slug of [
    null,
    undefined,
    "",
    "Two-Sum",
    "../login",
    "two-sum/../../x",
    "two sum",
    "a?b",
    "x".repeat(129),
  ]) {
    assert.equal(leetCodeProblemUrl(slug), null, String(slug));
  }
});

test("LeetCode images are kept, and made absolute https", () => {
  const upload = "https://assets.leetcode.com/uploads/2020/10/03/remove_ex1.jpg";
  assert.equal(leetCodeImageSrc(upload), upload);
  assert.equal(
    leetCodeImageSrc("http://s3-lc-upload.s3.amazonaws.com/uploads/2018/10/12/a.png"),
    "https://s3-lc-upload.s3.amazonaws.com/uploads/2018/10/12/a.png",
  );
  assert.equal(
    leetCodeImageSrc("/static/images/problemset/a.png"),
    "https://leetcode.com/static/images/problemset/a.png",
  );
  assert.equal(
    leetCodeImageSrc("//assets.leetcode.com/a.png"),
    "https://assets.leetcode.com/a.png",
  );
});

test("images from anywhere else are dropped", () => {
  for (const src of [
    null,
    "",
    "https://attacker.test/px.gif",
    "https://assets.leetcode.com.attacker.test/px.gif",
    "https://attacker.test@assets.leetcode.com/px.gif",
    "https://assets.leetcode.com:8443/px.gif",
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "javascript:alert(1)",
  ]) {
    assert.equal(leetCodeImageSrc(src), null, String(src));
  }
});
