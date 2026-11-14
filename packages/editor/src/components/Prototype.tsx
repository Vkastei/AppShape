import { type DesignNode, type Frame, type Interaction, type JsonValue, navTargets, propDefault, themedTokens } from "@appshape/ir";
import { ArrowLeft, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../lib/api";
import { sourcesOf } from "../lib/components";
import { useEditor } from "../store";
import { FrameView } from "./FrameView";

/**
 * Click-through preview, like the real site: links and buttons with a target screen navigate (with
 * the screen's transition), elements open overlay screens (modal, drawer, dropdown) and close them,
 * scroll to a section, or switch a component's property (a tab, an open question). Hover states,
 * entrances and disclosures run as in the app.
 */

interface OpenOverlay {
  frameId: string;
  as: Extract<Interaction, { type: "open" }>["as"];
  side: "left" | "right";
  /** Dropdowns: where the element that opened it is, relative to the page area. */
  anchor?: { x: number; y: number; h: number };
}

/** Plays a screen transition on the page that just arrived (`back`: the other way). */
function arrive(element: HTMLElement | null, transition: Frame["transition"], back: boolean): void {
  if (!element || !transition || transition === "instant") return;
  const from = back ? "-100%" : "100%";
  const keyframes: Keyframe[] = transition === "fade" ? [{ opacity: 0 }, { opacity: 1 }] : [{ translate: `${from} 0`, ...(transition === "slide" && { opacity: 0.4 }) }, { translate: "0 0", opacity: 1 }];
  element.animate(keyframes, { duration: transition === "fade" ? 200 : 300, easing: "ease-out" });
}

export function Prototype() {
  const prototype = useEditor((s) => s.prototype);
  const project = useEditor((s) => s.project)!;
  const token = useEditor((s) => s.token)!;
  const [viewportId, setViewportId] = useState<string>();
  const [flash, setFlash] = useState(false);
  const [overlay, setOverlay] = useState<OpenOverlay>();
  /** Property values switched by clicks (tabs, questions), per instance on the screen. */
  const [switched, setSwitched] = useState<Record<string, Record<string, JsonValue>>>({});
  /** The page that is leaving (push transitions show both). */
  const [leaving, setLeaving] = useState<{ frameId: string; back: boolean }>();
  const navigation = useRef<{ back: boolean } | undefined>(undefined);
  const pageRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const resolveAsset = useCallback((src: string) => assetUrl(token, src), [token]);
  const frame = prototype && project.frames.find((f) => f.id === prototype.frameId);
  const sources = useMemo(() => sourcesOf(project), [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !useEditor.getState().prototype) return;
      e.stopImmediatePropagation();
      // an open overlay first, then the prototype
      setOverlay((open) => {
        if (!open) useEditor.setState({ prototype: undefined });
        return undefined;
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // a new screen: its transition, a fresh state
  useLayoutEffect(() => {
    if (!frame) return;
    const nav = navigation.current;
    navigation.current = undefined;
    setOverlay(undefined);
    setSwitched({});
    if (nav) arrive(pageRef.current, frame.transition, nav.back);
    const timer = window.setTimeout(() => setLeaving(undefined), 300);
    return () => window.clearTimeout(timer);
  }, [frame?.id]);

  // the screen with the switched properties of its instances
  const tree = useMemo(() => (frame ? withSwitched(frame.current, switched) : undefined), [frame, switched]);

  if (!prototype || !frame || !tree) return null;
  const viewport = frame.viewports.find((v) => v.id === viewportId) ?? frame.viewports[0]!;

  const go = (frameId: string, back = false) => {
    const target = back ? prototype.history.at(-1) : frameId;
    if (!target) return;
    navigation.current = { back };
    const arriving = back ? frame : project.frames.find((f) => f.id === target);
    if (arriving?.transition === "push") setLeaving({ frameId: frame.id, back });
    if (back) useEditor.setState({ prototype: { frameId: target, history: prototype.history.slice(0, -1) } });
    else useEditor.setState({ prototype: { frameId: target, history: [...prototype.history, prototype.frameId] } });
  };

  const run = (action: Interaction, element: Element) => {
    switch (action.type) {
      case "open": {
        if (!project.frames.some((f) => f.id === action.frameId)) return;
        const area = areaRef.current!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        // the same element again closes it (like a menu button)
        setOverlay((open) => (open?.frameId === action.frameId ? undefined : { frameId: action.frameId, as: action.as, side: action.side ?? "right", anchor: { x: rect.left - area.left, y: rect.top - area.top, h: rect.height } }));
        return;
      }
      case "close":
        setOverlay(undefined);
        return;
      case "scroll": {
        const target = (element.getRootNode() as ParentNode).querySelector(`[data-aps="${CSS.escape(action.nodeId)}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      case "variant": {
        // the instance the element belongs to: its rendered id is the element's up to the last part
        const rendered = element.getAttribute("data-aps-i");
        const instanceId = rendered?.slice(0, rendered.lastIndexOf("/"));
        const instance = instanceId ? findInstance(frame.current, instanceId) : undefined;
        const source = instance && sources.get(instance.componentId);
        const prop = source?.def.props.find((p) => p.name === action.prop);
        if (!instance || !source || !prop) return;
        const current = switched[instance.id]?.[prop.name] ?? instance.props[prop.name] ?? propDefault(source.root, prop) ?? null;
        const value = prop.type === "boolean" ? (action.value === "toggle" ? !current : action.value === "true") : prop.type === "number" ? Number(action.value) : action.value;
        setSwitched((all) => ({ ...all, [instance.id]: { ...all[instance.id], [prop.name]: value } }));
        return;
      }
    }
  };

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    for (const target of event.composedPath()) {
      const element = target as Element;
      const action = element.getAttribute?.("data-aps-action");
      if (action) {
        run(JSON.parse(action) as Interaction, element);
        return;
      }
      // links and buttons carry their target screen, also inside component instances
      const targetFrameId = element.getAttribute?.("data-aps-target");
      if (targetFrameId && project.frames.some((f) => f.id === targetFrameId)) {
        go(targetFrameId);
        return;
      }
    }
    // nothing clickable: briefly show what is
    setFlash(true);
    window.setTimeout(() => setFlash(false), 600);
  };

  const hotspots = navTargets(frame.current, sources, frame.id).length;
  const view = (f: Frame, t: DesignNode) => (
    <FrameView
      key={f.id}
      tree={t}
      name={f.name}
      viewport={f.viewports.find((v) => v.id === viewport.id) ?? f.viewports[0]!}
      tokens={themedTokens(project.tokens, f.theme)}
      components={project.components}
      resolveAsset={resolveAsset}
      sources={sources}
      componentId={f.kind === "component" ? f.id : undefined}
      interactive
      live
      onClick={onClick}
    />
  );
  const overlayFrame = overlay && project.frames.find((f) => f.id === overlay.frameId);
  const leavingFrame = leaving && project.frames.find((f) => f.id === leaving.frameId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-800/95" role="dialog" aria-label={`Prototype: ${frame.name}`}>
      <div className="flex h-12 shrink-0 items-center gap-2 px-3 text-white">
        <button type="button" onClick={() => go(frame.id, true)} disabled={prototype.history.length === 0} aria-label="Back" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10 disabled:opacity-30">
          <ArrowLeft size={16} />
        </button>
        <span className="font-semibold" data-testid="prototype-screen">
          {frame.name}
        </span>
        <span className="font-mono text-xs text-zinc-400">{frame.target.route}</span>
        {frame.viewports.length > 1 && (
          <select aria-label="Prototype viewport" value={viewport.id} onChange={(e) => setViewportId(e.target.value)} className="ml-2 rounded bg-zinc-700 px-1 py-0.5 text-xs">
            {frame.viewports.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} · {v.width}px
              </option>
            ))}
          </select>
        )}
        <span className="flex-1 text-center text-xs text-zinc-400">Click links and buttons to try them · Esc to close</span>
        <button type="button" onClick={() => useEditor.setState({ prototype: undefined })} aria-label="Close prototype" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10">
          <X size={16} />
        </button>
      </div>
      <div className="relative mx-auto min-h-0 w-full flex-1 overflow-hidden" style={{ maxWidth: viewport.width + 48 }} ref={areaRef}>
        <div className="absolute inset-0 overflow-auto p-6" data-testid="prototype-page">
          <div ref={pageRef} className="mx-auto bg-white shadow-2xl" style={{ width: viewport.width, minHeight: viewport.height }}>
            {view(frame, tree)}
          </div>
        </div>
        {leavingFrame && (
          // push: the previous page moves out while the new one comes in
          <div className="pointer-events-none absolute inset-0 overflow-hidden p-6">
            <div
              className="mx-auto bg-white"
              style={{ width: viewport.width }}
              ref={(el) => {
                el?.animate([{ translate: "0 0" }, { translate: leaving!.back ? "100% 0" : "-100% 0" }], { duration: 300, easing: "ease-out", fill: "forwards" });
              }}
            >
              {view(leavingFrame, leavingFrame.current)}
            </div>
          </div>
        )}
        {overlay && overlayFrame && (
          <div className="absolute inset-0 z-10" data-testid="prototype-overlay">
            <div aria-hidden className={`absolute inset-0 ${overlay.as === "dropdown" ? "" : "bg-black/40"}`} onClick={() => setOverlay(undefined)} />
            <div
              role="dialog"
              aria-label={overlayFrame.name}
              className="absolute max-h-full overflow-auto shadow-2xl"
              style={
                overlay.as === "modal"
                  ? { left: "50%", top: "50%", translate: "-50% -50%" }
                  : overlay.as === "drawer"
                    ? { top: 0, bottom: 0, [overlay.side]: 24, background: "white" }
                    : { left: overlay.anchor?.x ?? 24, top: (overlay.anchor?.y ?? 0) + (overlay.anchor?.h ?? 0) + 8 }
              }
              ref={(el) => {
                el?.animate(overlay.as === "drawer" ? [{ translate: overlay.side === "right" ? "100% 0" : "-100% 0" }, { translate: "0 0" }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
              }}
            >
              {view(overlayFrame, overlayFrame.current)}
            </div>
          </div>
        )}
      </div>
      {flash && hotspots > 0 && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-ink px-3 py-1.5 text-xs text-white">
          {hotspots} clickable element{hotspots > 1 ? "s" : ""} on this screen
        </div>
      )}
    </div>
  );
}

/** The screen with the property values clicks switched on its instances. */
function withSwitched(root: DesignNode, switched: Record<string, Record<string, JsonValue>>): DesignNode {
  if (Object.keys(switched).length === 0) return root;
  const visit = (node: DesignNode): DesignNode => {
    const own = node.type === "instance" && switched[node.id] ? { ...node, props: { ...node.props, ...switched[node.id] } } : node;
    return "children" in own ? ({ ...own, children: own.children.map(visit) } as DesignNode) : own;
  };
  return visit(root);
}

function findInstance(root: DesignNode, id: string): Extract<DesignNode, { type: "instance" }> | undefined {
  if (root.type === "instance" && root.id === id) return root;
  if (!("children" in root)) return undefined;
  for (const child of root.children) {
    const found = findInstance(child, id);
    if (found) return found;
  }
  return undefined;
}
