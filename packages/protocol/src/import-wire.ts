/**
 * Editor ↔ server messages for importing pages of an existing app (`/api/import/*`) and for
 * showing them with the app's own styles (`/api/app-styles`).
 */
import type { AnyOp } from "@appshape/ir";
import type { AppProcessStatus, StackId } from "./code-wire";

export interface ImportRoute {
  /** Route pattern: `/`, `/blog/[slug]`. */
  path: string;
  file?: string;
  /** Needs a concrete URL (`/blog/hello`). */
  dynamic: boolean;
  /** Frame of this route, when already imported. */
  frameId?: string;
}

export interface ImportStatusResponse {
  app: "none" | "app" | "unsupported";
  reason?: string;
  stack?: StackId;
  tailwind?: 3 | 4;
  packageManager: string;
  routes: ImportRoute[];
  /** The app's dev server (started by AppShape). */
  process: AppProcessStatus;
  /** Import in progress. */
  progress?: { step: string; done: number; total: number };
  /** The capture browser is open. */
  browserOpen: boolean;
}

export interface ImportRequest {
  pages: Array<{ route: string; path?: string }>;
  /** A dev server that is already running; otherwise AppShape starts one. */
  devUrl?: string;
  /** Re-import pages that have no design changes. */
  replace?: boolean;
}

export interface ImportedPageSummary {
  route: string;
  frameId: string;
  name: string;
  nodes: number;
  /** Share of elements anchored to source (0–1). */
  anchored: number;
  /** Share of classes that became editable styles (0–1). */
  mapped: number;
  redacted: number;
  warnings: string[];
}

export interface ImportResponse {
  /** Apply as one command (undoable). */
  ops: AnyOp[];
  pages: ImportedPageSummary[];
  warnings: string[];
}

/** The icons the board can draw (`GET /api/icons/lucide`). */
export interface IconListResponse {
  icons: { name: string; tags: string[] }[];
}

/** The app's CSS for frames (empty strings when nothing was imported). */
export interface AppStylesResponse {
  /** For each frame's shadow root; file URLs are absolute API paths without the token. */
  shadow: string;
  /** For the editor document (`@property`, `@font-face`). */
  document: string;
  htmlClasses: string[];
  /** Node rules go in a cascade layer after the app's (Tailwind v4). */
  layered: boolean;
  /**
   * How the app's dark mode is switched: `media` (its `prefers-color-scheme` rules follow the
   * board's `--aps-scheme`) or `class` (`dark` on the frame, like on `<html>`).
   */
  darkMode?: "media" | "class";
  /** Changes when the styles change (re-import). */
  version: string;
}
