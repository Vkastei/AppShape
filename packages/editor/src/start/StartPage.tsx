import type { FolderInfo, HubCheck, HubState, RecentProject } from "@appshape/protocol";
import { ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, FolderOpen, Loader2, Plus, RefreshCw, Search, Square, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wordmark } from "../components/Logo";
import { readToken } from "../lib/api";
import { FolderPicker } from "./FolderPicker";
import { type CliOnPath, type DesktopUpdate, desktop, hubApi, showBoard } from "./hub";
import { NewApp } from "./NewApp";

/**
 * The start page: open recent projects, open an existing app, start a new one, and see whether the
 * computer has what apps need. Shown in the desktop app's window and by `appshape start`.
 */
export function StartPage() {
  const [token] = useState(() => readToken());
  const [state, setState] = useState<HubState>();
  const [view, setView] = useState<{ kind: "home" } | { kind: "new"; parent?: string; name?: string }>({ kind: "home" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [picker, setPicker] = useState<{ title: string; start?: string; done: (path: string | undefined) => void }>();
  const [inspected, setInspected] = useState<FolderInfo>();

  const reload = useCallback(() => {
    if (token) hubApi.state(token).then(setState, (e: unknown) => setError((e as Error).message));
  }, [token]);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  if (!token) {
    return (
      <Shell>
        <p className="m-auto max-w-sm text-center text-ink-soft">This page needs the link AppShape opened. Start AppShape again (or run appshape start).</p>
      </Shell>
    );
  }

  /** The system's folder dialog in the desktop app, AppShape's own in the browser. */
  const pickFolder = (title: string, start?: string) =>
    new Promise<string | undefined>((resolve) => {
      const bridge = desktop();
      if (bridge) {
        void bridge.pickFolder({ title, ...(start && { defaultPath: start }) }).then(resolve);
        return;
      }
      setPicker({ title, ...(start && { start }), done: (path) => {
        setPicker(undefined);
        resolve(path);
      } });
    });

  const run = async (message: string, action: () => Promise<void>) => {
    setBusy(message);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  const openPath = (path: string, name: string, importPages = false) =>
    run(`Opening ${name}…`, async () => {
      setInspected(undefined);
      const opened = await hubApi.open(token, path, importPages);
      await showBoard(opened.board);
    });

  const openMyApp = async () => {
    const path = await pickFolder("Choose your app's folder");
    if (!path) return;
    await run("Looking at the folder…", async () => setInspected(await hubApi.folder(token, path)));
  };

  if (view.kind === "new" && state) {
    return (
      <Shell>
        <NewApp
          token={token}
          state={state}
          {...(view.parent && { parent: view.parent })}
          {...(view.name && { name: view.name })}
          pickFolder={pickFolder}
          onCancel={() => setView({ kind: "home" })}
          onCreated={async (board) => {
            setView({ kind: "home" });
            reload();
            await showBoard(board);
          }}
        />
        {picker && <FolderPicker token={token} title={picker.title} {...(picker.start && { start: picker.start })} onDone={picker.done} />}
      </Shell>
    );
  }

  return (
    <Shell>
      <Header state={state} />
      <UpdateBanner />
      {error && (
        <div role="alert" className="mx-10 mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="Close message" onClick={() => setError(undefined)} className="text-red-400 hover:text-red-700">
            <X size={14} />
          </button>
        </div>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(300px,1fr)] gap-10 px-10 pb-8 pt-2 max-[820px]:grid-cols-1 max-[820px]:overflow-auto">
        <Recent
          state={state}
          onOpen={(r) => (r.board ? void showBoard(r.board) : void openPath(r.appRoot, r.name))}
          onStop={(r) => void run(`Closing ${r.name}…`, () => hubApi.stop(token, r.appRoot))}
          onForget={(r) => void run("", () => hubApi.forget(token, r.appRoot))}
        />
        <section aria-label="Get started" className="flex min-h-0 flex-col gap-3 overflow-auto pb-1 pr-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Get started</h2>
          <Action
            icon={<FolderOpen size={22} />}
            title="Open my app"
            text="An app you already have. Its pages appear on the board, ready to redesign."
            onClick={() => void openMyApp()}
          />
          <Action
            icon={<Plus size={22} />}
            title="Start a new app"
            text="Pick what you want to build, design it on the board, and AppShape writes the code."
            onClick={() => setView({ kind: "new" })}
          />
          <Checks token={token} />
        </section>
      </main>
      <TerminalFooter />
      {busy && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-paper/70" role="status">
          <div className="flex items-center gap-3 rounded-xl border border-ink bg-white px-5 py-4 text-sm text-ink shadow-offset">
            <Loader2 size={18} className="animate-spin text-brand" /> {busy}
          </div>
        </div>
      )}
      {inspected && (
        <OpenAppDialog
          info={inspected}
          onCancel={() => setInspected(undefined)}
          onOpen={(importPages) => void openPath(inspected.project?.appRoot ?? inspected.path, inspected.project?.name ?? inspected.name, importPages)}
          onNew={() => {
            setInspected(undefined);
            setView({ kind: "new", parent: parentOf(inspected.path, state?.sep), name: inspected.name });
          }}
          onOther={() => {
            setInspected(undefined);
            void openMyApp();
          }}
        />
      )}
      {picker && <FolderPicker token={token} title={picker.title} {...(picker.start && { start: picker.start })} onDone={picker.done} />}
    </Shell>
  );
}

const parentOf = (path: string, sep = "/") => path.slice(0, Math.max(path.lastIndexOf(sep), path.lastIndexOf("/"))) || path;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-paper text-ink"
      style={{ backgroundImage: "radial-gradient(circle, rgb(31 27 46 / 0.09) 1px, transparent 1.2px)", backgroundSize: "22px 22px" }}
    >
      {children}
    </div>
  );
}

function Header({ state }: { state: HubState | undefined }) {
  return (
    <header className="flex items-center gap-4 px-10 pb-6 pt-8">
      <div className="flex-1">
        <h1>
          <Wordmark height={64} />
        </h1>
        <p className="mt-2 text-xs text-ink-soft">Design your web and mobile apps on a board. AppShape and your AI write the code.</p>
      </div>
      {state && <span className="font-mono text-[11px] text-ink-soft">v{state.version}</span>}
    </header>
  );
}

function UpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdate>();
  useEffect(() => desktop()?.onUpdate(setUpdate), []);
  if (update?.state !== "ready") return null;
  return (
    <div className="mx-10 mb-3 flex items-center gap-3 rounded-lg border border-teal-600 bg-teal-50 px-3 py-2 text-sm text-teal-950">
      <CircleCheck size={16} className="text-teal-600" />
      <span className="flex-1">AppShape {update.version} is ready.</span>
      <button type="button" onClick={() => desktop()?.installUpdate()} className="rounded-md bg-ink px-3 py-1 text-xs font-semibold text-white hover:bg-ink-soft">
        Restart to update
      </button>
    </div>
  );
}

