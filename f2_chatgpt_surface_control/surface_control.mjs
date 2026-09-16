// F2_CHATGPT_SURFACE_CONTROL. Invoke in the trusted Node REPL with the frozen
// F1 surface: await createProjectSurface({ f1: ccoF1, projectName, memoryMode,
// projectInstructions }). All strings are opaque; no prompt is submitted.

const MEMORY = { DEFAULT: "Default memory", PROJECT_ONLY: "Project-only memory" };
const TIMEOUT = 15000;

function requireCondition(condition, message) {
  if (!condition) throw new Error(`F2_SURFACE_BLOCKED: ${message}`);
}

async function one(locator) {
  await locator.waitFor({ state: "visible", timeoutMs: TIMEOUT });
  requireCondition(await locator.count() === 1, "Required DOM control is ambiguous");
  return locator;
}

async function click(locator) {
  await (await one(locator)).click({ timeoutMs: TIMEOUT });
}

async function exactValue(locator, value, label) {
  const field = await one(locator);
  requireCondition(await field.evaluate(element => element.value) === value,
    `${label} does not exactly match the caller string`);
}

// Only call with a CCO-owned Tab obtained from F1.
export async function openSidebar(tab) {
  const p = tab.playwright;
  const newProject = p.getByRole("button", { name: "New project", exact: true });
  const close = p.getByRole("button", { name: "Close sidebar", exact: true });
  if (!(await close.isVisible())) {
    // ChatGPT's sidebar toggle; do not use the global New Chat shortcut,
    // which would leave the caller's Project.
    await (await one(p.getByRole("textbox", { name: "Chat with ChatGPT", exact: true })))
      .press("Control+Shift+s", { timeoutMs: TIMEOUT });
  }
  await one(newProject);
}

export async function createProjectSurface({ f1, projectName, memoryMode, projectInstructions }) {
  requireCondition(typeof projectName === "string" && projectName.length > 0,
    "projectName must be a nonempty string");
  requireCondition(typeof projectInstructions === "string", "projectInstructions must be a string");
  requireCondition(Object.hasOwn(MEMORY, memoryMode), "memoryMode must be DEFAULT or PROJECT_ONLY");
  requireCondition(f1 === globalThis.ccoF1 && f1?.browser, "Supply the retained, bound CCO F1 surface");

  let tab, p, surface;
  for (let attempt = 0; attempt < 2; attempt++) {
    tab = await f1.newTab();
    p = tab.playwright;
    // Live handles only; retain partial work except for the initial transient retry.
    surface = { f1, browser: f1.browser, tab, projectName, memoryMode, projectUrl: null, composer: null };
    globalThis.ccoF2 = surface;
    try {
      await f1.preserveTab(tab);
      await tab.goto("https://chatgpt.com/");
      await one(p.getByRole("textbox", { name: "Chat with ChatGPT", exact: true }));
      await openSidebar(tab);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      const seen = new Set();
      let transient = false;
      for (let cause = error; cause != null && !seen.has(cause); cause = cause.cause) {
        seen.add(cause);
        if (String(cause.message ?? cause).includes("Timed out after 3000ms waiting for CDP command Runtime.evaluate")) {
          transient = true;
          break;
        }
      }
      if (!transient) throw error;
      await f1.closeTab(tab, { authorized: true });
    }
  }
  await click(p.getByRole("button", { name: "New project", exact: true }));

  const creation = p.getByRole("dialog", { name: "Create project", exact: true });
  const name = creation.getByRole("textbox", { name: "Project name", exact: true });
  await (await one(name)).fill(projectName, { timeoutMs: TIMEOUT });
  await exactValue(name, projectName, "Project name");
  await (await one(creation.getByRole("button", { name: "Default memory", exact: true })))
    .press("Enter", { timeoutMs: TIMEOUT });
  const option = creation.getByRole("menuitemradio").filter({
    has: p.getByRole("heading", { name: MEMORY[memoryMode], exact: true }),
  });
  await click(option);
  await one(creation.getByRole("button", { name: MEMORY[memoryMode], exact: true }));
  await exactValue(name, projectName, "Project name");
  await click(creation.getByRole("button", { name: "Create project", exact: true }));
  await creation.waitFor({ state: "hidden", timeoutMs: TIMEOUT });
  await p.waitForURL("https://chatgpt.com/g/g-p-*/project", { timeoutMs: TIMEOUT });

  const main = p.getByRole("main");
  const projectUrl = new URL(await tab.url());
  surface.projectUrl = projectUrl.href;

  async function settings() {
    requireCondition(await tab.url() === surface.projectUrl, "Tab left the created Project");
    await click(main.getByRole("button", { name: "Show project details", exact: true }));
    await click(p.getByRole("menu", { name: "Show project details", exact: true })
      .getByRole("menuitem", { name: "Project settings", exact: true }));
    const dialog = p.getByRole("dialog", { name: "Project settings", exact: true });
    await exactValue(dialog.getByRole("textbox", { name: "Project name", exact: true }), projectName, "Saved Project name");
    const memory = await one(dialog.getByRole("button", { name: "Memory", exact: true }));
    requireCondition(await memory.textContent() === MEMORY[memoryMode], "Saved Project memory mode differs");
    return dialog;
  }

  const dialog = await settings();
  const instructions = dialog.getByRole("textbox", { name: "Instructions", exact: true });
  await (await one(instructions)).fill(projectInstructions, { timeoutMs: TIMEOUT });
  await exactValue(instructions, projectInstructions, "Project instructions");
  // Leave the field to commit the settings form's edit, then close it.
  await instructions.press("Tab", { timeoutMs: TIMEOUT });
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  if (await save.isVisible()) await click(save);
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  if (await close.isVisible()) await click(close);

  // Open the same Project's fresh, empty composer. Never use global New chat.
  surface.composer = await one(main.getByRole("textbox", { name: `New chat in ${projectName}`, exact: true }));
  requireCondition(await tab.url() === surface.projectUrl, "Fresh chat is outside the created Project");
  // ChatGPT may restore a draft even in this newly created, CCO-owned Project.
  // Clear that unsent draft before enforcing the empty-composer postcondition.
  await surface.composer.fill("", { timeoutMs: TIMEOUT });
  requireCondition(await surface.composer.evaluate(element => element.textContent) === "",
    "Project fresh-chat composer is not empty");
  requireCondition(await tab.url() === surface.projectUrl, "Fresh chat is outside the created Project");
  await f1.preserveTab(tab);
  // This is an unsent fresh Project chat. ChatGPT assigns a persisted chat id
  // after submission, which is outside F2. Mark the tab again on later turns.
  return Object.freeze(surface);
}
