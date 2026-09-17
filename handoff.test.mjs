import assert from "node:assert/strict";
import { test } from "node:test";
import * as handoff from "./handoff.mjs";

test("accepts the editor representation of one terminal newline", () => {
  assert.equal(handoff.readbackMatches("first\n\nlast", "first\n\nlast\n"), true);
});

test("rejects changed content and missing additional terminal newlines", () => {
  assert.equal(handoff.readbackMatches("first\n\nwrong", "first\n\nlast\n"), false);
  assert.equal(handoff.readbackMatches("first\n\nlast", "first\n\nlast\n\n"), false);
  assert.equal(handoff.readbackMatches("first\n\nlas", "first\n\nlast"), false);
});

test("preserves the existing line-end spacing tolerance", () => {
  assert.equal(handoff.readbackMatches("first\n\nlast", "first  \n\nlast"), true);
});
