import { type ComponentSource, type DesignNode, isContainer, MOTION_DEFAULTS, MOTION_DISTANCE, type Motion } from "@appshape/ir";
import { camelCase } from "./names";

/**
 * Entrances as Motion code (apps that use Motion): `initial` / `animate` or `whileInView` with the
 * preset's start and end, and a `transition`. A staggered element is the trigger (`initial="hidden"`,
 * `whileInView="show"`) and each child carries the preset as variants with its own delay, so all of
 * it stays plain data (it can be passed to Motion from a React Server Component). Elements Motion
 * can't animate here (router links, icons, fields) keep the CSS classes.
 */

const EASE: Record<NonNullable<Motion["easing"]>, string> = { linear: "linear", in: "easeIn", out: "easeOut", "in-out": "easeInOut" };

/** Start and end of a preset as Motion values (`y` and `x` are Motion's translate). */
export function motionStates(preset: Motion["preset"]): { hidden: Record<string, number | string>; show: Record<string, number | string> } {
  const d = MOTION_DISTANCE;
  switch (preset) {
    case "fade":
      return { hidden: { opacity: 0 }, show: { opacity: 1 } };
    case "slide-up":
      return { hidden: { opacity: 0, y: d }, show: { opacity: 1, y: 0 } };
    case "slide-down":
      return { hidden: { opacity: 0, y: -d }, show: { opacity: 1, y: 0 } };
    case "slide-left":
      return { hidden: { opacity: 0, x: d }, show: { opacity: 1, x: 0 } };
    case "slide-right":
      return { hidden: { opacity: 0, x: -d }, show: { opacity: 1, x: 0 } };
    case "scale":
      return { hidden: { opacity: 0, scale: 0.92 }, show: { opacity: 1, scale: 1 } };
    case "blur":
      return { hidden: { opacity: 0, filter: "blur(8px)" }, show: { opacity: 1, filter: "blur(0px)" } };
  }
}

/** `{ opacity: 0, y: 24 }` */
export function objectLiteral(value: Record<string, number | string | Record<string, number | string>>): string {
  const entries = Object.entries(value).map(([k, v]) => `${k}: ${typeof v === "object" ? objectLiteral(v) : typeof v === "string" ? JSON.stringify(v) : v}`);
  return `{ ${entries.join(", ")} }`;
}

const seconds = (ms: number) => +(ms / 1000).toFixed(3);

/** `{ duration: 0.6, ease: "easeOut", delay: 0.1 }` */
export function motionTransition(motion: Motion, delayMs = motion.delay ?? 0): string {
  return objectLiteral({
    duration: seconds(motion.duration ?? MOTION_DEFAULTS.duration),
    ease: EASE[motion.easing ?? MOTION_DEFAULTS.easing],
    ...(delayMs > 0 && { delay: seconds(delayMs) }),
  });
}

/** When it plays: `animate="show"`, or `whileInView` with the viewport options (as the CSS apps' ScrollReveal). */
export function triggerAttrs(motion: Motion, target: string): string[] {
  if (motion.trigger === "load") return [`animate=${target}`];
  const viewport = motion.trigger === "scroll" ? `{{ once: true, margin: "0px 0px -10% 0px" }}` : `{{ margin: "0px 0px -10% 0px" }}`;
  return [`whileInView=${target}`, `viewport=${viewport}`];
}

/** The name of a preset's variants (`slideUp`). */
export const variantsName = (preset: Motion["preset"]) => `${camelCase(preset)}${preset === "fade" || preset === "scale" || preset === "blur" ? "In" : ""}`;

/** `const slideUp = { hidden: { … }, show: { … } } satisfies Variants;` */
export function variantsConst(preset: Motion["preset"]): string {
  const { hidden, show } = motionStates(preset);
  return `const ${variantsName(preset)} = {\n  hidden: ${objectLiteral(hidden)},\n  show: ${objectLiteral(show)},\n} satisfies Variants;`;
}


/** Which elements become Motion elements: decided once for the whole app (pages and components). */
export interface MotionPlan {
  /** Staggered elements Motion plays (their children carry variants). */
  staggers: Set<string>;
  /** Components whose root takes `variants` and `transition` (they are staggered children somewhere). */
  components: Set<string>;
  /** Children of those, with the staggered element's entrance and their place among the children. */
  children: Map<string, { motion: Motion; index: number }>;
  /** Whether Motion can animate the element where it is generated. */
  able(node: DesignNode): boolean;
}

/**
 * The plan for an app with Motion: an element can be a Motion element unless it is a router link
 * (a button or link to a screen), an icon, a field or a slot; a staggered element is played by
 * Motion when it and all its children can be (a component's root must be one).
 */
export function planMotion(roots: readonly DesignNode[], sources: ReadonlyMap<string, ComponentSource>): MotionPlan {
  const boundTargets = new Set<string>();
  for (const source of sources.values()) for (const prop of source.def.props) for (const b of prop.bindings ?? []) if (b.field === "target") boundTargets.add(b.nodeId);
  const able = (node: DesignNode) => motionable(node, boundTargets);
  const plan: MotionPlan = { staggers: new Set(), components: new Set(), children: new Map(), able };
  const childAble = (child: DesignNode) => (child.type === "instance" ? Boolean(sources.get(child.componentId) && able(sources.get(child.componentId)!.root)) : able(child));
  const visit = (node: DesignNode) => {
    const motion = node.style?.motion;
    if (motion?.stagger && isContainer(node) && able(node) && node.children.length > 0 && node.children.every(childAble)) {
      plan.staggers.add(node.id);
      node.children.forEach((child, index) => {
        plan.children.set(child.id, { motion, index });
        if (child.type === "instance") plan.components.add(child.componentId);
      });
    }
    if (isContainer(node)) node.children.forEach(visit);
  };
  roots.forEach(visit);
  for (const source of sources.values()) visit(source.root);
  return plan;
}

/** Whether Motion can animate this element where it is generated. */
export function motionable(node: DesignNode, boundTargets: ReadonlySet<string>): boolean {
  switch (node.type) {
    case "text":
    case "image":
    case "box":
    case "scroll":
    case "list":
    case "element":
      return true;
    case "button":
    case "link":
      return !node.targetFrameId && !boundTargets.has(node.id);
    default:
      return false;
  }
}
