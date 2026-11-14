import { PAGE_TEMPLATES } from "@appshape/kit";
import { type AgentId, APP_NAME_PATTERN, type HubState, STACK_LABELS, type StackId } from "@appshape/protocol";
import { ArrowLeft, FolderOpen, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { hubApi } from "./hub";

/** The kinds of app a new project can be, in plain words (the stack is the small print). */
interface Template {
  stack: StackId;
  title: string;
  text: string;
  kind: "app" | "site";
  tags: string[];
  recommended?: boolean;
}

export const TEMPLATES: Template[] = [
  {
    stack: "vite-react-router",
    title: "Web app",
    text: "Screens that switch instantly in the browser: tools, dashboards, apps behind a login. Not sure? Pick this one.",
    kind: "app",
    tags: ["Vite", "React Router", "Tailwind"],
    recommended: true,
  },
  {
    stack: "next-app",
    title: "Website",
    text: "Pages that load fast and are found by search engines: landing pages, shops, blogs.",
    kind: "site",
    tags: ["Next.js", "App Router", "Tailwind"],
  },
  {
    stack: "vite-tanstack",
    title: "Web app with checked links",
    text: "Like the web app, but links between screens are checked while coding. For people who know TanStack.",
    kind: "app",
    tags: ["Vite", "TanStack Router", "Tailwind"],
  },
  {
    stack: "next-pages",
    title: "Website, classic layout",
    text: "The older Next.js layout with a pages folder, for teams that already use it.",
    kind: "site",
    tags: ["Next.js", "Pages Router", "Tailwind"],
  },
];

const AGENT_CHOICES: { id: AgentId | ""; label: string }[] = [
  { id: "", label: "None for now" },
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex" },
  { id: "generic", label: "Another AI (AGENTS.md)" },
];

const RECENT_KEY = "appshape.recent-templates";
const recentTemplates = (): StackId[] => {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as StackId[]).filter((s) => s in STACK_LABELS);
  } catch {
    return [];
  }
};
const rememberTemplate = (stack: StackId) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([stack, ...recentTemplates().filter((s) => s !== stack)].slice(0, 3)));
  } catch {
    // private window: not remembered
  }
};

/** A small drawing of what the template makes. */
function Preview({ stack }: { stack: StackId }) {
  const site = stack.startsWith("next");
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="62" height="46" rx="5" fill="#fff" stroke="#1F1B2E" strokeWidth="1.5" />
      <path d="M1 9h62" stroke="#1F1B2E" strokeWidth="1.5" />
      <circle cx="6" cy="5" r="1.3" fill="#8E44D6" />
      <circle cx="10" cy="5" r="1.3" fill="#1F1B2E" opacity=".25" />
      {site ? (
        <>
          <rect x="7" y="14" width="30" height="4" rx="2" fill="#1F1B2E" />
          <rect x="7" y="21" width="20" height="2.5" rx="1.25" fill="#1F1B2E" opacity=".3" />
          <rect x="7" y="27" width="12" height="5" rx="2.5" fill="#8E44D6" />
          <rect x="41" y="14" width="16" height="18" rx="2" fill="#A7E3D9" />
          {stack === "next-pages" ? <path d="M7 38h50M7 42h34" stroke="#1F1B2E" strokeWidth="1.5" opacity=".2" /> : <rect x="7" y="37" width="50" height="6" rx="2" fill="#1F1B2E" opacity=".08" />}
        </>
      ) : (
        <>
          <rect x="5" y="13" width="12" height="30" rx="2" fill="#1F1B2E" opacity=".08" />
          <rect x="7.5" y="16" width="7" height="2" rx="1" fill="#8E44D6" />
          <rect x="7.5" y="21" width="7" height="2" rx="1" fill="#1F1B2E" opacity=".3" />
          <rect x="7.5" y="26" width="7" height="2" rx="1" fill="#1F1B2E" opacity=".3" />
          <rect x="21" y="13" width="17" height="12" rx="2" fill="#FFD66B" />
          <rect x="41" y="13" width="17" height="12" rx="2" fill="#A7E3D9" />
          <rect x="21" y="29" width="37" height="14" rx="2" fill="none" stroke="#1F1B2E" strokeWidth="1.2" opacity=".35" />
          {stack === "vite-tanstack" && <path d="M27 33l-3 3 3 3M52 33l3 3-3 3" fill="none" stroke="#14B8A6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
        </>
      )}
    </svg>
  );
}

function Tags({ tags }: { tags: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded border border-zinc-300 bg-white px-1.5 py-px text-[11px] text-ink-soft">
          {t}
        </span>
      ))}
    </span>
  );
}

