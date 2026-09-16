import { createProjectSurface } from "./f2_chatgpt_surface_control/surface_control.mjs";

const instructions = "This is an isolated worker.";
const task = "Describe what a cat looks like in 100 words or less.\n\nEnd your response with exactly:\n\nCCO_STATUS: COMPLETE";
let a;
let response;
let aStarted = false;
let bStarted = false;

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
  // Submit through the focused composer; the runtime's pointer-click path can
  // time out while evaluating an otherwise visible, enabled Send button.
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

// A supplied surface is an explicitly authorised continuation after F2 completed
// configuration but failed before submission. After a Send error the caller
// must establish non-submission first; an ambiguous Send must never be retried.
export async function startA(f1, preparedSurface) {
  if (aStarted) throw new Error("Project A has already been started");
  aStarted = true;
  const surface = preparedSurface ? await prepared(f1, preparedSurface, "Project A", task) :
    await createProjectSurface({ f1, projectName: "Project A", memoryMode: "PROJECT_ONLY", projectInstructions: instructions });
  await submit(surface, task);
  a = surface;
  await a.f1.preserveTab(a.tab);
}

export async function pollA() {
  if (!a) throw new Error("Project A has not been submitted");
  await new Promise(resolve => setTimeout(resolve, 10000));
  const assistant = a.tab.playwright.locator('[data-message-author-role="assistant"]').last();
  let status = "WAITING";
  if (await assistant.count()) {
    const markdown = assistant.locator(".markdown");
    const latest = await (await markdown.count() === 1 ? markdown : assistant).innerText();
    if (latest.endsWith("CCO_STATUS: COMPLETE")) {
      response = latest;
      status = "COMPLETE";
    }
  }
  await a.f1.preserveTab(a.tab);
  return status;
}

export async function sendB(f1, preparedSurface) {
  if (response === undefined) throw new Error("pollA() has not produced COMPLETE");
  if (bStarted) throw new Error("Project B has already been started");
  bStarted = true;
  const b = preparedSurface ? await prepared(f1, preparedSurface, "Project B", response) :
    await createProjectSurface({ f1, projectName: "Project B", memoryMode: "PROJECT_ONLY", projectInstructions: instructions });
  await submit(b, response);
  await f1.preserveTab(b.tab);
}
