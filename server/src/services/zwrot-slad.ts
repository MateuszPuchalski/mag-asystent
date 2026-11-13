import type { Db } from "../db/db.js";

/* ── Ślad pracy hali na osi zwrotu ───────────────────────────────────────────
   Kosz wie, z której pozycji zwrotu wziął towar (`kosz_pozycja.zwrot_pozycja_id`).
   Biuro patrzące na zwrot ma widzieć, że towar wrócił na półkę albo że go
   w koszu nie było. Bez tego pytanie „gdzie leży ten towar" kończyło się w Subiekcie
   albo telefonem na halę.

   OSOBNY PLIK, a nie funkcja w `kosze.ts` ani w `zwroty.ts`. Rozkładanie jest
   pracą hali, oś zwrotu — sprawą biura; ten moduł jest jedynym miejscem, które
   wie, jak jedno wskazuje drugie. Import w tamtą stronę (`kosze.ts` →
   `zwroty.ts`) ciągnąłby cały serwis zwrotów do modułu kolektora po jeden
   INSERT — ta sama decyzja co przy `ilosc-zwrotu.ts`.

   MILCZY, GDY NIE MA CZEGO POWIEDZIEĆ. Kosz z dokumentu MM z Subiekta i karton
   nie mają zwrotu (`zwrot_pozycja_id IS NULL`), a wtedy ślad nie ma gdzie
   usiąść. Brak zwrotu nie jest awarią rozkładania.                          */

/**
 * Dopisuje zdarzenie na oś zwrotu, do którego należy pozycja kosza.
 *
 * `kto_user_id` zostaje NULL: hala rozkłada z kolektora, a `odlozPozycje` zna
 * wyłącznie nazwę operatora. Kolumna ma klucz obcy do `app_user`, więc udawany
 * identyfikator wywróciłby zapis — a imię i tak stoi w `kto`.
 */
export function sladZKosza(
  database: Db,
  pozycjaKoszaId: number,
  rodzaj: string,
  tresc: string,
  dane: Record<string, unknown>,
  autor: string,
  kiedy: string,
): number | null {
  const w = database.prepare(
    `SELECT p.zwrot_id AS zwrot_id FROM kosz_pozycja k
       JOIN zwrot_klienta_pozycja p ON p.id = k.zwrot_pozycja_id
      WHERE k.id = ?`).get(pozycjaKoszaId) as { zwrot_id: number } | undefined;
  if (!w) return null;
  database.prepare(`INSERT INTO zwrot_zdarzenie
    (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,NULL)`)
    .run(w.zwrot_id, rodzaj, tresc, JSON.stringify(dane), kiedy, autor);
  return Number(w.zwrot_id);
}
