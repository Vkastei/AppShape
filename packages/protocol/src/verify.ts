import { IdSchema } from "@appshape/ir";
import { z } from "zod";

export const CheckStatusSchema = z.enum(["pass", "fail", "skipped"]);

/** Result of `verify_changeset`: the running app recaptured and compared with the design. */
export const VerifyReportSchema = z.strictObject({
  changesetId: IdSchema,
  status: z.enum(["verified", "needs_fix"]),
  checkedAt: z.iso.datetime(),
  results: z.array(
    z.strictObject({
      changeId: z.string(),
      status: CheckStatusSchema,
      checks: z.array(
        z.strictObject({
          text: z.string(),
          status: CheckStatusSchema,
          /** What was found instead, e.g. "found classes: rounded-md shadow-sm". */
          detail: z.string().optional(),
        }),
      ),
    }),
  ),
  /** Perceptual comparison of design render vs. real screenshot, per frame and viewport. */
  visual: z.array(
    z.strictObject({
      frameId: IdSchema,
      viewport: z.string(),
      mismatchRatio: z.number().min(0).max(1),
      diffImage: z.string().optional(),
    }),
  ),
});
export type VerifyReport = z.infer<typeof VerifyReportSchema>;

/** One screen at one viewport, checked against the design (editor and CLI details). */
export interface VerifyFrameResult {
  frameId: string;
  viewport: string;
  url: string;
  /** Set when the page could not be checked. */
  error?: string;
  /** Design elements checked. */
  elements: number;
  /** Elements that differ (or are missing), with what differs. */
  failing: { key: string; label: string; problems: string[] }[];
  /** Texts in the app that the design doesn't have. */
  extra: string[];
  mismatchRatio?: number;
  /** Screenshots and the diff image, relative to the data folder. */
  images?: { design: string; app: string; diff: string };
}

/** `POST /api/verify`: a changeset (with its report) or screens (after a direct apply). */
export interface VerifyRequest {
  changesetId?: string;
  frameIds?: string[];
}

export interface VerifyResponse {
  report?: VerifyReport;
  frames: VerifyFrameResult[];
  /** Imported screens whose code state now matches the design. */
  rebaselined: string[];
}
