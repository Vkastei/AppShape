import { type AnyOp, type DesignNode, type Frame, type Interaction, OVERLAY_KINDS, SCREEN_TRANSITIONS, walk } from "@appshape/ir";
import { OVERLAYS } from "@appshape/kit";
import { newOpId } from "../lib/board";
import { sourcesOf } from "../lib/components";
import { overlayFromKit } from "../lib/library";
import { dispatch, type NodeSelection, useEditor } from "../store";
import { Row, Section, Segmented, TextInput } from "./Fields";

/**
 * What clicking an element does: go to a screen (links and buttons), open an overlay screen as a
 * modal, drawer or dropdown (a new one from the kit, or any screen, which then becomes an overlay),
 * close the overlay it is in, scroll to a section, or, inside a component, switch a property.
 */

type Mode = "none" | "screen" | "open" | "close" | "scroll" | "variant";
const AS_LABEL: Record<(typeof OVERLAY_KINDS)[number], string> = { modal: "Modal", drawer: "Drawer", dropdown: "Dropdown" };

export function InteractionSection({ node, frame, sel }: { node: DesignNode; frame: Frame; sel: NodeSelection }) {
  const project = useEditor((s) => s.project)!;
  const base = { frameId: sel.frameId, nodeId: sel.nodeId };
  // a link's or button's target screen, or an instance's link property (a Button's "opens")
  const source = node.type === "instance" ? sourcesOf(project).get(node.componentId) : undefined;
  const linkProp = source?.def.props.find((p) => p.bindings?.some((b) => b.nodeId === source.root.id && b.field === "target"));
  const linkable = node.type === "link" || node.type === "button" || Boolean(linkProp);
  const target = node.type === "link" || node.type === "button" ? node.targetFrameId : node.type === "instance" && linkProp && typeof node.props[linkProp.name] === "string" ? (node.props[linkProp.name] as string) : undefined;
  const targetOp = (frameId: string | null): AnyOp =>
    linkProp ? { id: newOpId(), ...base, op: "setProps", props: { [linkProp.name]: frameId } } : { id: newOpId(), ...base, op: "setLink", targetFrameId: frameId };
  const mode: Mode = node.interaction?.type === "open" ? "open" : node.interaction ? node.interaction.type : target ? "screen" : "none";
  const props = frame.kind === "component" ? (frame.component?.props ?? []).filter((p) => p.type === "enum" || p.type === "boolean") : [];
  const screens = project.frames.filter((f) => f.id !== frame.id && f.kind !== "component");
  const sections = "children" in frame.current ? frame.current.children : [];

  /** The interaction (or none), and no screen link when it does something else. */
  const set = (interaction: Interaction | null, extra: AnyOp[] = []) =>
    dispatch([...extra, ...(target && interaction ? [targetOp(null)] : []), { id: newOpId(), ...base, op: "setAttrs", attrs: { interaction } }]);
  const open = node.interaction?.type === "open" ? node.interaction : undefined;
  /** How other elements open the overlay (a mobile menu is a drawer everywhere), else a modal. */
  const usual = (frameId: string): Extract<Interaction, { type: "open" }> | undefined => {
    for (const f of project.frames) {
      let found: Extract<Interaction, { type: "open" }> | undefined;
      walk(f.current, (n) => {
        if (!found && n.interaction?.type === "open" && n.interaction.frameId === frameId) found = n.interaction;
      });
      if (found) return found;
    }
    return undefined;
  };
  const openScreen = (frameId: string, as = open?.as ?? usual(frameId)?.as ?? "modal", side = open?.side ?? usual(frameId)?.side) => {
    const screen = project.frames.find((f) => f.id === frameId);
    // a screen opened over others is an overlay (generated with the pages that open it)
    const mark: AnyOp[] = screen && !screen.overlay ? [{ id: newOpId(), frameId, op: "updateFrame", patch: { overlay: true } }] : [];
    set({ type: "open", frameId, as, ...(as === "drawer" && { side: side ?? "right" }) }, mark);
  };
  const choose = (next: Mode) => {
    if (next === mode) return;
    if (next === "none") return dispatch([...(target ? [targetOp(null)] : []), ...(node.interaction ? [{ id: newOpId(), ...base, op: "setAttrs" as const, attrs: { interaction: null } }] : [])]);
    if (next === "screen") return dispatch([{ id: newOpId(), ...base, op: "setAttrs", attrs: { interaction: null } }, targetOp(screens.find((f) => !f.overlay)?.id ?? null)]);
    if (next === "open") {
      const overlay = project.frames.find((f) => f.overlay && f.id !== frame.id);
      if (overlay) return openScreen(overlay.id);
      const created = overlayFromKit("dialog");
      if (created) set({ type: "open", frameId: created.frameId, as: "modal" }, created.ops);
      return;
    }
    if (next === "close") return set({ type: "close" });
    if (next === "scroll") return sections[0] && set({ type: "scroll", nodeId: sections[0].id });
    if (next === "variant" && props[0]) set({ type: "variant", prop: props[0].name, value: props[0].type === "boolean" ? "toggle" : (props[0].options?.[0] ?? "") });
  };

  return (
    <Section title="On click">
      <Row label="Does" hint="What clicking it does, in the prototype and in the app">
        <select aria-label="On click" value={mode} onChange={(e) => choose(e.target.value as Mode)} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
          <option value="none">Nothing</option>
          {linkable && <option value="screen">Go to a screen</option>}
          <option value="open">Open an overlay (menu, dialog…)</option>
          {frame.overlay && <option value="close">Close this overlay</option>}
          {sections.length > 0 && <option value="scroll">Scroll to a section</option>}
          {props.length > 0 && <option value="variant">Switch a property</option>}
        </select>
      </Row>
      {mode === "screen" && linkable && (
        <>
          <Row label="Screen">
            <select
              aria-label="Target screen"
              value={target ?? ""}
              onChange={(e) => dispatch([targetOp(e.target.value || null)])}
              className="w-full rounded border border-zinc-200 px-1 py-1 text-xs"
            >
              <option value="">— none —</option>
              {screens
                .filter((f) => !f.overlay)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} {f.target.route ? `(${f.target.route})` : ""}
                  </option>
                ))}
            </select>
          </Row>
          {node.type === "link" && (
            <Row label="Or URL">
              <TextInput label="Link URL" value={node.href} placeholder="https://…" onCommit={(href) => dispatch([{ id: newOpId(), ...base, op: "setLink", href: href || null }])} />
            </Row>
          )}
        </>
      )}
      {mode === "open" && open && (
        <>
          <Row label="Overlay" hint="The screen shown over the page; a new one comes from the kit">
            <select
              aria-label="Overlay screen"
              value={open.frameId}
              onChange={(e) => {
                const value = e.target.value;
                if (!value.startsWith("new:")) return openScreen(value, usual(value)?.as ?? open.as, usual(value)?.side ?? open.side);
                const key = value.slice(4);
                const created = overlayFromKit(key);
                const def = OVERLAYS.find((o) => o.key === key)!;
                if (created) set({ type: "open", frameId: created.frameId, as: def.as, ...(def.side && { side: def.side }) }, created.ops);
              }}
              className="w-full rounded border border-zinc-200 px-1 py-1 text-xs"
            >
              {screens.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.overlay ? "" : " (becomes an overlay)"}
                </option>
              ))}
              {OVERLAYS.map((o) => (
                <option key={o.key} value={`new:${o.key}`}>
                  New: {o.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Show as">
            <Segmented label="Show as" value={open.as} options={OVERLAY_KINDS.map((k) => ({ value: k, label: AS_LABEL[k] }))} onChange={(as) => openScreen(open.frameId, as)} />
          </Row>
          {open.as === "drawer" && (
            <Row label="From">
              <Segmented label="Drawer side" value={open.side ?? "right"} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} onChange={(side) => openScreen(open.frameId, "drawer", side)} />
            </Row>
          )}
        </>
      )}
      {mode === "scroll" && node.interaction?.type === "scroll" && (
        <Row label="To">
          <select aria-label="Scroll to" value={node.interaction.nodeId} onChange={(e) => set({ type: "scroll", nodeId: e.target.value })} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
            {sections.map((s, i) => (
              <option key={s.id} value={s.id}>
                {s.name ?? `Section ${i + 1}`}
              </option>
            ))}
          </select>
        </Row>
      )}
      {mode === "variant" && node.interaction?.type === "variant" && (
        <VariantRows interaction={node.interaction} props={props} onChange={(i) => set(i)} />
      )}
    </Section>
  );
}

