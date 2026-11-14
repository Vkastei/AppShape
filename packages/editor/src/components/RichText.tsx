import { resolveToken, type Style, type StyleValue, type TextSpan, type Tokens } from "@appshape/ir";
import { Bold, Italic, Link as LinkIcon, Palette, Underline, Unlink } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Inline editing of a text with formatting for parts of it: bold, italic, underline, a link and a
 * color, from a small toolbar above the text (and Ctrl+B / I / U). The text becomes `spans` in the
 * design (`<strong>`-like parts are spans with a font weight, links spans with `href`).
 */

interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  href?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isBold = (w: StyleValue | undefined, tokens: Tokens) => {
  if (w === undefined) return undefined;
  const n = Number(typeof w === "string" && w.startsWith("$") ? resolveToken(tokens, w) : w);
  return Number.isFinite(n) ? n >= 600 : undefined;
};

function marksOf(span: TextSpan, tokens: Tokens): Marks {
  const s = span.style ?? {};
  return {
    ...(isBold(s.fontWeight, tokens) !== undefined && { bold: isBold(s.fontWeight, tokens) }),
    ...(s.fontStyle && { italic: s.fontStyle === "italic" }),
    ...(s.textDecoration && { underline: s.textDecoration === "underline" }),
    ...(typeof s.color === "string" && { color: s.color }),
    ...(span.href && { href: span.href }),
  };
}

/** The editor's starting HTML: each span as nested formatting elements. */
export function spansToHtml(text: string, spans: TextSpan[] | undefined, tokens: Tokens): string {
  const parts = spans?.length ? spans : [{ text }];
  return parts
    .map((span) => {
      const m = marksOf(span, tokens);
      let html = esc(span.text).replace(/\n/g, "<br>");
      if (m.color) html = `<span data-color="${esc(m.color)}" style="color: ${esc(String(resolveToken(tokens, m.color) ?? m.color))}">${html}</span>`;
      if (m.underline !== undefined) html = m.underline ? `<u>${html}</u>` : `<span style="text-decoration: none">${html}</span>`;
      if (m.italic !== undefined) html = m.italic ? `<i>${html}</i>` : `<span style="font-style: normal">${html}</span>`;
      if (m.bold !== undefined) html = m.bold ? `<b>${html}</b>` : `<span style="font-weight: normal">${html}</span>`;
      if (m.href) html = `<a href="${esc(m.href)}">${html}</a>`;
      return html;
    })
    .join("");
}

/** The edited content as text and spans (no spans when nothing is formatted). */
export function domToSpans(root: HTMLElement, tokens: Tokens): { text: string; spans: TextSpan[] | undefined } {
  const runs: { text: string; marks: Marks }[] = [];
  const marksAt = (node: Node): Marks => {
    const m: Marks = {};
    const chain: HTMLElement[] = [];
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) chain.unshift(el);
    for (const el of chain) {
      const tag = el.tagName;
      if (tag === "B" || tag === "STRONG") m.bold = true;
      if (tag === "I" || tag === "EM") m.italic = true;
      if (tag === "U") m.underline = true;
      if (tag === "A" && el.getAttribute("href")) m.href = el.getAttribute("href")!;
      if (el.hasAttribute("data-color")) m.color = el.getAttribute("data-color") || undefined;
      const fw = el.style.fontWeight;
      if (fw) m.bold = fw === "bold" || fw === "bolder" || Number(fw) >= 600;
      if (el.style.fontStyle) m.italic = el.style.fontStyle === "italic";
      if (el.style.textDecorationLine || el.style.textDecoration) m.underline = (el.style.textDecorationLine || el.style.textDecoration).includes("underline");
    }
    return m;
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ text: node.textContent, marks: marksAt(node) });
      return;
    }
    if ((node as Element).tagName === "BR") {
      runs.push({ text: "\n", marks: marksAt(node) });
      return;
    }
    // block elements a browser may add (a <div> per line) start a new line
    const block = node !== root && /^(DIV|P)$/.test((node as Element).tagName);
    if (block && runs.length > 0 && !runs.at(-1)!.text.endsWith("\n")) runs.push({ text: "\n", marks: {} });
    node.childNodes.forEach(walk);
  };
  walk(root);
  // a trailing line break the browser keeps for the caret isn't content
  while (runs.length && runs.at(-1)!.text === "\n") runs.pop();

  const weight = (bold: boolean): StyleValue => {
    const name = bold ? "bold" : "normal";
    return tokens.groups.fontWeight?.[name] !== undefined ? `$fontWeight.${name}` : bold ? 700 : 400;
  };
  const spans: TextSpan[] = [];
  for (const run of runs) {
    const style: Partial<Style> = {};
    if (run.marks.bold !== undefined) style.fontWeight = weight(run.marks.bold);
    if (run.marks.italic !== undefined) style.fontStyle = run.marks.italic ? "italic" : "normal";
    if (run.marks.underline !== undefined) style.textDecoration = run.marks.underline ? "underline" : "none";
    if (run.marks.color) style.color = run.marks.color;
    const span: TextSpan = { text: run.text, ...(Object.keys(style).length > 0 && { style: style as Style }), ...(run.marks.href && { href: run.marks.href }) };
    const last = spans.at(-1);
    if (last && JSON.stringify({ ...last, text: "" }) === JSON.stringify({ ...span, text: "" })) last.text += span.text;
    else spans.push(span);
  }
  const text = spans.map((s) => s.text).join("");
  const formatted = spans.some((s) => s.style || s.href);
  return { text, spans: formatted ? spans : undefined };
}

