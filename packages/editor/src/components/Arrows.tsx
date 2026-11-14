import type { BoardItem, Frame } from "@appshape/ir";
import { arrowEnds, newOpId } from "../lib/board";
import type { Point, Sizes } from "../lib/geometry";
import { dispatch, useEditor } from "../store";

interface ArrowsProps {
  items: ReadonlyMap<string, BoardItem>;
  frames: ReadonlyMap<string, Frame>;
  sizes: Sizes;
  zoom: number;
  selection: readonly string[];
  /** Line being drawn with the arrow tool. */
  draft: { from: Point; to: Point } | undefined;
  /** Navigation flows derived from links/buttons with a target screen (placement `targetId`). */
  flows: { id: string; from: Point; to: Point; targetId: string }[];
}

/** Flows between screens: teal; board arrows: ink; selected: purple. */
const FLOW = "#0d9488";

const COLOR = "#57516b";
const SELECTED = "#7a2dbf";

export function Arrows({ items, frames, sizes, zoom, selection, draft, flows }: ArrowsProps) {
  const editingId = useEditor((s) => s.editingId);
  const arrows = [...items.values()].filter((i): i is Extract<BoardItem, { type: "arrow" }> => i.type === "arrow");
  const stroke = 2 / zoom;
  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
        <defs>
          {[COLOR, SELECTED, FLOW].map((color) => (
            <marker key={color} id={`aps-arrowhead-${color.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
        </defs>
        {arrows.map((arrow) => {
          const ends = arrowEnds(arrow, items, frames, sizes);
          if (!ends) return null;
          const color = selection.includes(arrow.id) ? SELECTED : COLOR;
          const d = `M ${ends.from.x} ${ends.from.y} L ${ends.to.x} ${ends.to.y}`;
          return (
            <g key={arrow.id}>
              <path d={d} stroke="transparent" strokeWidth={14 / zoom} data-item-id={arrow.id} style={{ pointerEvents: "stroke", cursor: "pointer" }} />
              <path d={d} stroke={color} strokeWidth={stroke} fill="none" markerEnd={`url(#aps-arrowhead-${color.slice(1)})`} />
            </g>
          );
        })}
        {flows.map((flow) => {
          const d = `M ${flow.from.x} ${flow.from.y} L ${flow.to.x} ${flow.to.y}`;
          return (
            <g key={flow.id}>
              {/* click: go to the target screen */}
              <path d={d} stroke="transparent" strokeWidth={14 / zoom} fill="none" data-flow-target={flow.targetId} style={{ pointerEvents: "stroke", cursor: "pointer" }}>
                <title>Go to the linked screen</title>
              </path>
              <path
                data-testid="flow"
                d={d}
                stroke={FLOW}
                strokeOpacity={0.7}
                strokeWidth={stroke}
                strokeDasharray={`${8 / zoom} ${5 / zoom}`}
                fill="none"
                markerEnd={`url(#aps-arrowhead-${FLOW.slice(1)})`}
              />
            </g>
          );
        })}
        {draft && (
          <path
            d={`M ${draft.from.x} ${draft.from.y} L ${draft.to.x} ${draft.to.y}`}
            stroke={SELECTED}
            strokeWidth={stroke}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            markerEnd={`url(#aps-arrowhead-${SELECTED.slice(1)})`}
          />
        )}
      </svg>
      {arrows.map((arrow) => {
        if (!arrow.label && editingId !== arrow.id) return null;
        const ends = arrowEnds(arrow, items, frames, sizes);
        if (!ends) return null;
        const mid = { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 };
        return (
          <div
            key={`label-${arrow.id}`}
            data-item-id={arrow.id}
            className="absolute whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-xs text-zinc-700 shadow-sm ring-1 ring-zinc-200"
            style={{ left: mid.x, top: mid.y, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
          >
            {editingId === arrow.id ? (
              <input
                autoFocus
                data-no-drag=""
                defaultValue={arrow.label ?? ""}
                className="w-40 outline-none"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  useEditor.setState({ editingId: undefined });
                  const label = e.target.value.trim();
                  if (label !== (arrow.label ?? "")) {
                    dispatch([{ id: newOpId(), op: "updateItem", itemId: arrow.id, patch: { label: label || null } }]);
                  }
                }}
              />
            ) : (
              arrow.label
            )}
          </div>
        );
      })}
    </>
  );
}