function VariantRows({ interaction, props, onChange }: { interaction: Extract<Interaction, { type: "variant" }>; props: NonNullable<Frame["component"]>["props"]; onChange: (i: Interaction) => void }) {
  const prop = props.find((p) => p.name === interaction.prop) ?? props[0]!;
  const values = prop.type === "boolean" ? [{ value: "toggle", label: "Toggle" }, { value: "true", label: "On" }, { value: "false", label: "Off" }] : (prop.options ?? []).map((o) => ({ value: o, label: o }));
  return (
    <>
      <Row label="Property">
        <select aria-label="Property to switch" value={prop.name} onChange={(e) => {
          const next = props.find((p) => p.name === e.target.value)!;
          onChange({ type: "variant", prop: next.name, value: next.type === "boolean" ? "toggle" : (next.options?.[0] ?? "") });
        }} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
          {props.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </Row>
      <Row label="To">
        <select aria-label="Switch to" value={interaction.value} onChange={(e) => onChange({ type: "variant", prop: prop.name, value: e.target.value })} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
          {values.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}

const TRANSITION_LABEL: Record<(typeof SCREEN_TRANSITIONS)[number], string> = { instant: "Instant", fade: "Fade", slide: "Slide", push: "Push" };

/** A screen's role: a page, or an overlay shown over others; how it arrives in the prototype. */
export function ScreenBehaviorRows({ frame }: { frame: Frame }) {
  return (
    <>
      <Row label="Shown as" hint="Overlays (menus, dialogs) are opened by elements of other screens; they have no page of their own">
        <Segmented
          label="Screen kind"
          value={frame.overlay ? "overlay" : "page"}
          options={[{ value: "page", label: "Page" }, { value: "overlay", label: "Overlay" }]}
          onChange={(v) => dispatch([{ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { overlay: v === "overlay" ? true : null } }])}
        />
      </Row>
      {!frame.overlay && (
        <Row label="Arrives" hint="How the screen comes in when a link opens it in the prototype">
          <Segmented
            label="Screen transition"
            value={frame.transition ?? "instant"}
            options={SCREEN_TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABEL[t] }))}
            onChange={(t) => dispatch([{ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { transition: t === "instant" ? null : t } }])}
          />
        </Row>
      )}
    </>
  );
}