export function NewApp({
  token,
  state,
  parent: initialParent,
  name: initialName,
  pickFolder,
  onCancel,
  onCreated,
}: {
  token: string;
  state: HubState;
  parent?: string;
  name?: string;
  pickFolder: (title: string, start?: string) => Promise<string | undefined>;
  onCancel: () => void;
  onCreated: (board: string) => Promise<void>;
}) {
  const [step, setStep] = useState<"template" | "configure">("template");
  const [stack, setStack] = useState<StackId>("vite-react-router");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "app" | "site">("all");
  const [name, setName] = useState(initialName ?? "My app");
  const [parent, setParent] = useState(initialParent ?? state.defaultParent);
  const [agent, setAgent] = useState<AgentId | "">("");
  /** The first page, from a page template ("" = an empty board); websites start with the landing page. */
  const [page, setPage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const recent = useMemo(recentTemplates, []);
  const template = TEMPLATES.find((t) => t.stack === stack)!;
  const firstPage = page ?? (template.kind === "site" ? "landing" : "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (step === "configure") setStep("template");
      else onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, busy, onCancel]);

  const shown = TEMPLATES.filter((t) => {
    const q = query.trim().toLowerCase();
    return (filter === "all" || t.kind === filter) && (!q || [t.title, t.text, ...t.tags].some((s) => s.toLowerCase().includes(q)));
  });
  const nameOk = APP_NAME_PATTERN.test(name.trim());
  const target = `${parent.replace(/[\\/]+$/, "")}${state.sep}${name.trim()}`;

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const opened = await hubApi.create(token, { name: name.trim(), parent, stack, ...(agent && { agent }) });
      rememberTemplate(stack);
      await onCreated(firstPage ? `${opened.board}&page=${firstPage}` : opened.board);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label="Start a new app">
      {step === "template" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-10 px-10 pt-8 max-[820px]:grid-cols-1">
          <aside className="max-[820px]:hidden">
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">Start a new app</h1>
            <h2 className="mt-8 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Recently used</h2>
            {recent.length ? (
              <ul className="mt-2 space-y-1">
                {recent.map((s) => {
                  const t = TEMPLATES.find((x) => x.stack === s)!;
                  return (
                    <li key={s}>
                      <button type="button" onClick={() => setStack(s)} className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white">
                        {t.title}
                        <span className="block text-[11px] text-ink-soft">{STACK_LABELS[s]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">The kinds of app you create show up here.</p>
            )}
          </aside>
          <section className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-within:border-ink">
                <Search size={15} className="text-ink-soft" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search kinds of app" aria-label="Search kinds of app" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" />
              </label>
              <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5 text-sm" role="radiogroup" aria-label="Show">
                {(
                  [
                    ["all", "All"],
                    ["app", "Web apps"],
                    ["site", "Websites"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)} className={`rounded-md px-3 py-1 ${filter === id ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto pb-2 pr-1" role="listbox" aria-label="Kinds of app">
              {shown.map((t) => {
                const selected = t.stack === stack;
                return (
                  <li key={t.stack} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => setStack(t.stack)}
                      onDoubleClick={() => setStep("configure")}
                      className={`flex w-full items-center gap-4 rounded-xl border-[1.5px] p-3 text-left ${selected ? "border-ink bg-brand-soft shadow-offset-sm" : "border-zinc-300 bg-white hover:border-ink/60"}`}
                    >
                      <Preview stack={t.stack} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[15px] font-semibold">{t.title}</span>
                          {t.recommended && <span className="rounded-full bg-teal-500 px-2 py-px text-[11px] font-semibold text-white">Recommended</span>}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{t.text}</span>
                        <span className="mt-1.5 block">
                          <Tags tags={t.tags} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="text-sm text-ink-soft">Nothing matches. Try “website” or “app”.</li>}
            </ul>
          </section>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-10 pt-8">
          <div className="max-w-xl">
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">Set up your new app</h1>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm font-semibold">{template.title}</span>
              <Tags tags={template.tags} />
            </div>
            <form
              className="mt-8 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (nameOk && !busy) void create();
              }}
            >
              <label className="block">
                <span className="text-sm font-medium">App name</span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!nameOk} className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-ink ${nameOk ? "border-zinc-300" : "border-red-400"}`} />
                {!nameOk && <span className="mt-1 block text-xs text-red-700">Use letters, numbers, spaces, - or _ (it becomes the folder's name).</span>}
              </label>
              <label className="block">
                <span className="text-sm font-medium">First page</span>
                <select value={firstPage} onChange={(e) => setPage(e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-ink">
                  <option value="">Start empty</option>
                  {PAGE_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}: {t.description}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-soft">Built from the library in your theme; every text and section can be changed. More pages and sections are in the library.</span>
              </label>
              <div>
                <span className="text-sm font-medium" id="location-label">
                  Location
                </span>
                <div className="mt-1.5 flex gap-2">
                  <input aria-labelledby="location-label" value={parent} onChange={(e) => setParent(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-[13px] outline-none focus:border-ink" />
                  <button
                    type="button"
                    aria-label="Choose location"
                    onClick={() => void pickFolder("Where should the app go?", parent).then((p) => p && setParent(p))}
                    className="grid w-10 place-items-center rounded-lg border border-zinc-300 bg-white hover:border-ink"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
              <label className="block">
                <span className="text-sm font-medium">Coding AI</span>
                <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId | "")} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-ink">
                  {AGENT_CHOICES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-soft">The AI that finishes what AppShape can't write itself. You can change this later in the project settings.</span>
              </label>
              <p className="rounded-lg border border-dashed border-zinc-300 bg-white/70 px-3 py-2 text-[13px] text-ink-soft">
                AppShape creates <span className="break-all font-mono text-[12px] text-ink">{target}</span>. The code is written when you press <em>Send to code</em> on the board.
              </p>
              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {error}
                </p>
              )}
              <button type="submit" hidden />
            </form>
          </div>
        </div>
      )}
      <footer className="flex items-center gap-2 border-t border-zinc-300 bg-paper/90 px-10 py-4">
        <button type="button" onClick={step === "configure" ? () => setStep("template") : onCancel} disabled={busy} className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-ink-soft hover:bg-zinc-100 hover:text-ink">
          <ArrowLeft size={15} /> Back
        </button>
        <span className="flex-1" />
        {step === "template" ? (
          <button type="button" onClick={() => setStep("configure")} className="rounded-lg bg-ink px-5 py-2 text-sm font-semibold text-white hover:bg-ink-soft">
            Next
          </button>
        ) : (
          <button type="button" disabled={!nameOk || busy} onClick={() => void create()} className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-offset-sm hover:bg-accent-600 disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />}
            Create
          </button>
        )}
      </footer>
    </div>
  );
}
