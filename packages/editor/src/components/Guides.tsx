import type { GuideLine, Measure } from "../lib/snap";

const LINE = "#8e44d6";

/**
 * Snapping guides: alignment lines (purple) and equal spacing or size measures (ink pills). Works
 * in board units inside the zoomed layer (`unit` = 1 / zoom: one screen pixel) or in screen pixels
 * (`unit` = 1, `offset` = the overlay's corner).
 */
export function Guides({ lines, measures, unit, offset = { x: 0, y: 0 } }: { lines: GuideLine[]; measures: Measure[]; unit: number; offset?: { x: number; y: number } }) {
  if (lines.length === 0 && measures.length === 0) return null;
  const px = (n: number) => n * unit;
  return (
    <div className="pointer-events-none absolute left-0 top-0" data-testid="snap-guides">
      {lines.map((l, i) => (
        <div
          key={`l${i}`}
          data-guide={l.axis}
          className="absolute"
          style={
            l.axis === "x"
              ? { left: l.at - offset.x - px(0.5), top: l.from - offset.y, width: px(1), height: l.to - l.from, background: LINE }
              : { left: l.from - offset.x, top: l.at - offset.y - px(0.5), width: l.to - l.from, height: px(1), background: LINE }
          }
        />
      ))}
      {measures.map((m, i) => {
        const along = m.axis === "x";
        const mid = (m.from + m.to) / 2;
        return (
          <div key={`m${i}`}>
            <div
              className="absolute"
              style={
                along
                  ? { left: m.from - offset.x, top: m.at - offset.y - px(0.5), width: m.to - m.from, height: px(1), background: LINE }
                  : { left: m.at - offset.x - px(0.5), top: m.from - offset.y, width: px(1), height: m.to - m.from, background: LINE }
              }
            />
            <span
              className="absolute whitespace-nowrap rounded-full bg-ink font-semibold leading-none text-white"
              style={{
                left: (along ? mid : m.at) - offset.x,
                top: (along ? m.at : mid) - offset.y,
                fontSize: px(10),
                padding: `${px(2)}px ${px(5)}px`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {m.kind === "size" ? `= ${m.value}` : m.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
