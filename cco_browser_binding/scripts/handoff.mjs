import { createProjectSurface } from "../../f2_chatgpt_surface_control/surface_control.mjs";

const PROJECT_INSTRUCTIONS = "Complete the exact task in the user prompt.";
const POLL_MS = 15000;
const DEADLINE_MS = 2400000;
const WORK_CONTINUE_PROMPT = "Continue working.";
const DRIVE_CONTINUE_PROMPT = "Check latest work in Google Drive.";

let a;
let b;
let aResponse;
let aStarted = false;
let bStarted = false;
let aPolling = false;
let bPolling = false;
let phase = "INITIAL_A";
let pendingContinuation;

function requireBrief(brief, label) {
  if (typeof brief !== "string" || brief.length === 0) throw new Error(`${label} must be a nonempty string`);
  return brief;
}

function classifyFinalLine(text) {
  const finalLine = (text.replace(/\r\n/g, "\n").split("\n").filter(line => line.trim() !== "").at(-1)?.toLowerCase() ?? "")
    .replace(/\s+/g, " ").trim();
  if (finalLine.includes("incomplete")) return "INVALID_SUPERSEDED";
  if (finalLine.includes("error")) return "error";
  if (finalLine.includes("unfinished")) return "unfinished";
  if (finalLine.includes("complete")) return "complete";
  if (finalLine.includes("check latest work in google drive")) return "check latest work in Google Drive";
  if (finalLine.includes("accomplished")) return "accomplished";
  return "WAITING";
}

export function readbackMatches(staged, expected) {
  const withoutLineEndSpaces = value => value.replace(/[ \t]+(?=\n|$)/g, "");
  const matches = value => staged === value || withoutLineEndSpaces(staged) === withoutLineEndSpaces(value);
  // ProseMirror omits one terminal LF from a filled draft's paragraph readback.
  return matches(expected) || (expected.endsWith("\n") && matches(expected.slice(0, -1)));
}

async function submit(surface, text) {
  await surface.composer.fill(text);
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
  return { surface, deadline: Date.now() + DEADLINE_MS, reloadUrl: undefined, conversationUrl: undefined };
}

async function continueWorker(worker, label, prompt) {
  if (!worker) throw new Error(`${label} has no retained conversation`);
  const surface = worker.surface;
  const url = await surface.tab.url();
  const parsed = new URL(url);
  if (url !== worker.conversationUrl || parsed.origin !== "https://chatgpt.com" || !parsed.pathname.includes("/c/") ||
      worker.reloadUrl !== undefined && url !== worker.reloadUrl) {
    throw new Error(`${label} is not in its saved conversation; do not resubmit`);
  }
  const composer = surface.tab.playwright.locator(
    '[contenteditable="true"][role="textbox"][aria-label="Chat with ChatGPT"]',
  );
  await composer.waitFor({ state: "visible", timeoutMs: 15000 });
  if (await composer.count() !== 1) {
    throw new Error(`${label} conversation composer is unavailable or ambiguous`);
  }
  worker.priorAssistantCount = await surface.tab.playwright.locator('[data-message-author-role="assistant"]').count();
  worker.deadline = Date.now() + DEADLINE_MS;
  worker.reloadUrl = undefined;
  await submit({ ...surface, composer }, prompt);
  if (await surface.tab.url() !== url) throw new Error(`${label} left its saved conversation after submission`);
  await surface.f1.preserveTab(surface.tab);
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

  if (worker.priorAssistantCount !== undefined) {
    const count = await surface.tab.playwright.locator('[data-message-author-role="assistant"]').count();
    if (count <= worker.priorAssistantCount) {
      await surface.f1.preserveTab(surface.tab);
      if (expired) throw new Error(`${label} completion timed out after 40 minutes; do not resubmit`);
      return { status: "WAITING" };
    }
    worker.priorAssistantCount = undefined;
  }

  const assistant = surface.tab.playwright.locator('[data-message-author-role="assistant"]').last();
  let latest;
  let status = "WAITING";
  if (await assistant.count()) {
    const markdown = assistant.locator(".markdown");
    latest = await (await markdown.count() === 1 ? markdown : assistant).innerText();
    const generating = await surface.tab.playwright.getByRole("button", { name: "Stop answering", exact: true }).isVisible();
    if (!generating) status = classifyFinalLine(latest);
  }

  await surface.f1.preserveTab(surface.tab);
  if (status === "INVALID_SUPERSEDED") throw new Error(`${label} reported a superseded terminal outcome:\n${latest}`);
  if (status === "error") throw new Error(`${label} reported error:\n${latest}`);
  if (expired && status === "WAITING") throw new Error(`${label} completion timed out after 40 minutes; do not resubmit`);
  if (status !== "WAITING") {
    const url = await surface.tab.url();
    const parsed = new URL(url);
    if (parsed.origin !== "https://chatgpt.com" || !parsed.pathname.includes("/c/") ||
        worker.conversationUrl !== undefined && url !== worker.conversationUrl) {
      throw new Error(`${label} left its saved conversation; do not resubmit`);
    }
    worker.conversationUrl = url;
  }
  return { status, latest };
}

