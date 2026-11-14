import { EASINGS, type Motion, type Op, type Style, isContainer } from "@appshape/ir";
import { Play } from "lucide-react";
import { newOpId } from "../lib/board";
import { playOnBoard } from "../lib/motion";
import { type Target, shared } from "./DesignSections";
import { Row, Section, Segmented } from "./Fields";

/**
 * The inspector's animation section: how an element appears (a preset, when it plays, how long,
 * its children one after another) and what it does on hover. Hovering a preset plays it on the
 * board; the board itself keeps showing the end state.
 */

const PRESETS: { value: Motion["preset"]; label: string; name: string }[] = [
  { value: "fade", label: "Fade", name: "Fade in" },
  { value: "slide-up", label: "↑ Up", name: "Slide up" },
  { value: "slide-down", label: "↓ Down", name: "Slide down" },
  { value: "slide-left", label: "← Left", name: "Slide left" },
  { value: "slide-right", label: "→ Right", name: "Slide right" },
  { value: "scale", label: "Grow", name: "Grow in" },
  { value: "blur", label: "Sharpen", name: "Sharpen (blur in)" },
];
const EASING_LABEL: Record<(typeof EASINGS)[number], string> = { out: "Out", "in-out": "Smooth", in: "In", linear: "Linear" };
const DURATIONS = [300, 450, 600, 800, 1200];
const DELAYS = [0, 100, 200, 300, 500];
const STAGGERS = [60, 100, 150, 250];

/** Hover effects: what the element's hover state changes (with a transition, so it animates). */
const HOVER: Record<"lift" | "grow" | "dim", Partial<Style>> = {
  lift: { translate: { y: "-4px" } },
  grow: { scale: 105 },
  dim: { opacity: 0.8 },
};
type HoverEffect = keyof typeof HOVER | "none";

const hoverStyle = (t: Target) => t.node.overrides?.find((o) => o.when.state === "hover" && !o.when.viewport && !o.when.scheme && !o.when.prop)?.style;
function hoverOf(t: Target): HoverEffect {
  const style = hoverStyle(t);
  if (style?.translate?.y === "-4px" && style.translate.x === undefined) return "lift";
  if (style?.scale === 105) return "grow";
  if (style?.opacity === 0.8) return "dim";
  return "none";
}

