import { resolveLocation, ProjectFiles } from "@appshape/store";

/** Loads and saves a project (rewrites its files in the current format): `tsx scripts/resave.ts <appRoot>`. */
const location = await resolveLocation(process.argv[2]!);
if (!location) throw new Error("no project");
const files = new ProjectFiles(location);
const { project } = await files.load();
console.log("rewrote", (await files.save(project)).length, "files");
