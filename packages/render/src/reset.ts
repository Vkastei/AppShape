/**
 * Base styles inside a frame, similar to Tailwind's preflight so captured pages look right.
 * Every selector is wrapped in `:where()` (zero specificity), so node rules always win. The reset
 * lives in its own cascade layer, declared before an imported app's CSS, so the app's layered
 * Tailwind styles win over it too.
 */
export const FRAME_CLASS = "aps-frame";
export const CONTAINER_NAME = "aps-frame";
export const RESET_LAYER = "aps-reset";
/** Layer for node rules when an imported app's CSS is layered (see `RenderOptions.layer`). */
export const NODE_LAYER = "aps-nodes";

export const RESET_CSS = `@layer ${RESET_LAYER} {
:where(.${FRAME_CLASS}) {
  container: ${CONTAINER_NAME} / inline-size;
  /* The frame is the page's viewport: fixed elements (a sticky header, a bottom bar) belong to it, not to the
     board around it. A transform makes it their containing block; container queries alone don't. */
  transform: translate(0);
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  line-height: 1.5;
  color: #111827;
  background: #fff;
  -webkit-font-smoothing: antialiased;
  text-align: left;
}
:where(.${FRAME_CLASS}) :where(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
:where(.${FRAME_CLASS}) :where(h1, h2, h3, h4, h5, h6) { font-size: inherit; font-weight: inherit; }
:where(.${FRAME_CLASS}) :where(ol, ul, menu) { list-style: none; }
:where(.${FRAME_CLASS}) :where(a) { color: inherit; text-decoration: inherit; }
:where(.${FRAME_CLASS}) :where(img, svg, video, canvas) { display: block; vertical-align: middle; }
:where(.${FRAME_CLASS}) :where(img, video) { max-width: 100%; height: auto; }
/* Frames are still pictures: animations show their end state, transitions don't run. */
:where(.${FRAME_CLASS}) :where(*, *::before, *::after) { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; transition-delay: 0s !important; }
:where(.${FRAME_CLASS}) :where(button, input, select, textarea) { font: inherit; color: inherit; background: transparent; }
:where(.${FRAME_CLASS}) :where(textarea) { resize: vertical; }
:where(.${FRAME_CLASS}) :where(input, textarea)::placeholder { color: #9ca3af; opacity: 1; }
:where(.${FRAME_CLASS}) :where(summary) { list-style: none; }
:where(.${FRAME_CLASS}) :where([data-aps-icon]) {
  display: inline-block; width: 1em; height: 1em; border: 1.5px solid currentColor; border-radius: 0.25em; opacity: 0.6;
}
:where(.${FRAME_CLASS}) :where([data-aps-icon-src]) {
  display: block; border: 0; border-radius: 0; opacity: 1;
  background-color: currentColor; mask: var(--aps-icon) center / contain no-repeat; -webkit-mask: var(--aps-icon) center / contain no-repeat;
}
:where(.${FRAME_CLASS}) :where([data-aps-placeholder]) {
  display: flex; align-items: center; justify-content: center; min-height: 2.5rem; padding: 0.75rem;
  border: 1.5px dashed #a5b4fc; border-radius: 0.5rem; background: #eef2ff; color: #4338ca;
  font: 500 0.75rem/1.2 ui-sans-serif, system-ui, sans-serif;
}
:where(.${FRAME_CLASS}) :where([data-aps-field]) { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.875rem; line-height: 1.25rem; font-weight: 500; }
}`.trim();
