import { createProjectSurface } from "./f2_chatgpt_surface_control/surface_control.mjs";

const PROJECT_INSTRUCTIONS = "Complete the exact task in the user prompt. End your response with a final line exactly equal to:\ncomplete";
const POLL_MS = 10000;
const DEADLINE_MS = 30000;

let a;
let b;
let aResponse;
let aStarted = false;
let bStarted = false;

function requireBrief(brief, label) {
  if (typeof brief !== "string" || brief.length === 0) throw new Error(`${label} must be a nonempty string`);
  return brief;
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

async function prepared(f1, surface, projectName, expectedText) {
  if (surface !== globalThis.ccoF2 || surface.f1 !== f1 ||
      surface.projectName !== projectName || surface.memoryMode !== "PROJECT_ONLY" ||
      !surface.composer || await surface.tab.url() !== surface.projectUrl ||
      await surface.tab.playwright.getByRole("heading", { name: "No chats yet", exact: true }).count() !== 1 ||
      !(await surface.composer.evaluate((el, expected) => el.textContent === "" ||
        el.innerText === expected || Array.from(el.childNodes).every(p => p.nodeType === 1 && p.tagName === "P") &&
        Array.from(el.childNodes).map(p => p.textContent).join("\n") === expected, expectedText))) {
    throw new Error("Prepared surface is not the retained, empty, unsent Project");
  }
  return surface;
}

async function startWorker(f1, projectName, prompt, preparedSurface) {
  const surface = preparedSurface ? await prepared(f1, preparedSurface, projectName, prompt) :
    await createProjectSurface({
      f1,
      projectName,
      memoryMode: "PROJECT_ONLY",
      projectInstructions: PROJECT_INSTRUCTIONS,
    });
  await submit(surface, prompt);
  await f1.preserveTab(surface.tab);
  return { surface, deadline: Date.now() + DEADLINE_MS, reloadUrl: undefined };
}

async function pollWorker(worker, label) {
  if (!worker) throw new Error(`${label} has not been submitted`);
  await new Promise(resolve => setTimeout(resolve, POLL_MS));
  const expired = Date.now() >= worker.deadline;
  const surface = worker.surface;

  if (expired && worker.reloadUrl === undefined) {
    const url = new URL(await surface.tab.url());
    if (url.origin !== "https://chatgpt.com" || !url.pathname.includes("/c/")) {
      throw new Error(`${label} has no saved conversation URL; do not resubmit`);
    }
    worker.reloadUrl = url.href;
    await surface.tab.goto(worker.reloadUrl);
    await surface.f1.preserveTab(surface.tab);
    return { status: "WAITING" };
  }

  if (worker.reloadUrl !== undefined) {
    if (await surface.tab.url() !== worker.reloadUrl) throw new Error(`${label} left the saved conversation after refresh`);
    await surface.tab.playwright.locator('[data-message-author-role="assistant"]').last()
      .waitFor({ state: "visible", timeoutMs: 15000 });
  }

  const assistant = surface.tab.playwright.locator('[data-message-author-role="assistant"]').last();
  let latest;
  let status = "WAITING";
  if (await assistant.count()) {
    const markdown = assistant.locator(".markdown");
    latest = await (await markdown.count() === 1 ? markdown : assistant).innerText();
    const generating = await surface.tab.playwright.getByRole("button", { name: "Stop answering", exact: true }).isVisible();
    const lines = latest.replace(/\r\n/g, "\n").split("\n");
    const finalLine = lines.filter(line => line.trim() !== "").at(-1)?.toLowerCase() ?? "";
    if (!generating) {
      if (finalLine.includes("error")) status = "error";
      else if (finalLine.includes("incomplete")) status = "incomplete";
      else if (finalLine.includes("complete")) status = "complete";
    }
  }

  await surface.f1.preserveTab(surface.tab);
  if (status === "incomplete" || status === "error") throw new Error(`${label} reported ${status}:\n${latest}`);
  if (expired && status !== "complete") throw new Error(`${label} completion timed out after 30 seconds; do not resubmit`);
  return { status, latest };
}

export async function startA(f1, brief, preparedSurface) {
  if (aStarted) throw new Error("Worker A has already been started");
  brief = requireBrief(brief, "WORKER_A_BRIEF");
  aStarted = true;
  a = await startWorker(f1, "Project A", brief, preparedSurface);
}

export async function pollA() {
  const result = await pollWorker(a, "Worker A");
  if (result.status === "complete") aResponse = result.latest;
  return result.status;
}

export async function startB(f1, brief, preparedSurface) {
  if (aResponse === undefined) throw new Error("pollA() has not produced complete");
  if (bStarted) throw new Error("Worker B has already been started");
  brief = requireBrief(brief, "WORKER_B_BRIEF");
  bStarted = true;
  const prompt = `${brief}\n\nWORKER_A_RESPONSE:\n${aResponse}`;
  b = await startWorker(f1, "Project B", prompt, preparedSurface);
}

export async function pollB() {
  const result = await pollWorker(b, "Worker B");
  return result.status;
}