/** Desktop app: the `appshape` command in terminals, for people who want it. */
function TerminalFooter() {
  const [cli, setCli] = useState<CliOnPath>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => void desktop()?.cliOnPath().then(setCli), []);
  if (!cli) return null;
  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setCli(await desktop()!.setCliOnPath(!cli.on));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <footer className="flex items-center gap-3 border-t border-zinc-300/70 px-10 py-2.5 text-xs text-ink-soft">
      <span className="font-mono text-ink">appshape</span>
      <span className="flex-1">
        {error
          ? `Couldn't change it: ${error}`
          : cli.on
            ? cli.manual
              ? `The command is in ${cli.dir}; add that folder to your PATH.`
              : "Works in new terminal windows."
            : "Use AppShape from a terminal too (for developers)."}
      </span>
      <button type="button" role="switch" aria-checked={cli.on} aria-label="appshape command in terminals" disabled={busy} onClick={() => void toggle()} className={`relative h-5 w-9 rounded-full border border-ink transition-colors ${cli.on ? "bg-teal-500" : "bg-white"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full border border-ink bg-white transition-[left] ${cli.on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </footer>
  );
}

function Action({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-4 rounded-xl border-[1.5px] border-ink bg-white p-4 text-left shadow-offset transition-[transform,box-shadow] duration-100 hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_#1f1b2e] active:translate-x-[2px] active:translate-y-[2px] active:shadow-offset-sm"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-deep ring-1 ring-brand/40">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{text}</span>
      </span>
    </button>
  );
}

const TILE_COLORS = ["#FFD66B", "#A7E3D9", "#FFC2A8", "#CFC8F5", "#C4E5A8"];
const tileColor = (name: string) => TILE_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE_COLORS.length]!;

function when(iso: string, now = new Date()): { group: string; label: string } {
  const date = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return { group: "Today", label: time };
  if (days === 1) return { group: "Yesterday", label: time };
  if (days < 7) return { group: "This week", label: date.toLocaleDateString([], { weekday: "long" }) };
  return { group: "Earlier", label: date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) };
}

function Recent({ state, onOpen, onStop, onForget }: { state: HubState | undefined; onOpen: (r: RecentProject) => void; onStop: (r: RecentProject) => void; onForget: (r: RecentProject) => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, { project: RecentProject; label: string }[]>();
    for (const project of state?.recent ?? []) {
      if (q && !project.name.toLowerCase().includes(q) && !project.appRoot.toLowerCase().includes(q)) continue;
      const { group, label } = when(project.openedAt);
      out.set(group, [...(out.get(group) ?? []), { project, label }]);
    }
    return [...out];
  }, [state, query]);

  return (
    <section aria-label="Open recent" className="flex min-h-0 flex-col">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Open recent</h2>
      <label className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-within:border-ink">
        <Search size={15} className="text-ink-soft" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recent apps" aria-label="Search recent apps" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" />
      </label>
      <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
        {!state ? (
          <Loader2 size={16} className="mt-4 animate-spin text-ink-soft" />
        ) : state.recent.length === 0 ? (
          <div className="mt-2 rounded-xl border-[1.5px] border-dashed border-zinc-300 px-5 py-8 text-center text-sm text-ink-soft">
            Apps you open show up here.
            <br />
            Start with <strong className="font-semibold text-ink">Open my app</strong> or <strong className="font-semibold text-ink">Start a new app</strong>.
          </div>
        ) : groups.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Nothing matches “{query}”.</p>
        ) : (
          groups.map(([group, items]) => (
            <div key={group} className="mb-4">
              <h3 className="mb-1 text-xs font-medium text-ink-soft">{group}</h3>
              <ul className="space-y-1">
                {items.map(({ project, label }) => (
                  <RecentRow key={project.appRoot} project={project} label={label} onOpen={onOpen} onStop={onStop} onForget={onForget} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function RecentRow({ project, label, onOpen, onStop, onForget }: { project: RecentProject; label: string; onOpen: (r: RecentProject) => void; onStop: (r: RecentProject) => void; onForget: (r: RecentProject) => void }) {
  return (
    <li className="group relative" data-testid="recent-project">
      <button
        type="button"
        disabled={project.missing}
        onClick={() => onOpen(project)}
        className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left hover:border-zinc-300 hover:bg-white disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-ink/80 text-sm font-bold text-ink" style={{ background: tileColor(project.name) }}>
          {[...project.name][0]?.toUpperCase() ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{project.name}</span>
            {project.board && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-2 py-px text-[11px] font-medium text-teal-700 ring-1 ring-teal-500/40">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Board open
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-ink-soft" title={project.appRoot}>
            {project.missing ? "Folder not found · " : ""}
            {project.appRoot}
          </span>
        </span>
        <span className="shrink-0 pr-16 text-xs text-ink-soft group-hover:invisible">{label}</span>
      </button>
      <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 group-focus-within:flex group-hover:flex">
        {project.board ? (
          <>
            <RowButton label={`Show the board of ${project.name}`} onClick={() => onOpen(project)}>
              <ArrowUpRight size={14} />
            </RowButton>
            <RowButton label={`Close the board of ${project.name}`} onClick={() => onStop(project)}>
              <Square size={12} />
            </RowButton>
          </>
        ) : null}
        <RowButton label={`Remove ${project.name} from the list`} onClick={() => onForget(project)}>
          <X size={14} />
        </RowButton>
      </span>
    </li>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md border border-zinc-300 bg-white text-ink-soft hover:border-ink hover:text-ink">
      {children}
    </button>
  );
}

const CHECK_ICONS: Record<HubCheck["status"], React.ReactNode> = {
  ok: <CircleCheck size={15} className="text-teal-600" />,
  missing: <CircleAlert size={15} className="text-red-600" />,
  outdated: <TriangleAlert size={15} className="text-amber-600" />,
  optional: <CircleDashed size={15} className="text-zinc-400" />,
};

function Checks({ token }: { token: string }) {
  const [checks, setChecks] = useState<HubCheck[]>();
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    (refresh: boolean) => {
      setLoading(true);
      hubApi
        .checks(token, refresh)
        .then(setChecks, () => setChecks([]))
        .finally(() => setLoading(false));
    },
    [token],
  );
  useEffect(() => load(false), [load]);
  const problems = checks?.filter((c) => c.status === "missing" || c.status === "outdated") ?? [];
  const [open, setOpen] = useState(false);
  const expanded = open || problems.length > 0;

  return (
    <div className="mt-3 rounded-xl border border-zinc-300 bg-white/80" data-testid="checks">
      <div className="flex items-center gap-2 px-4 py-3">
        {!checks ? (
          <Loader2 size={15} className="animate-spin text-ink-soft" />
        ) : problems.length ? (
          <CircleAlert size={15} className="text-red-600" />
        ) : (
          <CircleCheck size={15} className="text-teal-600" />
        )}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={expanded} className="flex-1 text-left text-sm font-medium">
          {!checks ? "Checking your computer…" : problems.length ? `Your computer needs ${problems.length === 1 ? "one thing" : `${problems.length} things`}` : "Your computer is ready"}
        </button>
        <button type="button" onClick={() => load(true)} disabled={loading} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-zinc-100 hover:text-ink disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Check again
        </button>
      </div>
      {expanded && checks && (
        <ul className="space-y-2.5 border-t border-zinc-200 px-4 py-3">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-[13px]" data-testid={`check-${c.id}`} data-status={c.status}>
              <span className="mt-px">{CHECK_ICONS[c.status]}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.name}</span>
                {c.version && <span className="ml-1.5 font-mono text-[11px] text-ink-soft">{c.version}</span>}
                <span className="block text-ink-soft">{c.text}</span>
              </span>
              {c.link && c.status !== "ok" && (
                <a href={c.link.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-ink px-2 py-0.5 text-xs font-medium hover:bg-brand-soft">
                  {c.link.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpenAppDialog({ info, onCancel, onOpen, onNew, onOther }: { info: FolderInfo; onCancel: () => void; onOpen: (importPages: boolean) => void; onNew: () => void; onOther: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const lines: { ok: boolean | "warn"; text: React.ReactNode }[] = [];
  let primary: { label: string; action: () => void } | undefined;
  let secondary: { label: string; action: () => void } | undefined;
  if (info.project) {
    lines.push({ ok: true, text: <>AppShape project “{info.project.name}”</> });
    primary = { label: "Open board", action: () => onOpen(false) };
  }
  if (info.app.kind === "app") {
    lines.push({ ok: true, text: <>A {info.app.stackLabel} app with Tailwind CSS</> });
    if (info.packageManager)
      lines.push(
        info.packageManagerMissing
          ? { ok: "warn", text: <>It uses {info.packageManager}, which isn't installed. AppShape needs it to start the app (see <em>Your computer</em>).</> }
          : { ok: true, text: <>Uses {info.packageManager}</> },
      );
    if (!info.project) primary = { label: "Open board and bring in pages", action: () => onOpen(true) };
  } else if (info.app.kind === "unsupported") {
    lines.push({ ok: "warn", text: <>AppShape can't read this app yet: {info.app.reason}. It works with React apps that use Tailwind CSS and React Router, TanStack Router or Next.js.</> });
    if (!info.project) secondary = { label: "Open board anyway", action: () => onOpen(false) };
  } else if (!info.project) {
    if (info.empty) {
      lines.push({ ok: "warn", text: <>This folder is empty.</> });
      primary = { label: "Start a new app here", action: onNew };
    } else {
      lines.push({ ok: "warn", text: <>There is no app in this folder (no package.json).</> });
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-ink/30 p-6" role="dialog" aria-label={info.name} onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full max-w-lg rounded-xl border-[1.5px] border-ink bg-white shadow-offset [&_button]:whitespace-nowrap">
        <div className="px-5 pb-2 pt-5">
          <h2 className="text-lg font-bold tracking-[-0.01em]">{info.project?.name ?? info.name}</h2>
          <p className="truncate font-mono text-[11px] text-ink-soft" title={info.path}>
            {info.path}
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {lines.map((line, i) => (
              <li key={i} className="flex items-start gap-2">
                {line.ok === true ? <CircleCheck size={16} className="mt-px shrink-0 text-teal-600" /> : <TriangleAlert size={16} className="mt-px shrink-0 text-amber-600" />}
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-zinc-200 px-5 py-3">
          <button type="button" onClick={onOther} className="rounded-md px-2 py-1.5 text-sm text-ink-soft hover:bg-zinc-100 hover:text-ink">
            Choose another folder
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-zinc-100">
            Cancel
          </button>
          {secondary && (
            <button type="button" onClick={secondary.action} className="rounded-md border border-ink px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">
              {secondary.label}
            </button>
          )}
          {primary && (
            <button type="button" onClick={primary.action} autoFocus className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-ink-soft">
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