export function MotionSection({ targets, send }: { targets: Target[]; send: (make: (t: Target) => Op[]) => void }) {
  const current = shared(targets, (t) => t.node.style?.motion);
  const motion = current.value;
  const staggerable = targets.every((t) => isContainer(t.node) && t.node.type !== "instance" && t.node.children.length > 1);

  const preview = (make: (t: Target) => Motion | undefined) => {
    for (const t of targets) playOnBoard({ itemId: t.sel.itemId, nodeId: t.node.id, ...(make(t) && { motion: make(t) }) });
  };
  /** Entrances belong to the element (not to a screen size or state). */
  const update = (patch: Partial<Motion> | null) => {
    const next = (t: Target): Motion | null => (patch === null ? null : ({ trigger: "scroll", ...t.node.style?.motion, ...patch } as Motion));
    send((t) => [{ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, op: "restyle", style: { motion: next(t) } }]);
    // show the result once the board has it
    if (patch) requestAnimationFrame(() => preview((t) => next(t) ?? undefined));
  };
  const set = <K extends keyof Motion>(key: K, value: Motion[K] | undefined) => update({ [key]: value } as Partial<Motion>);

  const hover = shared(targets, hoverOf);
  const setHover = (effect: HoverEffect) =>
    send((t) => {
      const before = hoverOf(t);
      const patch: Record<string, unknown> = {};
      if (before !== "none") for (const key of Object.keys(HOVER[before])) patch[key] = null;
      if (effect !== "none") Object.assign(patch, HOVER[effect]);
      const ops: Op[] = [{ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, op: "restyle", style: patch, when: { state: "hover" } }];
      // a hover effect animates: a transition if the element has none
      if (effect !== "none" && !t.node.style?.transition) ops.push({ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, op: "restyle", style: { transition: { property: "default", duration: 200, easing: "out" } } });
      return ops;
    });

  return (
    <Section
      title="Animation"
      actions={
        motion && (
          <button type="button" aria-label="Preview the animation" title="Preview on the board" onClick={() => preview(() => undefined)} className="grid h-5 w-5 place-items-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-accent-700">
            <Play size={12} />
          </button>
        )
      }
    >
      <div className="py-1 text-xs">
        <div className="mb-1 text-zinc-500" title="How it appears; hover a choice to see it">
          Appear
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Appear">
          <PresetChip label="None" name="No animation" pressed={!current.mixed && !motion} onClick={() => update(null)} />
          {PRESETS.map((p) => (
            <PresetChip
              key={p.value}
              label={p.label}
              name={p.name}
              pressed={motion?.preset === p.value}
              onClick={() => update({ preset: p.value })}
              onPreview={() => preview((t) => ({ trigger: "scroll", ...t.node.style?.motion, preset: p.value }) as Motion)}
            />
          ))}
        </div>
        {current.mixed && <p className="mt-1 text-[11px] text-zinc-500">Mixed: the selected elements appear differently.</p>}
      </div>
      {motion && (
        <>
          <Row label="Plays" hint="When the page opens, when it scrolls into view (once), or every time it does">
            <Segmented
              label="Plays"
              value={motion.trigger}
              options={[
                { value: "load", label: "Page opens", title: "When the page opens" },
                { value: "scroll", label: "In view", title: "When it scrolls into view (once)" },
                { value: "scroll-repeat", label: "Each time", title: "Every time it scrolls into view" },
              ]}
              onChange={(trigger) => set("trigger", trigger)}
            />
          </Row>
          <Row label="Duration">
            <Segmented label="Animation duration" value={String(motion.duration ?? 600)} options={DURATIONS.map((d) => ({ value: String(d), label: `${d}`, title: `${d} ms` }))} onChange={(d) => set("duration", Number(d) === 600 ? undefined : Number(d))} />
            <span className="text-[10px] text-zinc-400">ms</span>
          </Row>
          <Row label="Delay" hint="Wait before it starts">
            <Segmented label="Animation delay" value={String(motion.delay ?? 0)} options={DELAYS.map((d) => ({ value: String(d), label: `${d}`, title: `${d} ms` }))} onChange={(d) => set("delay", Number(d) || undefined)} />
            <span className="text-[10px] text-zinc-400">ms</span>
          </Row>
          <Row label="Easing" hint="Out: fast start, gentle end (natural for entrances); Smooth: slow start and end">
            <Segmented label="Animation easing" value={motion.easing ?? "out"} options={(["out", "in-out", "in", "linear"] as const).map((e) => ({ value: e, label: EASING_LABEL[e] }))} onChange={(easing) => set("easing", easing === "out" ? undefined : easing)} />
          </Row>
          {staggerable && (
            <Row label="Children" hint="Its children appear one after another (ms between them) instead of all together">
              <Segmented
                label="Children one by one"
                value={String(motion.stagger ?? 0)}
                options={[{ value: "0", label: "All", title: "All at once (the element itself)" }, ...STAGGERS.map((s) => ({ value: String(s), label: `${s}`, title: `One by one, ${s} ms apart` }))]}
                onChange={(s) => set("stagger", Number(s) || undefined)}
              />
            </Row>
          )}
        </>
      )}
      <Row label="On hover" hint="What it does while the pointer is over it (edits its Hover state, with a transition)">
        <Segmented
          label="On hover"
          value={hover.mixed ? undefined : hover.value}
          options={[
            { value: "none", label: "Nothing" },
            { value: "lift", label: "Lift", title: "Moves up a little" },
            { value: "grow", label: "Grow", title: "Grows a little (105 %)" },
            { value: "dim", label: "Dim", title: "Fades a little (80 %)" },
          ]}
          onChange={setHover}
        />
      </Row>
    </Section>
  );
}

function PresetChip({ label, name, pressed, onClick, onPreview }: { label: string; name: string; pressed: boolean; onClick: () => void; onPreview?: () => void }) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={pressed}
      title={name}
      onClick={onClick}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className={`rounded-md px-2 py-1 text-[11px] ${pressed ? "bg-accent-500 font-medium text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
    >
      {label}
    </button>
  );
}
