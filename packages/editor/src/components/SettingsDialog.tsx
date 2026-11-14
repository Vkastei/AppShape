import type { ProjectSettings, RedactionConfig } from "@appshape/ir";
import { AgentAutoStartSetting } from "./AgentRun";
import { type AgentId, type SettingsResponse, STACK_LABELS, type StackId } from "@appshape/protocol";
import { Bot, Check, Code2, Copy, FolderOpen, Loader2, MonitorPlay, ScanSearch, Shield, Sparkles, SquareTerminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { assetUrl, connectAgentApi, disconnectAgentApi, fetchSettings, saveAi, saveSettings } from "../lib/api";
import { addImageFile, chooseImageFile } from "../lib/images";
import { loadAi, notify, useEditor } from "../store";

type Page = "general" | "app" | "privacy" | "code" | "checks" | "agents" | "ai" | "board" | "cli";

const PAGES: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <FolderOpen size={15} /> },
  { id: "app", label: "Your app", icon: <MonitorPlay size={15} /> },
  { id: "privacy", label: "Privacy", icon: <Shield size={15} /> },
  { id: "code", label: "Code", icon: <Code2 size={15} /> },
  { id: "checks", label: "Checks", icon: <ScanSearch size={15} /> },
  { id: "agents", label: "AI agents", icon: <Bot size={15} /> },
  { id: "ai", label: "AppShape AI", icon: <Sparkles size={15} /> },
  { id: "board", label: "Board", icon: <SquareTerminal size={15} /> },
  { id: "cli", label: "Command line", icon: <SquareTerminal size={15} /> },
];

interface Draft {
  name: string;
  settings: ProjectSettings;
  redaction: RedactionConfig;
}

/** Project settings: everything the CLI and the MCP server can be told, in one place. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const token = useEditor((s) => s.token)!;
  const [page, setPage] = useState<Page>(() => {
    const wanted = useEditor.getState().settingsPage;
    return PAGES.some((p) => p.id === wanted) ? (wanted as Page) : "general";
  });
  useEffect(() => () => useEditor.setState({ settingsPage: undefined }), []);
  const [loaded, setLoaded] = useState<SettingsResponse>();
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const take = (response: SettingsResponse) => {
    setLoaded(response);
    setDraft({ name: response.name, settings: response.settings, redaction: response.redaction });
  };
  useEffect(() => {
    fetchSettings(token)
      .then(take)
      .catch((e: unknown) => setError((e as Error).message));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = Boolean(loaded && draft && JSON.stringify({ name: loaded.name, settings: loaded.settings, redaction: loaded.redaction }) !== JSON.stringify(draft));
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    try {
      take(await saveSettings(token, { ...draft, settings: clean(draft.settings) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6" role="dialog" aria-label="Project settings" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[min(640px,100%)] w-full max-w-4xl flex-col rounded-xl border-[1.5px] border-ink bg-white shadow-offset">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <h2 className="flex-1 text-[17px] font-extrabold tracking-[-0.01em] text-ink">Project settings{loaded ? ` · ${loaded.name}` : ""}</h2>
          <button type="button" aria-label="Close settings" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
            <X size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 p-2" aria-label="Settings pages">
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={page === p.id ? "page" : undefined}
                onClick={() => setPage(p.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${page === p.id ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-zinc-100"}`}
              >
                {p.icon} {p.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4 text-sm">
            {!loaded || !draft ? (
              error ? <p className="rounded bg-red-50 p-3 text-red-800">{error}</p> : <Loader2 size={16} className="animate-spin text-zinc-400" />
            ) : (
              <PageContent page={page} loaded={loaded} draft={draft} setDraft={setDraft} onAgents={take} />
            )}
          </div>
        </div>
        <footer className="flex items-center gap-2 border-t border-zinc-200 px-4 py-3">
          {error && loaded && <span className="flex-1 truncate text-xs text-red-700">{error}</span>}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">
            {dirty ? "Cancel" : "Close"}
          </button>
          <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded-md border border-ink bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white shadow-offset-sm hover:bg-accent-600 disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none">
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Settings without empty groups (absent = AppShape's default). */
function clean(settings: ProjectSettings): ProjectSettings {
  const out: Record<string, unknown> = {};
  for (const [group, values] of Object.entries(settings)) {
    const kept = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
    if (Object.keys(kept).length) out[group] = kept;
  }
  return out as ProjectSettings;
}

