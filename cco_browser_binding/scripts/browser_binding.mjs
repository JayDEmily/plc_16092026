import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function blocked(code, detail, cause) {
  return Object.assign(new Error(`${code}: ${detail}`, { cause }), { code, detail });
}

// Invoke only inside Codex's trusted Node REPL. No transport or backend fallback.
export async function bootstrap(resolution) {
  globalThis.ccoF1 = undefined;
  if (resolution?.schema !== "CCO_BROWSER_RUNTIME_RESOLUTION_V3" || resolution.status !== "PASS") {
    throw blocked("BROWSER_RUNTIME_UNAVAILABLE", resolution?.error ?? "Successful V3 resolution required");
  }
  let agent;
  try {
    const identity = resolution.runtime_identity;
    const packagePath = dirname(dirname(identity.runtime_client_path));
    const manifestPath = join(packagePath, ".codex-plugin", "plugin.json");
    const clientPath = join(packagePath, "scripts", "browser-client.mjs");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (dirname(packagePath) !== resolve(resolution.cache_root) ||
        manifest.name !== "browser" || manifest.version !== basename(packagePath) ||
        identity.plugin_version !== manifest.version ||
        resolve(identity.manifest_path) !== manifestPath ||
        resolve(identity.runtime_client_path) !== clientPath ||
        pathToFileURL(clientPath).href !== identity.runtime_client_import_specifier ||
        !(await stat(clientPath)).isFile()) {
      throw new Error("Installed package no longer matches the resolved browser manifest/client path");
    }
    if (typeof globalThis.nodeRepl?.rpc !== "function") {
      throw new Error("Browser use requires a trusted Node REPL browser service");
    }
    const { setupBrowserRuntime } = await import(identity.runtime_client_import_specifier);
    if (typeof setupBrowserRuntime !== "function") throw new Error("Installed client lacks setupBrowserRuntime");
    // The installed bootstrap invokes nodeRepl.rpc("browser", {method: "setup", ...}).
    agent = await setupBrowserRuntime();
    if (!agent?.browsers?.list || !agent?.browsers?.get) throw new Error("Bootstrap returned no browser API");
  } catch (error) {
    throw blocked("BROWSER_RUNTIME_UNAVAILABLE", error.message ?? String(error), error);
  }

  let browser;
  let browserIdentity;
  const retainedTabs = new Set();
  function requireBrowser() {
    if (!browser) throw blocked("CHROME_BINDING_UNAVAILABLE", "Select a Chrome extension binding first");
    return browser;
  }
  function matches(info, selector) {
    return (selector.browserId === undefined || info.id === selector.browserId) &&
      (selector.extensionInstanceId === undefined || info.metadata?.extensionInstanceId === selector.extensionInstanceId);
  }
  const surface = {
    runtimeIdentity: Object.freeze({ ...resolution.runtime_identity }),
    get browser() { return browser; },
    get browserIdentity() { return browserIdentity; },
    async listBindings() { return await agent.browsers.list(); },
    async selectChrome(selector = {}) {
      if (!selector || typeof selector !== "object" || Array.isArray(selector) ||
          Object.keys(selector).some(key => !["browserId", "extensionInstanceId"].includes(key)) ||
          Object.values(selector).some(value => typeof value !== "string" || !value)) {
        throw blocked("BROWSER_SELECTION_INVALID", "Use an exact browserId and/or extensionInstanceId, or omit the selector");
      }
      if (browser) {
        if (!matches(browserIdentity, selector)) {
          throw blocked("BROWSER_SELECTION_MISMATCH", "Requested identity differs from the retained binding");
        }
        return browser;
      }
      const bindings = await surface.listBindings();
      const chrome = bindings.filter(info => info.type === "extension" && info.family === "chrome");
      const selected = chrome.filter(info => matches(info, selector));
      if (!selected.length) {
        throw blocked("CHROME_BINDING_UNAVAILABLE", chrome.length
          ? "No authenticated Chrome extension binding matches the supplied identity"
          : "Trusted service exposes no authenticated Chrome extension binding; Chrome may be closed or its extension unavailable");
      }
      if (selected.length !== 1) throw blocked("BROWSER_SELECTION_AMBIGUOUS", `${selected.length} matching Chrome extension bindings`);
      const acquired = await agent.browsers.get(selected[0].id);
      await acquired.nameSession("CCO F1");
      browserIdentity = Object.freeze({ ...selected[0] });
      browser = acquired;
      return browser;
    },
    async openTabs() { return await requireBrowser().user.openTabs(); },
    async claimTab(identity) {
      if (!identity || typeof identity.id !== "string" || !identity.id ||
          Object.keys(identity).some(key => !["id", "providerTabId", "url", "title"].includes(key)) ||
          Object.values(identity).some(value => value === undefined || value === null)) {
        throw blocked("IDENTITY_FAILURE", "Supply the exact fresh external tab id and optional providerTabId, url, title");
      }
      const bound = requireBrowser();
      const tabs = await bound.user.openTabs();
      const matches = tabs.filter(tab => Object.entries(identity).every(([key, value]) => tab[key] === value));
      if (matches.length !== 1) throw blocked("IDENTITY_FAILURE", `${matches.length} exact external tab matches`);
      const tab = await bound.user.claimTab(matches[0]);
      retainedTabs.add(tab);
      return tab;
    },
    async newTab() {
      const tab = await requireBrowser().tabs.new();
      retainedTabs.add(tab);
      return tab;
    },
    async preserveTab(tab) {
      if (!retainedTabs.has(tab)) throw blocked("IDENTITY_FAILURE", "Tab is not retained by this F1 session");
      await tab.markHandoff();
    },
    async closeTab(tab, { authorized = false } = {}) {
      if (!retainedTabs.has(tab)) throw blocked("IDENTITY_FAILURE", "Tab is not retained by this F1 session");
      if (authorized !== true) throw blocked("TAB_CLOSE_NOT_AUTHORIZED", "Caller must authorize closing this exact tab");
      await tab.close();
      retainedTabs.delete(tab);
    },
  };
  globalThis.ccoF1 = Object.freeze(surface);
  return globalThis.ccoF1;
}
