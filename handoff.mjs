import { createProjectSurface } from "./f2_chatgpt_surface_control/surface_control.mjs";

const COMPLETION_FOOTER = "complete";
let a;
let response;
let aStarted = false;
let bStarted = false;
let aDeadline;
let aReloadUrl;

function requireJob(job, label) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error(`${label} job must be an object`);
  const keys = ["projectName", "projectInstructions", "prompt"];
  for (const key of keys) {
    if (typeof job[key] !== "string") throw new Error(`${label}.${key} must be a string`);
  }
  if (!job.projectName) throw new Error(`${label}.projectName must be nonempty`);
  return job;
}

async function submit(surface, text) {
  await surface.composer.fill(text);
  const exact = await surface.composer.evaluate((el, expected) => {
    if (el.innerText === expected || el.textContent === expected) return true;
    const paragraphs = Array.from(el.childNodes);
    if (!paragraphs.length || paragraphs.some(p => p.nodeType !== 1 || p.tagName !== "P")) return false;
    return paragraphs.map(p => p.textContent).join("\n") === expected;
  }, text);
  if (!exact) throw new Error("Exact composer readback mismatch; submission not attempted");
  const send = surface.tab.playwright.getByRole("button", { name: "Send prompt", exact: true });
  await send.waitFor({ state: "visible", timeoutMs: 15000 });
  if (await send.count() !== 1 || !(await send.isEnabled())) throw new Error("Send control unavailable or ambiguous");
  await surface.composer.press("Enter", { timeoutMs: 15000 });
}

async function prepared(f1, surface, job, expectedText) {
  if (surface !== globalThis.ccoF2 || surface.f1 !== f1 ||
      surface.projectName !== job.projectName || surface.memoryMode !== "PROJECT_ONLY" ||
      !surface.composer || await surface.tab.url() !== surface.projectUrl ||
      await surface.tab.playwright.getByRole("heading", { name: "No chats yet", exact: true }).count() !== 1 ||
      !(await surface.composer.evaluate((el, expected) => el.textContent === "" ||
        el.innerText === expected || Array.from(el.childNodes).every(p => p.nodeType === 1 && p.tagName === "P") &&
        Array.from(el.childNodes).map(p => p.textContent).join("\n") === expected, expectedText))) {
    throw new Error("Prepared surface is not the retained, empty, unsent Project");
  }
  return surface;
}

export async function startA(f1, job, preparedSurface) {
  if (aStarted) throw new Error("Worker A has already been started");
  job = requireJob(job, "workerA");
  aStarted = true;
  const surface = preparedSurface ? await prepared(f1, preparedSurface, job, job.prompt) :
    await createProjectSurface({
      f1,
      projectName: job.projectName,
      memoryMode: "PROJECT_ONLY",
      projectInstructions: job.projectInstructions,
    });
  await submit(surface, job.prompt);
  a = surface;
  aDeadline = Date.now() + 30000;
  await a.f1.preserveTab(a.tab);
}

export async function pollA() {
  if (!a) throw new Error("Worker A has not been submitted");
  await new Promise(resolve => setTimeout(resolve, 10000));
  const expired = Date.now() >= aDeadline;
  if (expired && aReloadUrl === undefined) {
    const url = new URL(await a.tab.url());
    if (url.origin !== "https://chatgpt.com" || !url.pathname.includes("/c/")) {
      throw new Error("Worker A has no saved conversation URL; do not resubmit");
    }
    aReloadUrl = url.href;
    await a.tab.goto(aReloadUrl);
    await a.f1.preserveTab(a.tab);
    return "WAITING";
  }
  if (aReloadUrl !== undefined) {
    if (await a.tab.url() !== aReloadUrl) throw new Error("Worker A left the saved conversation after refresh");
    await a.tab.playwright.locator('[data-message-author-role="assistant"]').last()
      .waitFor({ state: "visible", timeoutMs: 15000 });
  }
  const assistant = a.tab.playwright.locator('[data-message-author-role="assistant"]').last();
  let status = "WAITING";
  if (await assistant.count()) {
    const markdown = assistant.locator(".markdown");
    const latest = await (await markdown.count() === 1 ? markdown : assistant).innerText();
    const generating = await a.tab.playwright.getByRole("button", { name: "Stop answering", exact: true }).isVisible();
    const lines = latest.replace(/\r\n/g, "\n").split("\n");
    if (!generating && lines.at(-1) === COMPLETION_FOOTER) {
      response = latest;
      status = "COMPLETE";
    }
  }
  await a.f1.preserveTab(a.tab);
  if (expired && status !== "COMPLETE") throw new Error("Worker A completion timed out after 30 seconds; do not resubmit");
  return status;
}

export async function sendB(f1, job, preparedSurface) {
  if (response === undefined) throw new Error("pollA() has not produced COMPLETE");
  if (bStarted) throw new Error("Worker B has already been started");
  job = requireJob(job, "workerB");
  bStarted = true;
  const prompt = `${job.prompt}\n\nWORKER_A_RESPONSE:\n${response}`;
  const b = preparedSurface ? await prepared(f1, preparedSurface, job, prompt) :
    await createProjectSurface({
      f1,
      projectName: job.projectName,
      memoryMode: "PROJECT_ONLY",
      projectInstructions: job.projectInstructions,
    });
  await submit(b, prompt);
  await f1.preserveTab(b.tab);
}
