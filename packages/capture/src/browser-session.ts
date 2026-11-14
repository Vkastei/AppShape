import type { BrowserContext, Page } from "playwright-core";

/**
 * A visible browser on the running app for states a crawler can't reach: logged in, a dialog
 * open, a later step of a form. The app is used normally (with its logins: nothing is blocked);
 * a small *Capture* button, injected by AppShape and not part of the page, captures what is shown.
 * Logins are kept in a profile folder between sessions.
 */

/** The floating button (in its own shadow root, so the app's CSS can't touch it). */
const BUTTON_SCRIPT = String.raw`(() => {
  if (window.top !== window || document.querySelector("[data-appshape-ui]")) return;
  const mount = () => {
    if (!document.body || document.querySelector("[data-appshape-ui]")) return;
    const host = document.createElement("div");
    host.setAttribute("data-appshape-ui", "");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<style>button{font:600 13px/1 system-ui,sans-serif;color:#fff;background:#4f46e5;border:0;border-radius:999px;padding:10px 14px;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}button[disabled]{opacity:.7;cursor:wait}span{display:block;margin-top:6px;font:12px system-ui,sans-serif;color:#111;background:#fff;border-radius:6px;padding:4px 8px;box-shadow:0 2px 8px rgba(0,0,0,.15)}span:empty{display:none}</style><button type="button">Capture to AppShape</button><span></span>';
    const button = root.querySelector("button");
    const status = root.querySelector("span");
    button.addEventListener("click", async () => {
      button.disabled = true;
      host.style.visibility = "hidden";
      status.textContent = "";
      try {
        const message = await window.__appshapeCapture();
        status.textContent = message;
      } catch (error) {
        status.textContent = "Capture failed: " + (error && error.message ? error.message : error);
      } finally {
        host.style.visibility = "";
        button.disabled = false;
      }
    });
    document.body.appendChild(host);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})()`;

export class CaptureBrowser {
  private context: BrowserContext | undefined;

  get isOpen(): boolean {
    return this.context !== undefined;
  }

  /** Opens the app; `onCapture` runs when the user presses the button and returns a short message. */
  /** The open tab (tests). */
  get page(): Page | undefined {
    return this.context?.pages()[0];
  }

  async open(url: string, profileDir: string, onCapture: (page: Page) => Promise<string>, options: { headless?: boolean } = {}): Promise<void> {
    if (this.context) {
      await this.context.pages()[0]?.bringToFront();
      return;
    }
    const { chromium } = await import("playwright-core");
    let context: BrowserContext | undefined;
    let lastError: unknown;
    for (const channel of ["msedge", "chrome", undefined]) {
      try {
        context = await chromium.launchPersistentContext(profileDir, { ...(channel && { channel }), headless: options.headless ?? false, viewport: null, args: ["--window-size=1320,900"] });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!context) throw new Error(`No browser to open (tried Edge and Chrome): ${String(lastError)}`);
    this.context = context;
    // The app is used normally, logins included; only common trackers are kept out.
    await context.route(/google-analytics.com|googletagmanager.com|doubleclick.net|segment.(io|com)|mixpanel.com|hotjar.com|plausible.io|posthog.com|clarity.ms/, (route) => route.abort());
    context.on("close", () => {
      if (this.context === context) this.context = undefined;
    });
    await context.exposeBinding("__appshapeCapture", async (source) => {
      // Let the page settle (hover states, transitions) and capture it as it is.
      await source.page.waitForTimeout(150);
      return onCapture(source.page);
    });
    await context.addInitScript(BUTTON_SCRIPT);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url);
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    await context?.close().catch(() => undefined);
  }
}
