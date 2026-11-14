import { Monitor, MousePointerClick, X } from "lucide-react";
import { useState } from "react";
import { screenToWorld } from "../lib/geometry";
import { newScreen, slugRoute } from "../lib/templates";
import { useEditor } from "../store";
import { addScreen } from "./Sidebar";
import { Wordmark } from "./Logo";

const DISMISSED_KEY = "appshape.welcome-dismissed";

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

const STEPS: { title: string; text: string; color: string }[] = [
  { title: "Design", text: "Add screens and arrange them on the board, or bring in the pages of the app you have.", color: "bg-accent-500" },
  { title: "Ask AI", text: "Select a section and press Ask AI: describe a change, add a section, see 3 variants, make it work on phones, or get a review of the page.", color: "bg-accent-300" },
  { title: "Send to code", text: "Apply to code writes the code. What needs judgment goes to your coding AI as tasks.", color: "bg-ink" },
  { title: "Check in the app", text: "AppShape opens the running app and compares it with the design, element by element.", color: "bg-teal-500" },
];

/** On a board without screens: how AppShape works, in three steps, with the first ones a click away. */
export function Welcome() {
  const empty = useEditor((s) => (s.project?.frames.filter((f) => f.kind !== "component").length ?? 1) === 0);
  const [hidden, setHidden] = useState(dismissed);
  if (!empty || hidden) return null;

  const close = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // private window: shown again next time
    }
    setHidden(true);
  };
  const addPage = () => {
    const { project, camera } = useEditor.getState();
    const canvas = document.querySelector("[data-testid=canvas]")?.getBoundingClientRect();
    const center = screenToWorld(camera, { x: (canvas?.width ?? 800) / 2 - 320, y: (canvas?.height ?? 600) / 2 - 240 });
    addScreen(newScreen("Home", slugRoute("Home"), "desktop", project!.tokens, project!.adapters[0]?.id), { x: Math.round(center.x), y: Math.round(center.y) });
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
      <section aria-label="How AppShape works" className="pointer-events-auto relative w-full max-w-[560px] rounded-2xl border-[1.5px] border-ink bg-white p-6 shadow-offset">
        <button type="button" aria-label="Close the introduction" onClick={close} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-ink-soft hover:bg-ink/[0.06] hover:text-ink">
          <X size={15} />
        </button>
        <Wordmark height={52} className="mb-4" />
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-ink">An empty board. Let's fill it.</h2>
        <ol className="mt-5 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[640px]:grid-cols-1">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-ink/15 bg-paper p-3">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${step.color} ${step.color === "bg-ink" || step.color === "bg-accent-500" ? "text-white" : "text-ink"}`}>{i + 1}</span>
              <span className="mt-2 block text-sm font-bold text-ink">{step.title}</span>
              <span className="mt-1 block text-[12.5px] leading-snug text-ink-soft">{step.text}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={addPage} className="flex items-center gap-1.5 rounded-lg border border-ink bg-accent-500 px-3 py-2 text-sm font-bold text-white shadow-offset-sm hover:bg-accent-600">
            <Monitor size={15} /> Add a web page
          </button>
          <button type="button" onClick={() => useEditor.setState({ importOpen: true })} className="rounded-lg border border-ink/70 bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-ink hover:bg-accent-50">
            Bring in my app's pages
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
            <MousePointerClick size={14} /> Tip: right-click the board to add anything
          </span>
        </div>
      </section>
    </div>
  );
}