function authorise(worker, reason) {
  if (pendingContinuation !== undefined) throw new Error("A worker continuation is already authorised");
  pendingContinuation = { worker, reason };
}

function consume(worker) {
  if (pendingContinuation?.worker !== worker) throw new Error(`Worker ${worker} continuation is not authorised`);
  const pending = pendingContinuation;
  pendingContinuation = undefined;
  return pending;
}

export async function startA(f1, brief, preparedSurface) {
  if (aStarted) throw new Error("Worker A has already been started");
  if (phase !== "INITIAL_A" || bStarted) throw new Error("Worker A cannot be started after iterative routing begins");
  brief = requireBrief(brief, "WORKER_A_BRIEF");
  aStarted = true;
  a = await startWorker(f1, "Project A", brief, preparedSurface);
  aPolling = true;
}

export async function pollA() {
  if (!aPolling) throw new Error("Worker A is not awaiting a response");
  const result = await pollWorker(a, "Worker A");
  if (result.status === "WAITING") return result.status;
  aPolling = false;

  if (phase === "INITIAL_A") {
    if (result.status === "unfinished") authorise("A", "WORK");
    else if (result.status === "complete") aResponse = result.latest;
    else if (result.status === "accomplished") {}
    else if (result.status === "check latest work in Google Drive") {
      throw new Error("Worker A Drive baton is invalid before Worker B exists");
    }
    return result.status;
  }

  if (result.status === "unfinished") authorise("A", "WORK");
  else if (result.status === "check latest work in Google Drive") authorise("B", "DRIVE");
  else if (result.status === "accomplished") {}
  else if (result.status === "complete") throw new Error("Worker A complete is invalid after Worker B exists");
  return result.status;
}

export async function continueA() {
  const pending = consume("A");
  if (!a) throw new Error("Worker A has no retained conversation for this continuation");
  const prompt = pending.reason === "WORK" ? WORK_CONTINUE_PROMPT : DRIVE_CONTINUE_PROMPT;
  await continueWorker(a, "Worker A", prompt);
  aPolling = true;
}

export async function startB(f1, brief, preparedSurface) {
  if (aResponse === undefined) throw new Error("pollA() has not produced initial complete");
  if (bStarted) throw new Error("Worker B has already been started");
  if (pendingContinuation !== undefined) throw new Error("Cannot start Worker B while a continuation is pending");
  brief = requireBrief(brief, "WORKER_B_BRIEF");
  bStarted = true;
  const prompt = `${brief}\n\nWORKER_A_RESPONSE:\n${aResponse}`;
  b = await startWorker(f1, "Project B", prompt, preparedSurface);
  phase = "ITERATIVE";
  bPolling = true;
}

export async function startBFromCompletedA(f1, brief, response) {
  if (aStarted || bStarted || aResponse !== undefined) throw new Error("B continuation requires a fresh handoff module");
  response = requireBrief(response, "WORKER_A_RESPONSE");
  const finalLine = response.replace(/\r\n/g, "\n").split("\n").filter(line => line.trim() !== "").at(-1)?.toLowerCase() ?? "";
  if (finalLine.includes("incomplete") || classifyFinalLine(response) !== "complete") {
    throw new Error("Worker A response does not report initial complete");
  }
  aStarted = true;
  aResponse = response;
  await startB(f1, brief);
}

export async function pollB() {
  if (!bPolling) throw new Error("Worker B is not awaiting a response");
  const result = await pollWorker(b, "Worker B");
  if (result.status === "WAITING") return result.status;
  bPolling = false;

  if (result.status === "unfinished") authorise("B", "WORK");
  else if (result.status === "check latest work in Google Drive") authorise("A", "DRIVE");
  else if (result.status === "accomplished") {}
  else if (result.status === "complete") throw new Error("Worker B complete is invalid after Worker B exists");
  return result.status;
}

export async function continueB() {
  const pending = consume("B");
  if (!b) throw new Error("Worker B has no retained conversation for this continuation");
  const prompt = pending.reason === "WORK" ? WORK_CONTINUE_PROMPT : DRIVE_CONTINUE_PROMPT;
  await continueWorker(b, "Worker B", prompt);
  bPolling = true;
}
