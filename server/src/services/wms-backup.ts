import { backup, DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { integrity } from "./wms-analytics.js";

export async function verifiedBackup(source: string, target: string) {
  const from = path.resolve(source),
    to = path.resolve(target);
  if (from === to) throw new Error("Źródło i cel kopii muszą być różne");
  if (!fs.existsSync(from)) throw new Error("Baza źródłowa nie istnieje");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Rezerwacja nazwy nie nadpisuje istniejącej kopii ani bazy magazynu.
  fs.closeSync(fs.openSync(to, "wx"));
  const live = new DatabaseSync(from, { readOnly: true });
  try {
    live.exec("PRAGMA busy_timeout=5000");
    await backup(live, to);
    const copy = new DatabaseSync(to, { readOnly: true });
    let rows = 0;
    try {
      const check = copy.prepare("PRAGMA quick_check").all();
      if (check.length !== 1 || Object.values(check[0])[0] !== "ok")
        throw new Error("Kopia nie przeszła kontroli SQLite");
      if (copy.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Kopia ma uszkodzone powiązania danych");
      if (
        copy.prepare("SELECT 1 FROM sqlite_master WHERE name='wms_stock'").get()
      ) {
        const result = integrity(copy);
        if (!result.ok)
          throw new Error("Kopia ma rozbieżność stanów i rezerwacji WMS");
        rows = Number(
          copy.prepare("SELECT count(*) AS n FROM wms_order").get()?.n ?? 0,
        );
      }
    } finally {
      copy.close();
    }
    const digest = createHash("sha256");
    for await (const chunk of fs.createReadStream(to)) digest.update(chunk);
    const report = {
      file: to,
      at: new Date().toISOString(),
      bytes: fs.statSync(to).size,
      sha256: digest.digest("hex"),
      orders: rows,
      verified: true,
    };
    fs.writeFileSync(`${to}.json`, JSON.stringify(report, null, 2), {
      flag: "wx",
    });
    return report;
  } catch (e) {
    // Nie usuwamy niepełnej kopii: nazwa i błąd pozwalają ją zbadać.
    throw new Error(
      `Kopia NIEPOTWIERDZONA (${to}): ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    live.close();
  }
}
