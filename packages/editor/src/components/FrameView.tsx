import type { Component, ComponentSources, DesignNode, Tokens, Viewport } from "@appshape/ir";
import type { AppStylesResponse } from "@appshape/protocol";
import { NODE_LAYER, RESET_LAYER, renderFrame } from "@appshape/render";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appPublicUrl, iconUrl } from "../lib/api";
import { createHandle, registerFrame } from "../lib/frames";
import { MOTION_EVENT, type MotionRequest, playAll, previewEntrance, runEntrances } from "../lib/motion";
import { type EditState, useEditor } from "../store";

interface FrameViewProps {
  /** Board placement id (for hit testing); omitted in prototype mode. */
  itemId?: string;
  tree: DesignNode;
  name: string;
  viewport: Viewport;
  tokens: Tokens;
  components: readonly Component[];
  resolveAsset: (src: string) => string;
  /** Components the tree uses (see `usedSources`), so unrelated edits don't re-render. */
  sources: ComponentSources;
  /** Component frames: the frame id (cycle guard) and stage rendering. */
  componentId?: string;
  onResize?: (width: number, height: number) => void;
  /** Prototype mode: the content receives clicks. */
  interactive?: boolean;
  /** Entrances run as in the app (on load, when scrolled into view); the board shows the end state. */
  live?: boolean;
  /** The color scheme to show, instead of the board's (previews). */
  scheme?: "light" | "dark";
  onClick?: (event: MouseEvent) => void;
}

/** Custom property the app's `prefers-color-scheme` rules are queried on (see capture's `schemeQueries`). */
export const SCHEME_PROPERTY = "--aps-scheme";

/**
 * Classes of the frame element: the app's `<html>` classes, `aps-dark` for the design's `dark:`
 * overrides, and for apps with class-based dark mode their `dark` class following the board.
 */
function frameClasses(appStyles: AppStylesResponse | undefined, scheme: "light" | "dark"): string {
  const classes = (appStyles?.htmlClasses ?? []).filter((c) => appStyles?.darkMode !== "class" || c !== "dark");
  if (scheme === "dark") classes.push("aps-dark", ...(appStyles?.darkMode === "class" ? ["dark"] : []));
  return classes.join(" ");
}

/**
 * A screen's design, rendered from IR into a shadow root: editor styles cannot leak in, screen
 * styles cannot leak out. On the board the content is inert; the canvas hit-tests it instead.
 */
function sameProps(a: FrameViewProps, b: FrameViewProps): boolean {
  for (const key of Object.keys({ ...a, ...b }) as (keyof FrameViewProps)[]) {
    if (key === "sources") continue;
    if (a[key] !== b[key]) return false;
  }
  if (a.sources.size !== b.sources.size) return false;
  for (const [id, source] of a.sources) if (b.sources.get(id) !== source) return false;
  return true;
}

export const FrameView = memo(function FrameView({
  itemId,
  tree,
  name,
  viewport,
  tokens,
  components,
  resolveAsset,
  sources,
  componentId,
  onResize,
  interactive = false,
  live = false,
  onClick,
  scheme: schemeOverride,
}: FrameViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot>();
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useLayoutEffect(() => {
    const host = hostRef.current!;
    setShadow(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);

  useEffect(() => {
    if (!shadow || !itemId) return;
    return registerFrame(itemId, createHandle(shadow));
  }, [shadow, itemId]);

  useEffect(() => {
    if (!shadow) return;
    const listener = (event: Event) => onClickRef.current?.(event as MouseEvent);
    shadow.addEventListener("click", listener);
    return () => shadow.removeEventListener("click", listener);
  }, [shadow]);

  useEffect(() => {
    const host = hostRef.current!;
    const observer = new ResizeObserver(() => onResizeRef.current?.(host.offsetWidth, host.offsetHeight));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Screens without a fixed height (web pages) render vh units against a typical laptop height.
  const viewportHeight = viewport.height ?? 800;
  // An imported app's CSS applies to every frame, so designs look like the app.
  const appStyles = useEditor((s) => s.appStyles);
  const boardCss = useEditor((s) => s.boardCss);
  const boardScheme = useEditor((s) => s.scheme);
  const scheme = schemeOverride ?? boardScheme;
  const token = useEditor((s) => s.token);
  const rootClassName = frameClasses(appStyles, scheme);
  // the selected element in the state the inspector edits ("Edit for: Hover" shows it hovered)
  const forced = useEditor((s) => (s.state && itemId && s.node?.itemId === itemId ? `${s.state}|${s.node.nodeId}` : undefined));
  const result = useMemo(
    () =>
      renderFrame(tree, {
        tokens,
        components,
        resolveAsset,
        viewportHeight,
        sources,
        frameId: componentId,
        stage: componentId !== undefined,
        ...(token && { resolveSrc: (src: string) => appPublicUrl(token, src), iconUrl: (set: string, name: string) => iconUrl(token, set, name) }),
        ...(appStyles?.layered && { layer: NODE_LAYER }),
        ...(rootClassName && { rootClassName }),
        ...(forced && { forceState: { state: forced.split("|")[0] as EditState, id: forced.slice(forced.indexOf("|") + 1) } }),
        ...(live && { prototype: true }),
      }),
    [tree, tokens, components, resolveAsset, viewportHeight, sources, componentId, token, appStyles, rootClassName, forced, live],
  );
  useEffect(() => {
    for (const warning of result.warnings) console.warn(`appshape: ${name}: ${warning}`);
  }, [result.warnings, name]);

  // entrances: run live (prototype), or played on request (Play, the inspector's previews)
  useEffect(() => {
    if (!shadow || !live) return;
    return runEntrances(shadow);
  }, [shadow, live, result]);
  useEffect(() => {
    if (!shadow || !itemId) return;
    const onPlay = (event: Event) => {
      const request = (event as CustomEvent<MotionRequest>).detail;
      if (request.itemId !== itemId) return;
      if (!request.nodeId) return playAll(shadow);
      const element = shadow.querySelector(`[data-aps="${CSS.escape(request.nodeId)}"]`);
      if (element) previewEntrance(element, request.motion);
    };
    window.addEventListener(MOTION_EVENT, onPlay);
    return () => window.removeEventListener(MOTION_EVENT, onPlay);
  }, [shadow, itemId]);

  return (
    <div ref={hostRef} data-frame-content={itemId} style={{ width: viewport.width }}>
      {shadow &&
        createPortal(
          <>
            <style>{`@layer ${RESET_LAYER};
:host { display: block; }
${appStyles?.shadow ?? ""}
${boardCss}
${result.css}`}</style>
            <div style={{ width: viewport.width, pointerEvents: interactive ? undefined : "none" }} inert={!interactive}>
              {result.element}
            </div>
          </>,
          shadow,
        )}
    </div>
  );
}, sameProps);
