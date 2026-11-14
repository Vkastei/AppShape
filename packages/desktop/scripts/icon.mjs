// Copies AppShape's icon from brand/ (the repository's artwork) into build/: icon.png (1024 px,
// electron-builder makes the installer icons from it) and icon.ico (Windows, several sizes).
// Run after changing the artwork: node scripts/icon.mjs
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(desktop, "..", "..", "brand");
copyFileSync(join(brand, "appshape-icon-1024.png"), join(desktop, "build", "icon.png"));
copyFileSync(join(brand, "appshape-icon.ico"), join(desktop, "build", "icon.ico"));
console.log("copied the icon into build/");
