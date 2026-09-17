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

test("routes repeated return-to-A turns through the retained conversations exactly once", async t => {
  t.mock.method(globalThis, "setTimeout", callback => { callback(); return 0; });
  const runtime = await import(`./handoff.mjs?loop=${Date.now()}`);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  function surface(projectName, responses) {
    let url = `https://chatgpt.com/g/g-p-${projectName}/project`;
    let latest = "";
    let draft = "";
    let assistantCount = 0;
    let pending;
    const composer = {
      fill: async text => { draft = text; },
      press: async () => {
        sent.push([projectName, draft]);
        if (assistantCount === 0) { latest = responses.shift(); assistantCount++; }
        else pending = responses.shift();
        draft = "";
        url = `https://chatgpt.com/c/${projectName}`;
      },
      evaluate: async (fn, expected) => fn({ textContent: draft, innerText: draft, childNodes: [] }, expected),
      waitFor: async () => {},
      count: async () => 1,
    };
    const assistant = { count: async () => 1, locator: () => ({ count: async () => 1, innerText: async () => latest }) };
    const tab = {
      url: async () => url,
      playwright: {
        getByRole: (role, { name } = {}) => role === "main" ? { getByRole: () => ({
          waitFor: async () => {}, count: async () => 2,
          evaluate: async () => false,
        }) } :
          role === "heading" ? { count: async () => 1 } :
          name === "Stop answering" ? { isVisible: async () => false } :
          { waitFor: async () => {}, count: async () => 1, isEnabled: async () => true },
        locator: () => ({ count: async () => assistantCount, last: () => assistant }),
      },
    };
    return { f1, tab, composer, projectName, memoryMode: "PROJECT_ONLY", projectUrl: url,
      release: () => { latest = pending; pending = undefined; assistantCount++; } };
  }
  const a = surface("Project A", ["A result\ncomplete", "A next\ncomplete", "A again\ncomplete"]);
  const b = surface("Project B", ["B asks\nreturn to A", "B asks again\nreturn to A", "B done\ncomplete"]);

  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "complete");
  globalThis.ccoF2 = b;
  await runtime.startB(f1, "original B", b);
  for (let turn = 0; turn < 2; turn++) {
    assert.equal(await runtime.pollB(), "return to A");
    await assert.rejects(runtime.pollB(), /not awaiting/i);
    await runtime.continueA();
    await assert.rejects(runtime.continueA(), /already|not authorised/i);
    assert.equal(await runtime.pollA(), "WAITING");
    a.release();
    assert.equal(await runtime.pollA(), "complete");
    await assert.rejects(runtime.pollA(), /not awaiting/i);
    await runtime.continueB();
    await assert.rejects(runtime.continueB(), /already|not authorised/i);
    assert.equal(await runtime.pollB(), "WAITING");
    b.release();
  }
  assert.equal(await runtime.pollB(), "complete");
  assert.deepEqual(sent, [
    ["Project A", "original A"],
    ["Project B", "original B\n\nWORKER_A_RESPONSE:\nA result\ncomplete"],
    ["Project A", "Check latest work in Google Drive."],
    ["Project B", "Check latest work in Google Drive."],
    ["Project A", "Check latest work in Google Drive."],
    ["Project B", "Check latest work in Google Drive."],
  ]);
  await assert.rejects(runtime.continueA(), /already|not authorised/i);
});
