import { copyFileSync } from "node:fs";
for (const file of [
  "wms.js",
  "wms-photos.js",
  "wms-carts.js",
  "wms-stock-work.js",
  "wms-inbound.js",
  "wms-handoff.js",
  "wms-packing.js",
  "wms.css",
  "biuro-theme.js",
  "biuro-theme.css",
  "wertis-logo.png",
]) {
  copyFileSync(
    new URL(`../server/src/web/${file}`, import.meta.url),
    new URL(`../server/dist/web/${file}`, import.meta.url),
  );
}
