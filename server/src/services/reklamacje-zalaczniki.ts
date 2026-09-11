import type { DatabaseSync } from "node:sqlite";
import {
  urlDeklaracjiZalacznikaSprawy, urlWgraniaZalacznikaSprawy, zapytajAllegro,
} from "../adapters/allegro.http.js";
import { config } from "../config.js";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { LIMIT_ZALACZNIKA, TYPY_ZALACZNIKA, type WgrajZalacznik } from "./allegro-wysylka.js";
import { DOZWOLONE_PO_LUDZKU, LIMIT_NASZ, MAKS_ZALACZNIKOW } from "./zalaczniki-wysylki.js";

/* ── Załączniki WYCHODZĄCE w sprawie posprzedażowej (0.274.0) ────────────────
   Decyzja właściciela z 7 września brzmiała „sam tekst" i trzymała się cztery
   dni. Odwrócił ją 11 września, więc panel dosyła plik razem z odpowiedzią —
   przy reklamacji częściej niż przy pytaniu, bo rozmowa reklamacyjna bywa
   sporem o to, co dokładnie widać na zdjęciu.

   WZORZEC JEST ZE SKRZYNKI (0.195.0) I ŚWIADOMIE GO POWTARZAMY, nie
   uogólniamy: plik idzie do Allegro OD RAZU (odmowa typu albo rozmiaru ma
   paść przy wybieraniu pliku, nie po napisaniu odpowiedzi), bajtów nie
   trzymamy u siebie ani chwili dłużej, a wiersz powstaje wyłącznie po udanym
   wgraniu. Wspólne są LICZBY i walidacja — importujemy je z tamtego modułu,
   żeby agent nie uczył się dwóch limitów dla dwóch ekranów tej samej pracy.

   CZEGO NIE DA SIĘ POWTÓRZYĆ, to droga do Allegro. To inny zasób i inny
   kształt ciała: `AttachmentDeclaration` z polem `fileName`, a nie
   `NewAttachmentDeclaration` z polem `filename`. Różnica jednej litery przy
   polu obowiązkowym.

   Cena tej decyzji jest jawna, ta sama co w skrzynce: plik dodany i nigdy
   niewysłany zostaje u Allegro jako deklaracja bez wiadomości. To śmieć po
   ICH stronie i nie ma końcówki, którą dałoby się go sprzątnąć.             */

export interface ZalacznikSprawy {
  id: number;
  allegroId: string;
  nazwa: string;
  typ: string;
  rozmiar: number;
  dodal: string | null;
}

/**
 * Wgranie pliku do Allegro: deklaracja, potem bajty.
 *
 * ADRES WGRANIA BIERZE SIĘ Z NAGŁÓWKA `Location`, bo specyfikacja mówi to
 * wprost: „The URL is unique and one-time. As its format may change in time,
 * you should always use the address from the header. Do not compose the
 * address on your own".
 *
 * Złożenie adresu z identyfikatora zostaje jako DROGA AWARYJNA i zostawia
 * ślad w dzienniku. Bez niej brak jednego nagłówka zabijałby całą funkcję;
 * z nią — działa dalej, a my wiemy, że Allegro przestało go przysyłać.
 */
export const wgrajZalacznikSprawy: WgrajZalacznik = async (nazwa, typ, dane) => {
  const odp = await zapytajAllegro(urlDeklaracjiZalacznikaSprawy(config.allegro.apiUrl), {
    metoda: "POST",
    /* `fileName`, nie `filename` — patrz `urlDeklaracjiZalacznikaSprawy`. */
    body: { fileName: nazwa, size: dane.byteLength },
    zLokalizacja: true,
  }) as { dane?: { id?: unknown } | null; location?: string | null } | null;

  const id = odp?.dane?.id == null ? null : String(odp.dane.id);
  if (!id) throw new Error("Allegro nie oddało numeru deklaracji załącznika sprawy");

  const zNaglowka = odp?.location ?? null;
  if (!zNaglowka) {
    logEvent("reklamacja_zalacznik_bez_location", "system", null, { allegroId: id });
  }
  await zapytajAllegro(zNaglowka ?? urlWgraniaZalacznikaSprawy(config.allegro.apiUrl, id), {
    metoda: "PUT",
    plik: { dane, typ },
  });
  return { id };
};

/**
 * Pliki czekające na wysłanie przy TEJ sprawie.
 *
 * Nazwa rozróżnia strony, tak samo jak w skrzynce: `zalacznikiSprawy`
 * w `services/reklamacje.ts` oddaje załączniki PRZYCHODZĄCE — te od klienta.
 * Dwie funkcje o jednej nazwie w tej samej rodzinie modułów byłyby pułapką na
 * następnego czytelnika, a podpowiedź edytora nie mówi, którą wybiera.
 */
export function zalacznikiDoWyslania(
  database: DatabaseSync, reklamacjaId: number,
): ZalacznikSprawy[] {
  return (database.prepare(`SELECT z.id, z.allegro_id, z.nazwa, z.typ, z.rozmiar, u.name AS dodal
    FROM reklamacja_zalacznik_wysylki z LEFT JOIN app_user u ON u.user_id = z.dodal_user_id
    WHERE z.reklamacja_id = ? ORDER BY z.id`).all(reklamacjaId) as Array<Record<string, unknown>>)
    .map((w) => ({
      id: Number(w.id),
      allegroId: String(w.allegro_id),
      nazwa: String(w.nazwa),
      typ: String(w.typ),
      rozmiar: Number(w.rozmiar),
      dodal: w.dodal == null ? null : String(w.dodal),
    }));
}

