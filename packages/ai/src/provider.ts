import type { JsxEdit, RawReview } from "@appshape/codegen";
import type { Usage } from "./models";

/**
 * A model that designs: it gets the rules, the project's design system, the request and the
 * pictures, and answers with the screen as design JSX. One implementation talks to the Claude API;
 * tests use a fake. Other providers can follow without changing the rest.
 */

export interface DesignCall {
  /** Who the model is and how to answer: the same for every request. */
  system: string;
  /** The project's components and tokens: the same for every request on the project. */
  context: string;
  /** The screen as design JSX (the same on *Try again*: cached with the pictures). */
  screen: string;
  /** The request: the job, the message, the drawing in words. */
  details: string;
  /** The screen as it is, and with the drawing on top (PNG). */
  images: DesignImages;
  /** How many different designs to answer with (absent: one). */
  variants?: number;
  /** `review`: answer with findings about the screen, not a design. */
  mode?: "review";
  /** A second round: the answer before and what AppShape couldn't use in it. */
  repair?: { previous: DesignAnswer; problems: string[] };
  signal?: AbortSignal;
}

export interface DesignImages {
  clean?: Uint8Array;
  marked?: Uint8Array;
  /** On a long screen, the part the pictures show (design px from the top), else the whole screen. */
  part?: { top: number; bottom: number; height: number };
}

export interface DesignAnswer {
  /** The changes by data-id (the usual answer); applied to the screen's JSX that was sent. */
  edits?: JsxEdit[];
  /** The whole screen instead (the fake provider and older answers). */
  jsx?: string;
  /** Several designs (when variants were asked for): each with its idea; `edits`/`jsx` above are then unused. */
  variants?: DesignVariant[];
  /** A review (mode `review`): findings as the model wrote them. */
  review?: RawReview;
  /** The changes in the model's words (AppShape works out its own list from the JSX). */
  summary: string[];
  /** What the model was unsure about. */
  questions: string[];
  usage: Usage;
  model: string;
  /** Provider-specific record of the exchange (for a repair round). */
  transcript?: unknown;
}

/** One of several designs in an answer. */
export interface DesignVariant {
  /** The idea in a few words ("Two columns with the image left"). */
  idea: string;
  edits?: JsxEdit[];
  jsx?: string;
  summary: string[];
}

export interface DesignProvider {
  readonly model: string;
  design(call: DesignCall): Promise<DesignAnswer>;
}

/** Why a design could not be made, in words for the person (and a kind for the board). */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "key" | "rate" | "network" | "refusal" | "cut-off" | "answer" | "cancelled" | "api",
  ) {
    super(message);
    this.name = "AiError";
  }
}
