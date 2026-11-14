import { type AnyOp, type Frame, type Project, themedTokens, type Tokens } from "@appshape/ir";
import { type GeneratedTheme, generateTheme, type ThemeOptions, type ThemeTarget, themeOps } from "@appshape/kit";
import { fontSlug, fontStack } from "@appshape/protocol";
import { dispatch, useEditor } from "../store";
import { installFont } from "./api";
import { newOpId } from "./board";
import { loadProjectFonts } from "./fonts";

/** The named theme a screen gets (its own, or a new one named after it). */
export function screenThemeTarget(project: Project, frame: Frame): ThemeTarget {
  if (frame.theme && project.tokens.themes?.[frame.theme]) return { id: frame.theme, name: project.tokens.themes[frame.theme]!.name };
  const base = fontSlug(frame.name) || "screen";
  let id = base;
  for (let i = 2; project.tokens.themes?.[id]; i++) id = `${base}-${i}`;
  return { id, name: frame.name };
}

/** The ops of a theme for the whole project, or for one screen (its named theme, assigned to it). */
export function themeChangeOps(project: Project, theme: GeneratedTheme, frame?: Frame): AnyOp[] {
  if (!frame) return themeOps(project.tokens, theme);
  const target = screenThemeTarget(project, frame);
  const ops: AnyOp[] = themeOps(project.tokens, theme, target);
  if (frame.theme !== target.id) ops.push({ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { theme: target.id } });
  return ops;
}

/** The tokens a screen (or, without one, the project) shows. */
export function tokensFor(tokens: Tokens, frame?: Frame): Tokens {
  return themedTokens(tokens, frame?.theme);
}

/**
 * Applies the theme starter's choices to the project or to one screen: installs the font pair into
 * the project (self-hosted, like the font picker), then writes every token in one command (one
 * Ctrl+Z undoes it).
 */
export async function applyTheme(options: ThemeOptions, frameId?: string): Promise<void> {
  const { token, project } = useEditor.getState();
  if (!token || !project) return;
  const stacks: Partial<Record<"heading" | "sans", string>> = {};
  for (const font of generateTheme(options).fonts) {
    let installed = useEditor.getState().fonts.find((f) => f.family === font.family);
    if (!installed) {
      const result = await installFont(token, font.family);
      await loadProjectFonts(result.fonts);
      installed = result.fonts.find((f) => f.family === font.family);
    }
    if (!installed) throw new Error(`${font.family} could not be installed.`);
    stacks[font.token] = fontStack(installed);
  }
  const current = useEditor.getState().project ?? project;
  const frame = frameId ? current.frames.find((f) => f.id === frameId) : undefined;
  const ops = themeChangeOps(current, generateTheme(options, stacks), frame);
  if (ops.length > 0) dispatch(ops);
}

/** A screen goes back to the project's theme (its named theme goes too when nothing else uses it). */
export function resetScreenTheme(frameId: string): void {
  const project = useEditor.getState().project;
  const frame = project?.frames.find((f) => f.id === frameId);
  if (!project || !frame?.theme) return;
  const ops: AnyOp[] = [{ id: newOpId(), frameId, op: "updateFrame", patch: { theme: null } }];
  if (!project.frames.some((f) => f.id !== frameId && f.theme === frame.theme)) ops.push({ id: newOpId(), op: "setTheme", theme: frame.theme, name: null });
  dispatch(ops);
}
