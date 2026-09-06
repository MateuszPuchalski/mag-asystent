import { db as defaultDb, type Db } from "../db/db.js";
import { zwiazFakturyPewne, zwiazKorektyPewne } from "./faktury.js";
import { wypuscGotoweKoszyki } from "./kosze-zwrotow.js";
import { zwiazPewne } from "./sygnatury.js";

/* ── Wiązanie zaległości (0.220.0) ───────────────────────────────────────────
   Cztery kroki, które chodzą po WŁASNEJ bazie i Allegro do niczego nie
   potrzebują: kartoteka po sygnaturze, dokument sprzedaży, korekta i koszyk
   czekający na komplet korekt.

   POWSTAŁY Z BLIZNY. Do tego wydania stały w takcie jako ciąg dalszy po
   `await synchronizujAllegroZwroty()`. Wyjątek z pobierania — wygasły token,
   limit 429, jeden felerny rekord w partii — leciał wyżej, a te cztery kroki
   nie wykonywały się ANI RAZU. Zwroty zapisane we wcześniejszych przebiegach
   zostawały w bazie, więc kolejka wyglądała zdrowo, a przy każdej pozycji
   stało „Bez kartoteki" z gotową propozycją obok. Ta sama lekcja co przy
   wątkach skrzynki w 0.149.2, tylko piętro wyżej: jedna końcówka zabierała
   ze sobą pracę, która jej nie potrzebowała.

   KAŻDY KROK MA WŁASNY `try` z tego samego powodu. Wywrócone wiązanie faktur
   nie ma prawa zabrać koszyków, bo dotyczą różnych tabel i różnych zwrotów.

   KOLEJNOŚĆ NIE JEST DOWOLNA: dokument sprzedaży wiąże się po kartotece
   (kandydaci liczą się z `tw_id`), korekta po dokumencie (0.201.0 — wiąże się
   PRZEZ niego), a koszyk wychodzi dopiero po komplecie korekt (0.200.0).   */

/** Ile czego dopięto w jednym przebiegu — dziennik ma powiedzieć, ile zdjął. */
export interface WynikWiazania {
  kartoteki: number;
  faktury: number;
  korekty: number;
  koszyki: number;
}

/**
 * Krok wiązania z własnym parasolem.
 *
 * Głośno w logu, bo cisza tutaj znaczyłaby dokładnie to, co ta funkcja ma
 * naprawiać: pracę, która nie doszła, i nikt się o tym nie dowiedział.
 */
function krok(nazwa: string, wykonaj: () => number): number {
  try {
    return wykonaj();
  } catch (e) {
    console.error(`[wiązanie] ${nazwa} nie doszło:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

export function powiazZaleglosci(
  database: Db = defaultDb(), teraz = new Date(),
): WynikWiazania {
  return {
    kartoteki: krok("kartoteki", () => zwiazPewne(database, teraz)),
    faktury: krok("faktury", () => zwiazFakturyPewne(database, teraz)),
    korekty: krok("korekty", () => zwiazKorektyPewne(database, teraz)),
    koszyki: krok("koszyki", () => wypuscGotoweKoszyki(database, teraz)),
  };
}
