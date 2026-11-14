import { z } from "zod";
import { STACK_LABELS, type StackId } from "./code-wire";
import { AGENT_IDS } from "./settings-wire";

/**
 * The start page (`/start`): AppShape without a project, in the desktop app's window or the browser
 * (`appshape start`). Opens and creates projects; each project gets its own board server.
 */

export interface RecentProject {
  appRoot: string;
  name: string;
  openedAt: string;
  /** The folder is gone (moved or deleted). */
  missing: boolean;
  /** Board URL (with token) while the project is open. */
  board?: string;
}

export interface HubState {
  version: string;
  /** Running inside the desktop app (native folder picker, updates). */
  desktop: boolean;
  platform: string;
  recent: RecentProject[];
  /** Suggested parent folder for new apps. */
  defaultParent: string;
  /** Separator for showing paths. */
  sep: string;
}

export type CheckStatus = "ok" | "missing" | "outdated" | "optional";

/** One thing the computer needs, in plain words. */
export interface HubCheck {
  id: "node" | "npm" | "pnpm" | "git" | "browser";
  name: string;
  status: CheckStatus;
  version?: string;
  /** What it is for / what to do. */
  text: string;
  link?: { label: string; url: string };
}

export interface FolderApp {
  kind: "app" | "none" | "unsupported";
  /** Detected stack (kind app). */
  stack?: StackId;
  stackLabel?: string;
  reason?: string;
}

/** What is in a folder the user picked. */
export interface FolderInfo {
  path: string;
  name: string;
  exists: boolean;
  /** No files at all (a new app can be created here). */
  empty: boolean;
  /** An AppShape project exists for it (or for a folder it is in: appRoot). */
  project?: { name: string; appRoot: string; dataDir: string };
  app: FolderApp;
  packageManager?: string;
  /** The app's package manager isn't installed. */
  packageManagerMissing?: boolean;
}

export interface FolderListing {
  path: string;
  parent?: string;
  folders: { name: string; path: string }[];
  /** Drives and common places. */
  places: { name: string; path: string }[];
}

export const HubPathSchema = z.strictObject({ path: z.string().min(1) });

export const HubOpenSchema = z.strictObject({
  path: z.string().min(1),
  /** Open the import dialog on a project created for an existing app. */
  importPages: z.boolean().optional(),
});
export type HubOpenRequest = z.infer<typeof HubOpenSchema>;

/** Folder names that work on every OS. */
export const APP_NAME_PATTERN = /^(?!\.)[^<>:"/\\|?*\u0000-\u001f]{1,80}(?<![. ])$/;

export const HubCreateSchema = z.strictObject({
  name: z.string().trim().regex(APP_NAME_PATTERN, "use letters, numbers, spaces, - or _"),
  parent: z.string().min(1),
  stack: z.enum(Object.keys(STACK_LABELS) as [StackId, ...StackId[]]),
  agent: z.enum(AGENT_IDS).optional(),
});
export type HubCreateRequest = z.infer<typeof HubCreateSchema>;

export interface HubOpenResponse {
  appRoot: string;
  name: string;
  /** The board, with its token. */
  board: string;
}
