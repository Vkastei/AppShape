import { appFiles, detectApp } from "@appshape/codegen";
import { discoverRoutes } from "../src/routes";

/** Prints the routes AppShape finds in an app: `tsx scripts/routes.ts <appRoot>`. */
const root = process.argv[2]!;
const detection = await detectApp(appFiles(root));
if (detection.kind !== "app") throw new Error(JSON.stringify(detection));
console.log(await discoverRoutes(root, detection.layout));
