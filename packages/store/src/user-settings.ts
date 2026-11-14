import { join, resolve } from "node:path";
import { z } from "zod";
import { readText, writeFileAtomic } from "./fs";
import { appshapeHome, samePath } from "./location";

/** Per-user settings (`~/.appshape/settings.json`): recent projects and personal preferences. */

const RecentProjectSchema = z.object({
  appRoot: z.string(),
  name: z.string(),
  openedAt: z.string(),
});
export type RecentProjectEntry = z.infer<typeof RecentProjectSchema>;

// Loose: newer AppShape versions may add settings that older ones keep.
const UserSettingsSchema = z.looseObject({
  version: z.literal(1),
  recent: z.array(RecentProjectSchema).default([]),
  /** The `appshape` command is installed on the PATH (desktop app). */
  cliOnPath: z.boolean().optional(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

const MAX_RECENT = 20;
const settingsFile = () => join(appshapeHome(), "settings.json");

export async function readUserSettings(): Promise<UserSettings> {
  const text = await readText(settingsFile());
  if (text !== undefined) {
    try {
      const parsed = UserSettingsSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // unreadable: start over
    }
  }
  return { version: 1, recent: [] };
}

export async function updateUserSettings(change: (settings: UserSettings) => UserSettings): Promise<UserSettings> {
  const next = change(await readUserSettings());
  await writeFileAtomic(settingsFile(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Puts a project at the top of the recent list. */
export function addRecentProject(appRoot: string, name: string, at = new Date()): Promise<UserSettings> {
  return updateUserSettings((s) => ({
    ...s,
    recent: [{ appRoot: resolve(appRoot), name, openedAt: at.toISOString() }, ...s.recent.filter((r) => !samePath(r.appRoot, appRoot))].slice(0, MAX_RECENT),
  }));
}

export function removeRecentProject(appRoot: string): Promise<UserSettings> {
  return updateUserSettings((s) => ({ ...s, recent: s.recent.filter((r) => !samePath(r.appRoot, appRoot)) }));
}
