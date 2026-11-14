import type { FolderListing } from "@appshape/protocol";
import { ArrowUp, Folder, HardDrive, Home, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hubApi } from "./hub";

/** Choosing a folder in the browser (the desktop app uses the system's dialog). */
export function FolderPicker({ token, title, start, onDone }: { token: string; title: string; start?: string; onDone: (path: string | undefined) => void }) {
  const [listing, setListing] = useState<FolderListing>();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();

  // only the latest listing counts, and it doesn't overwrite what was typed meanwhile
  const request = useRef(0);
  const typedSince = useRef(false);
  const go = (path?: string) => {
    setError(undefined);
    const id = ++request.current;
    typedSince.current = false;
    hubApi.folders(token, path).then(
      (l) => {
        if (id !== request.current) return;
        setListing(l);
        if (!typedSince.current) setTyped(l.path);
      },
      (e: unknown) => id === request.current && setError((e as Error).message),
    );
  };
  const type = (value: string) => {
    typedSince.current = true;
    setTyped(value);
  };
  useEffect(() => {
    go(start);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onDone(undefined);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6" role="dialog" aria-label={title} onPointerDown={(e) => e.target === e.currentTarget && onDone(undefined)}>
      <div className="flex h-[min(520px,100%)] w-full max-w-2xl flex-col rounded-xl border-[1.5px] border-ink bg-white shadow-offset">
        <header className="px-5 pb-3 pt-4">
          <h2 className="font-bold">{title}</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(typed);
            }}
          >
            <button type="button" aria-label="Up one folder" disabled={!listing?.parent} onClick={() => go(listing?.parent)} className="grid w-9 place-items-center rounded-lg border border-zinc-300 hover:border-ink disabled:opacity-40">
              <ArrowUp size={15} />
            </button>
            <input aria-label="Folder path" value={typed} onChange={(e) => type(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 font-mono text-[13px] outline-none focus:border-ink" />
          </form>
        </header>
        <div className="flex min-h-0 flex-1 border-y border-zinc-200">
          <nav aria-label="Places" className="w-36 shrink-0 space-y-0.5 overflow-auto border-r border-zinc-200 bg-zinc-50 p-2">
            {listing?.places.map((p) => (
              <button key={p.path} type="button" onClick={() => go(p.path)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-soft hover:bg-white hover:text-ink">
                {p.name === "Home" ? <Home size={14} /> : /^[A-Z]:$/.test(p.name) || p.name === "Computer" ? <HardDrive size={14} /> : <Folder size={14} />}
                {p.name}
              </button>
            ))}
          </nav>
          <ul className="min-w-0 flex-1 overflow-auto p-2" aria-label="Folders">
            {!listing ? (
              <Loader2 size={16} className="m-2 animate-spin text-ink-soft" />
            ) : listing.folders.length === 0 ? (
              <li className="p-2 text-sm text-ink-soft">No folders inside.</li>
            ) : (
              listing.folders.map((f) => (
                <li key={f.path}>
                  <button type="button" onDoubleClick={() => go(f.path)} onClick={() => type(f.path)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 ${typed === f.path ? "bg-brand-soft" : ""}`}>
                    <Folder size={15} className="shrink-0 text-brand-deep" />
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <footer className="flex items-center gap-2 px-5 py-3">
          <span className="flex-1 truncate text-xs text-red-700">{error ?? ""}</span>
          <span className="text-xs text-ink-soft">Double-click to open a folder</span>
          <button type="button" onClick={() => onDone(undefined)} className="rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-zinc-100">
            Cancel
          </button>
          <button type="button" disabled={!typed} onClick={() => onDone(typed)} className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-ink-soft disabled:opacity-40">
            Choose this folder
          </button>
        </footer>
      </div>
    </div>
  );
}
