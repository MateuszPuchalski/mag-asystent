import { copyFileSync } from "node:fs";
for (const file of ["wms.js", "wms.css"]) {
  copyFileSync(
    new URL(`../server/src/web/${file}`, import.meta.url),
    new URL(`../server/dist/web/${file}`, import.meta.url),
  );
}
