import { CASES, type EvalCase } from "./cases";
import type { Score } from "./score";

/** A run's results: the table of each setting, and the report page with the pictures. */

export interface Result {
  case: string;
  setting: string;
  model: string;
  effort: string;
  ok: boolean;
  error?: string;
  seconds: number;
  costUsd: number;
  expectedUsd: number;
  rounds: number;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  summary: string[];
  questions: string[];
  score?: Score;
  /** With --again: the follow-up request (Try again), included in `costUsd`. */
  again?: { costUsd: number; rounds: number; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }; error?: string };
  /** With variants: each one's idea (pictures after.png, after-2.png, after-3.png). */
  ideas?: string[];
}

export function summarize(rs: Result[], settings: string[]): string {
  const rows = settings.map((name) => {
    const mine = rs.filter((r) => r.setting === name);
    const ok = mine.filter((r) => r.ok);
    const checks = ok.reduce((n, r) => n + r.score!.passed, 0);
    const all = mine.reduce((n, r) => n + (r.score?.checks.length ?? CASES.find((c) => c.id === r.case)!.checks.length), 0);
    const mean = (f: (r: Result) => number, list = mine) => (list.length ? list.reduce((n, r) => n + f(r), 0) / list.length : 0);
    return `| ${name} | ${mine.length} | ${(mean((r) => r.score?.score ?? 0) * 100).toFixed(0)} | ${checks}/${all} | ${ok.reduce((n, r) => n + r.score!.collateral.length, 0)} | ${ok.reduce((n, r) => n + r.score!.warnings.length, 0)} | ${mine.length - ok.length} | ${mine.filter((r) => r.rounds > 1).length} | $${mean((r) => r.costUsd).toFixed(3)} | ${mean((r) => r.seconds).toFixed(0)}s |`;
  });
  return ["| Setting | Cases | Score | Checks | Outside scope | Warnings | Failed | Repaired | $/request | Time |", "|---|---|---|---|---|---|---|---|---|---|", ...rows].join("\n");
}

export function report(rs: Result[], run: { cases: EvalCase[]; settings: string[]; stamp: string; dry: boolean }): string {
  const { settings, stamp, dry } = run;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cell = (r: Result | undefined) => {
    if (!r) return "<td class=muted>not run</td>";
    if (!r.ok) return `<td><p class=bad>Failed</p><p>${esc(r.error ?? "")}</p><p class=muted>$${r.costUsd.toFixed(3)} · ${r.seconds}s</p></td>`;
    const s = r.score!;
    const pictures = (r.ideas ?? [""]).map((idea, i) => {
      const src = `${r.setting}/${r.case}/after${i ? `-${i + 1}` : ""}.png`;
      return `<a href="${src}"><img src="${src}" loading=lazy></a>${idea ? `<p class=muted>${i + 1}. ${esc(idea)}</p>` : ""}`;
    });
    return `<td>${pictures.join("")}
<p><b>${Math.round(s.score * 100)}</b> · $${r.costUsd.toFixed(3)} · ${r.seconds}s${r.rounds > 1 ? " · repaired" : ""}</p>
<ul>${s.checks.map((k) => `<li class=${k.pass ? "ok" : "bad"}>${k.pass ? "✓" : "✗"} ${esc(k.name)}</li>`).join("")}${s.collateral.map((x) => `<li class=bad>outside: ${esc(x)}</li>`).join("")}${s.warnings.map((x) => `<li class=warn>${esc(x)}</li>`).join("")}</ul>
<details><summary>Summary</summary><ul>${r.summary.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${r.questions.length ? `<p>Questions:</p><ul>${r.questions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</details></td>`;
  };
  const rows = run.cases.map((c) => `<tr><th><p>${esc(c.title)}</p><p class=muted>${c.id} · ${c.viewport}</p><p>“${esc(c.message || "(no message)")}”</p><a href="cases/${c.id}/marked.png"><img src="cases/${c.id}/marked.png" loading=lazy></a></th>${settings.map((s) => cell(rs.find((r) => r.case === c.id && r.setting === s))).join("")}</tr>`);
  const md = summarize(rs, settings).split("\n").filter((l) => !l.startsWith("|---")).map((l, i) => `<tr>${l.split("|").slice(1, -1).map((c) => (i === 0 ? `<th>${c.trim()}</th>` : `<td>${esc(c.trim())}</td>`)).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Draw eval ${stamp}</title><style>
:root{--bg:#fff;--fg:#1f1b2e;--muted:#6b6880;--line:#e4e2ec;--ok:#1a7f4b;--bad:#c0262d;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#16141f;--fg:#ecebf3;--muted:#a3a0b5;--line:#2e2b3d;--ok:#5bd69a;--bad:#ff7b80;--warn:#e8b54d}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:8px;vertical-align:top;text-align:left;font-weight:normal}
.grid th{width:260px}.grid td{width:300px}img{width:100%;max-height:420px;object-fit:cover;object-position:top;border:1px solid var(--line)}ul{margin:4px 0;padding-left:18px}p{margin:4px 0}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}.wrap{overflow-x:auto}
</style></head><body><h1>Draw &amp; describe evaluation</h1><p class=muted>${stamp}${dry ? " · dry run (fake model)" : ""}</p>
<div class=wrap><table>${md}</table></div><h2>Cases</h2><div class=wrap><table class=grid><tr><th>Request</th>${settings.map((s) => `<th>${s}</th>`).join("")}</tr>${rows.join("")}</table></div></body></html>`;
}
