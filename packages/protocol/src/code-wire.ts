/**
 * Editor ↔ server messages for applying the design to code (`/api/code/*`). Plain types: the
 * server produces them with `@appshape/codegen`.
 */

export type StackId = "vite-react-router" | "next-app" | "next-pages" | "vite-tanstack";

export const STACK_LABELS: Record<StackId, string> = {
  "vite-react-router": "Vite + React Router",
  "next-app": "Next.js (App Router)",
  "next-pages": "Next.js (Pages Router)",
  "vite-tanstack": "Vite + TanStack Router",
};

export interface AppProcessStatus {
  state: "idle" | "installing" | "starting" | "running" | "failed" | "stopped";
  /** Last lines of output. */
  log: string[];
  /** The running app (dev server). */
  url?: string;
  step?: string;
}

export interface CodeStatusResponse {
  /** none = empty folder (an app will be created), app = supported app, unsupported = can't generate. */
  app: "none" | "app" | "unsupported";
  reason?: string;
  stack?: StackId;
  appRoot: string;
  applied: boolean;
  appliedAt?: string;
  /** Generated file per screen/component (frame id → path relative to the app root). */
  files: Record<string, string>;
  process: AppProcessStatus;
}

export interface PlanFileChange {
  path: string;
  summary: string;
  before?: string;
  /** Absent = the file is deleted. */
  after?: string;
  /** A binary file (image, font) copied from this path inside the data folder. */
  copyFrom?: string;
}

export interface PlanTask {
  kind: string;
  summary: string;
  file?: string;
  line?: number;
  code?: string;
}

export interface CodePlanResponse {
  planId: string;
  stack: StackId;
  scaffold: boolean;
  changes: PlanFileChange[];
  tasks: PlanTask[];
  warnings: string[];
  install: boolean;
}

export interface CodeApplyRequest {
  planId: string;
  stack?: StackId;
}

export interface CodeApplyResponse {
  written: string[];
  deleted: string[];
  changesetId?: string;
  specFile?: string;
  taskCount: number;
  /** Screens whose code changed or that have tasks (what to verify). */
  frameIds: string[];
}