export interface ZadanieZalacznikaSprawy {
  reklamacjaId: number;
  nazwa: string;
  typ: string;
  dane: Uint8Array;
  autor: { id: number; name: string };
  database?: DatabaseSync;
  wgraj?: WgrajZalacznik;
}

/**
 * Dodanie załącznika do odpowiedzi: walidacja, wgranie, zapis wiersza.
 *
 * Sieć stoi POZA zapisem i PO walidacji — ten sam układ co przy wysyłce.
 * Wiersz powstaje wyłącznie po udanym wgraniu: wiersz bez pliku po tamtej
 * stronie obiecywałby załącznik, którego wysyłka nie znajdzie.
 */
export async function dodajZalacznikSprawy(
  z: ZadanieZalacznikaSprawy,
): Promise<ZalacznikSprawy> {
  const database = z.database ?? db();
  const wgraj = z.wgraj ?? wgrajZalacznikSprawy;

  const nazwa = z.nazwa.trim();
  if (!nazwa) throw new Error("Załącznik bez nazwy pliku");
  if (!(TYPY_ZALACZNIKA as readonly string[]).includes(z.typ)) {
    throw new Error(
      `Allegro przyjmuje przy wiadomości tylko ${DOZWOLONE_PO_LUDZKU} — ten plik jest typu ${z.typ}`);
  }
  if (z.dane.byteLength === 0) throw new Error("Pusty plik nie idzie do klienta");
  if (z.dane.byteLength > LIMIT_NASZ) {
    /* Zdanie mówi OBIE liczby, bo różnica progów jest nasza, nie Allegro.
       Przy sprawach schemat deklaracji nie podaje maksimum WCALE, więc próg
       Allegro jest tu tylko punktem odniesienia z sąsiedniej rodziny. */
    throw new Error(
      `Plik ma ${(z.dane.byteLength / 1024 / 1024).toFixed(1)} MB, a przyjmujemy ` +
      `${LIMIT_NASZ / 1024 / 1024} MB (Centrum Wiadomości bierze ` +
      `${LIMIT_ZALACZNIKA / 1024 / 1024} MB, różnica to koszt kodowania w naszym API)`);
  }

  const ile = database.prepare(
    "SELECT count(*) n FROM reklamacja_zalacznik_wysylki WHERE reklamacja_id=?")
    .get(z.reklamacjaId) as { n: number };
  if (Number(ile.n) >= MAKS_ZALACZNIKOW) {
    throw new Error(`Do jednej odpowiedzi wolno dołączyć najwyżej ${MAKS_ZALACZNIKOW} plików`);
  }

  const { id: allegroId } = await wgraj(nazwa, z.typ, z.dane);

  const id = Number(database.prepare(`INSERT INTO reklamacja_zalacznik_wysylki
    (reklamacja_id, allegro_id, nazwa, typ, rozmiar, dodal_user_id)
    VALUES (?,?,?,?,?,?)`)
    .run(z.reklamacjaId, allegroId, nazwa, z.typ, z.dane.byteLength, z.autor.id).lastInsertRowid);

  /* Do dziennika idą NAZWA, TYP i ROZMIAR, nigdy bajty. Nazwa pliku bywa daną
     osobową i przyjmujemy to świadomie, tak samo jak przy załącznikach
     przychodzących (polityka danych 0.143.0). */
  logEvent("reklamacja_zalacznik_dodany", z.autor.name, null,
    { id: z.reklamacjaId, allegroId, nazwa, typ: z.typ, rozmiar: z.dane.byteLength },
    z.autor.id, database);

  return { id, allegroId, nazwa, typ: z.typ, rozmiar: z.dane.byteLength, dodal: z.autor.name };
}

/**
 * Zdjęcie załącznika z odpowiedzi.
 *
 * Kasuje WYŁĄCZNIE nasz wiersz. Deklaracji po stronie Allegro cofnąć się nie
 * da — nie ma takiej końcówki — więc plik zostaje tam nieużyty. Ekran nie ma
 * prawa obiecywać, że „usunięto go z Allegro".
 */
export function usunZalacznikSprawy(
  database: DatabaseSync, reklamacjaId: number, id: number,
  autor: { id: number; name: string },
): boolean {
  const w = database.prepare(
    "SELECT allegro_id, nazwa FROM reklamacja_zalacznik_wysylki WHERE id=? AND reklamacja_id=?")
    .get(id, reklamacjaId) as { allegro_id: string; nazwa: string } | undefined;
  if (!w) return false;
  database.prepare("DELETE FROM reklamacja_zalacznik_wysylki WHERE id=?").run(id);
  logEvent("reklamacja_zalacznik_zdjety", autor.name, null,
    { id: reklamacjaId, allegroId: w.allegro_id, nazwa: w.nazwa }, autor.id, database);
  return true;
}
