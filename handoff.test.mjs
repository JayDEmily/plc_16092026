import assert from "node:assert/strict";
import { test } from "node:test";
import * as handoff from "./cco_browser_binding/scripts/handoff.mjs";

function makeSurface(projectName, responses, sent, f1) {
  let url = `https://chatgpt.com/g/g-p-${projectName}/project`;
  let latest = "";
  let draft = "";
  let assistantCount = 0;
  let pending;
  let stale = false;

  const send = async () => {
    sent.push([projectName, draft]);
    if (assistantCount === 0) {
      latest = responses.shift();
      assistantCount++;
    } else {
      pending = responses.shift();
    }
    draft = "";
    stale = true;
    url = `https://chatgpt.com/c/${projectName}`;
  };

  const composer = {
    fill: async text => { draft = text; },
    press: send,
    evaluate: async (fn, expected) => fn({ textContent: draft, innerText: draft, childNodes: [] }, expected),
    waitFor: async () => {},
    count: async () => stale ? 0 : 1,
  };
  const liveComposer = { ...composer, press: send, count: async () => 1, evaluate: async () => true };
  const assistant = {
    count: async () => 1,
    locator: () => ({ count: async () => 1, innerText: async () => latest }),
  };
  const tab = {
    url: async () => url,
    goto: async next => { url = next; },
    playwright: {
      getByRole: (role, { name } = {}) => role === "main" ? { getByRole: () => ({
        waitFor: async () => {}, count: async () => 2, evaluate: async () => false,
      }) } :
        role === "heading" ? { count: async () => 1 } :
        name === "Stop answering" ? { isVisible: async () => false } :
        { waitFor: async () => {}, count: async () => 1, isEnabled: async () => true },
      locator: selector => selector.includes("contenteditable") ? liveComposer :
        ({ count: async () => assistantCount, last: () => assistant }),
    },
  };

  return {
    f1,
    tab,
    composer,
    projectName,
    memoryMode: "PROJECT_ONLY",
    projectUrl: url,
    release: () => {
      latest = pending;
      pending = undefined;
      assistantCount++;
    },
  };
}

let runtimeSerial = 0;
async function freshRuntime(t) {
  t.mock.method(globalThis, "setTimeout", callback => { callback(); return 0; });
  runtimeSerial += 1;
  return await import(`./cco_browser_binding/scripts/handoff.mjs?test=${runtimeSerial}`);
}

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

test("routes unfinished work and symmetric Drive batons through retained conversations exactly once", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", [
    "A working\nunfinished",
    "A initial baton\ncomplete",
    "A more work\nunfinished",
    "A review baton\ncheck latest work in Google Drive",
  ], sent, f1);
  const b = makeSurface("Project B", [
    "B working\nunfinished",
    "B review baton\ncheck latest work in Google Drive",
    "B done\naccomplished",
  ], sent, f1);

  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "unfinished");
  await assert.rejects(runtime.pollA(), /not awaiting/i);

  await runtime.continueA();
  await assert.rejects(runtime.continueA(), /not authorised/i);
  assert.equal(await runtime.pollA(), "WAITING");
  a.release();
  assert.equal(await runtime.pollA(), "complete");

  globalThis.ccoF2 = b;
  await runtime.startB(f1, "original B", b);
  await assert.rejects(runtime.startB(f1, "original B", b), /already been started/i);
  assert.equal(await runtime.pollB(), "unfinished");

  await runtime.continueB();
  await assert.rejects(runtime.continueB(), /not authorised/i);
  assert.equal(await runtime.pollB(), "WAITING");
  b.release();
  assert.equal(await runtime.pollB(), "check latest work in Google Drive");

  await runtime.continueA();
  assert.equal(await runtime.pollA(), "WAITING");
  a.release();
  assert.equal(await runtime.pollA(), "unfinished");

  await runtime.continueA();
  assert.equal(await runtime.pollA(), "WAITING");
  a.release();
  assert.equal(await runtime.pollA(), "check latest work in Google Drive");

  await runtime.continueB();
  assert.equal(await runtime.pollB(), "WAITING");
  b.release();
  assert.equal(await runtime.pollB(), "accomplished");

  assert.deepEqual(sent, [
    ["Project A", "original A"],
    ["Project A", "Continue working."],
    ["Project B", "original B\n\nWORKER_A_RESPONSE:\nA initial baton\ncomplete"],
    ["Project B", "Continue working."],
    ["Project A", "Check latest work in Google Drive."],
    ["Project A", "Continue working."],
    ["Project B", "Check latest work in Google Drive."],
  ]);
});

test("initial Worker A accomplished ends without creating Worker B", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A done\naccomplished"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "accomplished");
  await assert.rejects(runtime.startB(f1, "original B"), /initial complete/i);
});

test("Worker A error stops the run", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A failed\nerror"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  await assert.rejects(runtime.pollA(), /reported error/i);
});

test("Worker B error stops the run", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A baton\ncomplete"], sent, f1);
  const b = makeSurface("Project B", ["B failed\nerror"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "complete");
  globalThis.ccoF2 = b;
  await runtime.startB(f1, "original B", b);
  await assert.rejects(runtime.pollB(), /reported error/i);
});

test("initial Worker A Drive baton is invalid", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A baton\ncheck latest work in Google Drive"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  await assert.rejects(runtime.pollA(), /invalid before Worker B exists/i);
});

test("post-B Worker B complete is invalid", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A baton\ncomplete"], sent, f1);
  const b = makeSurface("Project B", ["B old terminal\ncomplete"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "complete");
  globalThis.ccoF2 = b;
  await runtime.startB(f1, "original B", b);
  await assert.rejects(runtime.pollB(), /complete is invalid/i);
});

test("post-B Worker A complete is invalid", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A initial\ncomplete", "A old terminal\ncomplete"], sent, f1);
  const b = makeSurface("Project B", ["B baton\ncheck latest work in Google Drive"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "complete");
  globalThis.ccoF2 = b;
  await runtime.startB(f1, "original B", b);
  assert.equal(await runtime.pollB(), "check latest work in Google Drive");
  await runtime.continueA();
  assert.equal(await runtime.pollA(), "WAITING");
  a.release();
  await assert.rejects(runtime.pollA(), /complete is invalid/i);
});

test("Worker B accomplished ends successfully", async t => {
  const runtime = await freshRuntime(t);
  const sent = [];
  const f1 = { preserveTab: async () => {} };
  const a = makeSurface("Project A", ["A baton\ncomplete"], sent, f1);
  const b = makeSurface("Project B", ["B done\naccomplished"], sent, f1);
  globalThis.ccoF2 = a;
  await runtime.startA(f1, "original A", a);
  assert.equal(await runtime.pollA(), "complete");
  globalThis.ccoF2 = b;
  await runtime.startB(f1, "original B", b);
  assert.equal(await runtime.pollB(), "accomplished");
});
