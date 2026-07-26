import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  przeslotowanie,
  reslotCsv,
  wczytajZMssql,
  DOMYSLNE,
  type Kartoteka,
  type Pobrania,
} from "./services/reslot.js";

/* ── Raport przeslotowania — uruchamiany 1–2× w roku, przed sezonem ─────────
   Osobny proces, nie zadanie w API: ma się wykonać i skończyć. Czyta bazę
   Subiekta WYŁĄCZNIE do odczytu i nie zapisuje do niej niczego.

       source wertis.env && npm run reslot
       npm run reslot -- --demo      # bez MSSQL, na zaseedowanej kartotece

   Tryb `--demo` nie da list eksmisji ani awansów, bo seed nie zawiera żadnego
   dokumentu WZ. Odpowiada za to na inne pytanie, na które warto znać odpowiedź
   PRZED sezonem: jak kompletne są reguły stref złotych.                      */

const demo = process.argv.includes("--demo");

async function zSeedu(): Promise<{ kartoteki: Kartoteka[]; pobrania: Pobrania[] }> {
  const { db } = await import("./db/db.js");
  const rows = db()
    .prepare(
      `SELECT t.tw_id, t.symbol, t.nazwa, t.lokalizacja,
              COALESCE((SELECT stan FROM sgt_stan s
                         WHERE s.tw_id = t.tw_id AND s.mag_id = ?), 0) AS stan
         FROM sgt_towar t`
    )
    .all(config.magId.MAG) as Array<{
    tw_id: number;
    symbol: string;
    nazwa: string;
    lokalizacja: string | null;
    stan: number;
  }>;
  return {
    kartoteki: rows.map((r) => ({
      twId: r.tw_id,
      symbol: r.symbol,
      nazwa: r.nazwa,
      lokalizacja: r.lokalizacja,
      stan: r.stan,
      ostatniZakup: null,
    })),
    pobrania: [], // seed nie ma dokumentów WZ
  };
}

const { kartoteki, pobrania } = demo ? await zSeedu() : await wczytajZMssql();
const pelny = przeslotowanie(kartoteki, pobrania, { ...DOMYSLNE, teraz: new Date() });

/* BEZPIECZNIK. Bez historii pobrań KAŻDY indeks ma zero pobrań, więc listy
   1–3 wychodzą kompletne i wyglądają na zlecenie robocze — a mówią tylko tyle,
   że zabrakło danych. Na tej kartotece to 1375 „eksmisji" i 3027 „likwidacji",
   czyli polecenie opróżnienia całej strefy złotej.

   Dotyczy nie tylko demo: na produkcji ten sam stan daje zły `dok_Typ`, zły
   zakres dat albo pusty magazyn WZ. Raport, który w takiej sytuacji milczy,
   jest wart więcej niż raport, który pewnym głosem podaje bzdurę.            */
const brakHistorii = pobrania.length === 0;
const raport = brakHistorii
  ? { ...pelny, wiersze: pelny.wiersze.filter((w) => w.lista === "brak_reguly") }
  : pelny;

const licz = (l: string) => raport.wiersze.filter((w) => w.lista === l).length;
console.log(
  `[reslot] kartotek ${kartoteki.length} · z adresem ${raport.zAdresem} · ocenionych ${raport.ocenionych}`
);
console.log(
  `[reslot] pominięto: bez adresu ${raport.pominieto.bezAdresu}, ` +
    `adres spoza wzorca ${raport.pominieto.adresSpozaWzorca} (patrz docs/adresy-do-poprawy.md)`
);
console.log(
  `[reslot] eksmisja ${licz("eksmisja")} · awans ${licz("awans")} · ` +
    `likwidacja ${licz("likwidacja")} · brak reguły ${licz("brak_reguly")}`
);

if (brakHistorii) {
  console.error(
    "[reslot] BRAK HISTORII POBRAŃ — listy eksmisji, awansów i likwidacji POMINIĘTE.\n" +
      "         Bez pobrań każdy indeks wygląda na martwy, więc raport kazałby\n" +
      "         opróżnić całą strefę złotą. Sprawdź dok_Typ WZ i zakres dat."
  );
  // regały bez reguły to jedyne, co bez historii da się zmierzyć uczciwie
  const braki = [
    ...new Set(raport.wiersze.map((w) => w.lokalizacja.slice(0, 3))),
  ].sort();
  console.log(`[reslot] regały bez reguły strefy złotej: ${braki.join(", ") || "(brak)"}`);
}

if (!raport.wiersze.length) {
  console.log("[reslot] nic do zrobienia — raport nie powstaje");
  process.exit(0);
}

const dir = path.join(path.dirname(config.dbPath), "reslot");
fs.mkdirSync(dir, { recursive: true });
const plik = path.join(dir, `${raport.at.slice(0, 10)}${demo ? "-demo" : ""}.csv`);
fs.writeFileSync(plik, reslotCsv(raport), "utf8");
console.log(`[reslot] ${raport.wiersze.length} pozycji → ${plik}`);
console.log("[reslot] KOLEJNOŚĆ: najpierw eksmisja (zwalnia miejsca), potem awans.");