/** Wraps the selection (inside `root`) in an element; nested ones of the same kind are removed. */
function wrapSelection(root: HTMLElement, make: () => HTMLElement, attribute: string): void {
  const selection = getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return;
  const wrapper = make();
  wrapper.appendChild(range.extractContents());
  for (const inner of [...wrapper.querySelectorAll(`[${attribute}]`)]) inner.replaceWith(...inner.childNodes);
  range.insertNode(wrapper);
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(wrapper);
  selection.addRange(next);
}

export function RichTextEditor({
  html,
  font,
  style,
  tokens,
  onCommit,
  onDone,
}: {
  html: string;
  font: React.CSSProperties;
  style: React.CSSProperties;
  tokens: Tokens;
  onCommit: (result: { text: string; spans: TextSpan[] | undefined }) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const done = useRef(false);
  const saved = useRef<Range | undefined>(undefined);
  const [panel, setPanel] = useState<"link" | "color" | undefined>();
  const [url, setUrl] = useState("");

  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = html;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    document.execCommand("styleWithCSS", false, "false");
    // `html` is the starting content only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const result = domToSpans(ref.current!, tokens);
    onDone();
    if (!cancelled.current) onCommit(result);
  };
  const restore = () => {
    ref.current?.focus();
    if (saved.current) {
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(saved.current);
    }
  };
  const command = (name: string, value?: string) => {
    restore();
    document.execCommand(name, false, value);
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // the text keeps the focus and its selection
  const remember = () => {
    const selection = getSelection();
    if (selection?.rangeCount && ref.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) saved.current = selection.getRangeAt(0).cloneRange();
  };
  const colors = Object.keys(tokens.groups.color ?? {});
  const linkAt = () => {
    const node = getSelection()?.anchorNode;
    return (node instanceof Element ? node : node?.parentElement)?.closest("a");
  };

  const button = "grid h-7 w-7 place-items-center rounded text-ink hover:bg-zinc-100";
  return (
    <div
      ref={wrapper}
      className="pointer-events-auto absolute"
      style={{ left: style.left, top: style.top, width: style.width, height: style.height }}
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget as Node | null)) finish();
      }}
      data-no-drag=""
    >
      <div className="absolute bottom-full left-0 mb-1.5 flex items-center gap-0.5 rounded-lg border border-ink bg-white p-0.5 shadow-offset-sm" role="toolbar" aria-label="Text formatting">
        <button type="button" aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={keep} onClick={() => command("bold")} className={button}>
          <Bold size={14} />
        </button>
        <button type="button" aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={keep} onClick={() => command("italic")} className={button}>
          <Italic size={14} />
        </button>
        <button type="button" aria-label="Underline" title="Underline (Ctrl+U)" onMouseDown={keep} onClick={() => command("underline")} className={button}>
          <Underline size={14} />
        </button>
        <button
          type="button"
          aria-label="Link"
          title="Link the selected words"
          onMouseDown={(e) => {
            keep(e);
            remember();
          }}
          onClick={() => {
            setUrl(linkAt()?.getAttribute("href") ?? "");
            setPanel(panel === "link" ? undefined : "link");
          }}
          className={button}
        >
          <LinkIcon size={14} />
        </button>
        <button type="button" aria-label="Remove link" title="Remove link" onMouseDown={keep} onClick={() => command("unlink")} className={button}>
          <Unlink size={14} />
        </button>
        <button
          type="button"
          aria-label="Text color"
          title="Color of the selected words"
          onMouseDown={(e) => {
            keep(e);
            remember();
          }}
          onClick={() => setPanel(panel === "color" ? undefined : "color")}
          className={button}
        >
          <Palette size={14} />
        </button>
        {panel === "link" && (
          <input
            aria-label="Link address"
            autoFocus
            value={url}
            placeholder="https://… or /pricing"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                setPanel(undefined);
                if (url.trim()) command("createLink", url.trim());
                else command("unlink");
              }
              if (e.key === "Escape") {
                setPanel(undefined);
                restore();
              }
            }}
            className="ml-1 w-44 rounded border border-zinc-300 px-1.5 py-1 text-xs outline-none focus:border-accent-500"
          />
        )}
        {panel === "color" && (
          <div className="absolute left-0 top-full mt-1 flex max-h-48 w-64 flex-wrap gap-0.5 overflow-auto rounded-lg border border-ink bg-white p-1.5 shadow-offset-sm" role="listbox" aria-label="Text colors">
            <button
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={keep}
              onClick={() => {
                restore();
                wrapSelection(
                  ref.current!,
                  () => {
                    const el = document.createElement("span");
                    el.setAttribute("data-color", "");
                    return el;
                  },
                  "data-color",
                );
                setPanel(undefined);
              }}
              className="mb-1 w-full rounded px-1 text-left text-[11px] text-zinc-600 hover:bg-zinc-100"
            >
              The text's own color
            </button>
            {colors.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={name}
                title={name}
                onMouseDown={keep}
                onClick={() => {
                  restore();
                  const ref_ = `$color.${name}`;
                  wrapSelection(
                    ref.current!,
                    () => {
                      const el = document.createElement("span");
                      el.setAttribute("data-color", ref_);
                      el.style.color = String(resolveToken(tokens, ref_) ?? "");
                      return el;
                    },
                    "data-color",
                  );
                  setPanel(undefined);
                }}
                className="h-4 w-4 rounded-sm border border-black/10"
                style={{ background: String(resolveToken(tokens, `$color.${name}`) ?? "") }}
              />
            ))}
          </div>
        )}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Edit text"
        data-testid="text-editor"
        spellCheck={false}
        className="h-full w-full overflow-hidden whitespace-pre-wrap break-words outline-2 outline-accent-600 [&_a]:underline"
        style={{ ...font, minWidth: 40, outlineStyle: "solid" }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            cancelled.current = true;
            ref.current?.blur();
            finish();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) document.execCommand("insertLineBreak");
            else finish();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
      />
    </div>
  );
}