type SetDraft = React.Dispatch<React.SetStateAction<Draft | undefined>>;

function PageContent({ page, loaded, draft, setDraft, onAgents }: { page: Page; loaded: SettingsResponse; draft: Draft; setDraft: SetDraft; onAgents: (r: SettingsResponse) => void }) {
  const group = <G extends keyof ProjectSettings>(name: G, patch: Partial<NonNullable<ProjectSettings[G]>>) =>
    setDraft((d) => d && { ...d, settings: { ...d.settings, [name]: { ...d.settings[name], ...patch } } });
  const s = draft.settings;
  switch (page) {
    case "general":
      return (
        <Fields title="General">
          <Field label="Project name">
            <input aria-label="Project name" value={draft.name} onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Site icon" hint="The icon in browser tabs and bookmarks (favicon), for every page. A square PNG or SVG works best.">
            <ImagePick label="Site icon" value={s.site?.favicon} onChange={(favicon) => group("site", { favicon })} />
          </Field>
          <Field label="App folder" hint="The app the design belongs to.">
            <code className={CODE}>{loaded.location.appRoot}</code>
          </Field>
          <Field label="Design data" hint={loaded.location.mode === "in-repo" ? "Kept with the app's code (commit it with your code)." : "Kept outside the app's folder."}>
            <code className={CODE}>{loaded.location.dataDir}</code>
          </Field>
        </Fields>
      );
    case "app":
      return (
        <Fields title="Your app" intro="How AppShape starts your app to bring in pages and to check them. Leave a field empty for the default.">
          <Field label="Package manager" hint="Default: the one your app's lockfile belongs to.">
            <select aria-label="Package manager" value={s.app?.packageManager ?? ""} onChange={(e) => group("app", { packageManager: (e.target.value || undefined) as never })} className={INPUT}>
              <option value="">Automatic</option>
              {["npm", "pnpm", "yarn", "bun"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Start script" hint='The script in package.json that starts the app while you work (usually "dev").'>
            <input aria-label="Start script" placeholder="dev" value={s.app?.devScript ?? ""} onChange={(e) => group("app", { devScript: e.target.value || undefined })} className={INPUT} />
          </Field>
          <Field label="Port" hint="Empty: AppShape picks a free one.">
            <NumberInput label="App port" value={s.app?.port} onChange={(port) => group("app", { port })} />
          </Field>
          <Field label="Already running at" hint="If you start your app yourself, its address; AppShape then uses it instead of starting one.">
            <input aria-label="Running app address" placeholder="http://localhost:3000" value={s.app?.devUrl ?? ""} onChange={(e) => group("app", { devUrl: e.target.value || undefined })} className={INPUT} />
          </Field>
        </Fields>
      );
    case "privacy": {
      const r = draft.redaction;
      const setR = (patch: Partial<RedactionConfig>) => setDraft((d) => d && { ...d, redaction: { ...d.redaction, ...patch } });
      const MODES = [
        { id: "strict", label: "Hide before saving", hint: "Personal data is replaced before anything is stored. Recommended." },
        { id: "local-only", label: "Only on this computer", hint: "Real content is kept in a local cache that is never committed." },
        { id: "off", label: "Off", hint: "Pages are stored as they are, including personal data." },
      ] as const;
      return (
        <Fields title="Privacy" intro="When pages of your app are brought in, content like emails and phone numbers is replaced by placeholders.">
          <Field label="Mode">
            <div className="space-y-1.5" role="radiogroup" aria-label="Privacy mode">
              {MODES.map((m) => (
                <label key={m.id} className="flex items-start gap-2">
                  <input type="radio" name="redaction" checked={r.mode === m.id} onChange={() => setR({ mode: m.id })} className="mt-1" />
                  <span>
                    <span className="block text-zinc-800">{m.label}</span>
                    <span className="block text-xs text-zinc-500">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Replace">
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["email", "Email addresses"],
                  ["phone", "Phone numbers"],
                  ["longDigits", "Long numbers (accounts, IDs)"],
                  ["secrets", "Keys and passwords"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-zinc-700">
                  <input type="checkbox" checked={r.detectors[key]} onChange={(e) => setR({ detectors: { ...r.detectors, [key]: e.target.checked } })} /> {label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Also replace" hint="Text patterns (regular expressions), one per line.">
            <Lines label="Patterns to replace" value={r.patterns} onChange={(patterns) => setR({ patterns })} placeholder="ORDER-\d+" />
          </Field>
          <Field label="Always hide" hint="Parts of the page to hide completely: CSS selectors or test ids, one per line.">
            <Lines label="Parts to hide" value={r.selectors} onChange={(selectors) => setR({ selectors })} placeholder=".customer-name" />
          </Field>
        </Fields>
      );
    }
    case "code":
      return (
        <Fields title="Code" intro="How the design is sent to your app's code.">
          <Field label="Kind of app" hint="For a new app. An existing app's kind is detected.">
            <select aria-label="Kind of app" value={s.code?.stack ?? ""} onChange={(e) => group("code", { stack: e.target.value || undefined })} className={INPUT}>
              <option value="">Ask when creating</option>
              {(Object.keys(STACK_LABELS) as StackId[]).map((id) => (
                <option key={id} value={id}>
                  {STACK_LABELS[id]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Packages">
            <label className="flex items-center gap-2 text-zinc-700">
              <input type="checkbox" checked={s.code?.install !== false} onChange={(e) => group("code", { install: e.target.checked ? undefined : false })} />
              Install packages the code needs automatically
            </label>
          </Field>
        </Fields>
      );
    case "checks": {
      const chosen = s.verify?.viewports;
      return (
        <Fields title="Checks" intro="Checking your app against the design (after sending to code, or when your AI is done).">
          <Field label="Screen sizes" hint="Which sizes of each screen are checked.">
            <div className="flex flex-wrap gap-3">
              {loaded.viewports.map((v) => (
                <label key={v} className="flex items-center gap-1.5 text-zinc-700">
                  <input
                    type="checkbox"
                    aria-label={`Check ${v}`}
                    checked={!chosen?.length || chosen.includes(v)}
                    onChange={(e) => {
                      const current = chosen?.length ? chosen : loaded.viewports;
                      const next = e.target.checked ? [...new Set([...current, v])] : current.filter((x) => x !== v);
                      group("verify", { viewports: next.length === loaded.viewports.length ? undefined : next });
                    }}
                  />
                  {v}
                </label>
              ))}
              {loaded.viewports.length === 0 && <span className="text-zinc-500">No screens yet.</span>}
            </div>
          </Field>
          <Field label="Allowed difference" hint="In pixels, for sizes and positions (default 3).">
            <NumberInput label="Allowed difference" value={s.verify?.tolerance} onChange={(tolerance) => group("verify", { tolerance })} />
          </Field>
        </Fields>
      );
    }
    case "agents":
      return <Agents loaded={loaded} onChange={onAgents} />;
    case "ai":
      return <AiSettings />;
    case "board":
      return (
        <Fields title="Board" intro="How the board starts (appshape dev). Takes effect the next time it starts.">
          <Field label="Port" hint="Default 4590 (or a free one).">
            <NumberInput label="Board port" value={s.board?.port} onChange={(port) => group("board", { port })} />
          </Field>
          <Field label="Browser">
            <label className="flex items-center gap-2 text-zinc-700">
              <input type="checkbox" checked={s.board?.open !== false} onChange={(e) => group("board", { open: e.target.checked ? undefined : false })} />
              Open the board in the browser when it starts
            </label>
          </Field>
        </Fields>
      );
    case "cli":
      return <CommandLine loaded={loaded} draft={draft} />;
  }
}

function Agents({ loaded, onChange }: { loaded: SettingsResponse; onChange: (r: SettingsResponse) => void }) {
  const token = useEditor((s) => s.token)!;
  const [busy, setBusy] = useState<AgentId>();
  const act = async (id: AgentId, connect: boolean) => {
    setBusy(id);
    try {
      onChange(await (connect ? connectAgentApi(token, id) : disconnectAgentApi(token, id)));
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  };
  const command = [loaded.mcp.command, ...loaded.mcp.args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
  return (
    <Fields title="AI agents" intro="Connect the coding AI you use: it gets AppShape's tools (to read the tasks, report and check its work) and instructions for this app.">
      <ul className="space-y-2">
        {loaded.agents.map((a) => (
          <li key={a.id} className="rounded-lg border border-zinc-200 p-3" data-testid={`agent-${a.id}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-900">{a.name}</span>
              {a.connected ? (
                <span className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
                  <Check size={12} /> Connected
                </span>
              ) : a.mcp || a.instructions ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Partly set up</span>
              ) : null}
              <span className="flex-1" />
              {busy === a.id && <Loader2 size={14} className="animate-spin text-zinc-400" />}
              {(a.connected || a.mcp || a.instructions) && (
                <button type="button" disabled={busy !== undefined} onClick={() => void act(a.id, false)} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
                  Remove
                </button>
              )}
              <button type="button" disabled={busy !== undefined} onClick={() => void act(a.id, true)} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50">
                {a.connected ? "Update" : "Connect"}
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{a.description}</p>
            <p className="mt-1 truncate font-mono text-[11px] text-zinc-400" title={a.files.join("\n")}>
              {a.files.map((f) => (f.startsWith(loaded.location.appRoot) ? f.slice(loaded.location.appRoot.length + 1) : f)).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
      <AgentAutoStartSetting />
      <Field
        label="AppShape's tools (MCP)"
        hint={`For agents not listed: add this command as an MCP server named appshape${loaded.mcp.env ? `, with the environment variable${Object.keys(loaded.mcp.env).length > 1 ? "s" : ""} ${Object.entries(loaded.mcp.env).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}.`}
      >
        <Copyable text={command} />
      </Field>
    </Fields>
  );
}

function CommandLine({ loaded, draft }: { loaded: SettingsResponse; draft: Draft }) {
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s}"` : s);
  const app = q(loaded.location.appRoot);
  const s = draft.settings;
  const commands: [string, string][] = [
    ["Open the board", `appshape dev ${app}${s.board?.port ? ` --port ${s.board.port}` : ""}${s.board?.open === false ? " --no-open" : ""}`],
    ["Bring in pages", `appshape import ${app}${s.app?.devUrl ? ` --url ${s.app.devUrl}` : ""}`],
    ["Send the design to the code", `appshape apply ${app}${s.code?.stack ? ` --stack ${s.code.stack}` : ""} --yes`],
    ["Check your AI's work", `appshape verify <changeset> --app ${app}${s.app?.devUrl ? ` --url ${s.app.devUrl}` : ""}`],
    ["Connect an AI agent", `appshape init ${app} --agent claude|cursor|codex|generic`],
    ["AppShape's tools for agents (MCP)", [loaded.mcp.command, ...loaded.mcp.args.map(q)].join(" ")],
  ];
  return (
    <Fields title="Command line" intro="Everything here also works in a terminal; these are the commands for this project with its settings (saved settings apply to them automatically).">
      {commands.map(([label, command]) => (
        <Field key={label} label={label}>
          <Copyable text={command} />
        </Field>
      ))}
      <p className="text-xs text-zinc-500">No appshape command in your terminal? In the AppShape desktop app, switch it on at the bottom of the start window.</p>
    </Fields>
  );
}

const INPUT = "w-full max-w-sm rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500";
const CODE = "block break-all rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700";

/** An image of the project (uploaded into .appshape/assets): preview, choose, remove. */
export function ImagePick({ label, value, onChange }: { label: string; value: string | undefined; onChange: (src: string | undefined) => void }) {
  const token = useEditor((s) => s.token);
  const preview = value?.startsWith("asset:") ? (token ? assetUrl(token, value) : "") : value;
  return (
    <div className="flex items-center gap-2">
      {preview ? <img src={preview} alt="" className="h-8 w-8 rounded border border-zinc-200 object-contain" /> : <span className="h-8 w-8 rounded border border-dashed border-zinc-300" aria-hidden />}
      <button
        type="button"
        aria-label={`Choose ${label.toLowerCase()}`}
        onClick={async (e) => {
          e.preventDefault();
          const file = await chooseImageFile();
          if (!file) return;
          try {
            onChange((await addImageFile(file)).src);
          } catch (error) {
            notify(`Couldn't add the image: ${(error as Error).message}`, "error");
          }
        }}
        className="rounded border border-zinc-300 px-2 py-1 text-xs hover:border-zinc-500"
      >
        {value ? "Replace…" : "Choose…"}
      </button>
      {value && (
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={(e) => {
            e.preventDefault();
            onChange(undefined);
          }}
          className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-600"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** AppShape's own AI: the key (where it comes from), the model, and what it cost. */
function AiSettings() {
  const token = useEditor((s) => s.token)!;
  const ai = useEditor((s) => s.ai);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => void loadAi(), []);
  const save = async (update: Parameters<typeof saveAi>[1]) => {
    setBusy(true);
    try {
      useEditor.setState({ ai: await saveAi(token, update) });
      setKey("");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  if (!ai) return <Fields title="AppShape AI" intro="Loading…">{null}</Fields>;
  const money = (usd: number) => `$${usd.toFixed(2)}`;
  return (
    <Fields title="AppShape AI" intro="Designs your drawings in seconds with your own Anthropic API key. Optional: without it, your coding agent designs them, or they go to it as notes.">
      <Field label="API key" hint={ai.canSaveKey ? "Kept in this computer's keychain, never in the project or the browser. ANTHROPIC_API_KEY wins when it is set." : "Set ANTHROPIC_API_KEY in the terminal before starting AppShape (appshape dev / start). Keys typed here are saved only in the desktop app."}>
        <div className="flex items-center gap-2" data-testid="ai-key">
          {ai.keySource === "none" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">No key</span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
              <Check size={12} /> {ai.keySource === "env" ? "From ANTHROPIC_API_KEY" : "Saved in the keychain"}
            </span>
          )}
          {ai.keySource === "keychain" && (
            <button type="button" disabled={busy} onClick={() => void save({ key: null })} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
              Remove
            </button>
          )}
        </div>
        {ai.canSaveKey && (
          <div className="mt-2 flex gap-2">
            <input type="password" aria-label="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs" />
            <button type="button" disabled={busy || !key.trim()} onClick={() => void save({ key: key.trim() })} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40">
              Save key
            </button>
          </div>
        )}
      </Field>
      <Field label="Model" hint="Also chosen in the drawing panel, with each model's expected cost.">
        <select aria-label="AI model" value={ai.model} disabled={busy} onChange={(e) => void save({ model: e.target.value })} className="rounded-md border border-zinc-300 px-2 py-1 text-sm">
          {ai.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}: {m.note}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Spent">
        <p className="pt-1.5 text-zinc-700" data-testid="ai-spent">
          {ai.month.requests ? `${money(ai.month.costUsd)} this month (${ai.month.requests} design${ai.month.requests === 1 ? "" : "s"})` : "Nothing this month"}
          {ai.last && <span className="text-zinc-500"> · last: {money(ai.last.costUsd)}</span>}
        </p>
      </Field>
      <Field label="What is sent" hint={ai.consented ? "You agreed to this the first time you used it." : "You're asked the first time you use it."}>
        <p className="pt-1.5 text-zinc-700">For each drawing: a picture of the screen (with and without the drawing), the screen as JSX, your message, and the design system's tokens and components. They go to Anthropic's Claude API with your key. Projects and keys stay on this computer.</p>
      </Field>
    </Fields>
  );
}

function Fields({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {intro && <p className="mt-0.5 text-zinc-500">{intro}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3">
      <div className="pt-1.5 text-zinc-700">{label}</div>
      <div>
        {children}
        {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={value ?? ""}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? undefined : Math.round(n));
      }}
      className="w-32 rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500"
    />
  );
}

function Lines({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <textarea
      aria-label={label}
      rows={3}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean));
      }}
      className="w-full max-w-sm rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-500"
    />
  );
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-1">
      <code className={`${CODE} flex-1`}>{text}</code>
      <button
        type="button"
        aria-label="Copy"
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        className="grid h-7 w-7 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-100"
      >
        {copied ? <Check size={14} className="text-teal-600" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
