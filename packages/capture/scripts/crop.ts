import { readFile, writeFile } from "node:fs/promises";
import { launchBrowser } from "../src/index";
/** Puts two screenshots side by side, cropped to a band: `tsx scripts/crop.ts a.png b.png out.png y h`. */
const [a, b, out, y = "0", h = "1000"] = process.argv.slice(2);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 2580, height: Number(h) } });
const src = async (p: string) => `data:image/png;base64,${(await readFile(p!)).toString("base64")}`;
await page.setContent(`<body style="margin:0;display:flex;gap:20px;background:#f0f"><div style="width:1280px;height:${h}px;overflow:hidden"><img src="${await src(a!)}" style="display:block;margin-top:-${y}px"></div><div style="width:1280px;height:${h}px;overflow:hidden"><img src="${await src(b!)}" style="display:block;margin-top:-${y}px"></div></body>`);
await writeFile(out!, await page.screenshot());
await browser.close();
