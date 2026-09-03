import { logEvent } from "./events.js";
import { transaction, type Db } from "../db/db.js";
import { config } from "../config.js";

/* ── Koszyk zwrotów składany w panelu (0.192.0) ─────────────────────────────
   Właściciel opisał obieg, który biuro robi od lat ręką:

     „gdy agent zasiada do zwrotów, to otwiera pustą MM i dodaje kolejno
      przedmioty ze zwrotów; gdy koszyk się zapełni, zamyka MM i tak w kółko"

   Ten plik jest tym obiegiem, tyle że dokument wystawia Sfera, a nie człowiek.
   Kartka z numerem napisanym odręcznie przestaje być potrzebna — numer wraca
   z kolejki i staje na ekranie.

   ── Dlaczego to wraca dopiero teraz ──────────────────────────────────────
   Ścieżka koszyków istniała i wypadła w 0.17.0 z jednym, twardym powodem:
   „domknięcie koszyka kolejkuje MM, a dokumentów MM na produkcji nie da się
   dziś wystawić". Ten powód wygasł — worker Sfery w C# ma prawdziwe
   `CreateMM` (`sfera-worker/src/ISferaAdapter.cs`). Schemat `kosz` czekał na
   to bez zmian: status `otwarty` nosi w komentarzu zdanie „biuro dokłada
   zwroty", które przez rok nie miało kto wykonać.

   Reguła „tylko lokalizacja" z 0.16.0 nie jest tu złamana: dotyczy SUROWYCH
   zapisów do bazy Subiekta, a dokumenty idą osobnym, przyjętym kanałem —
   przez Sferę, tak samo jak korekta zwrotu.

   ── Trzy decyzje właściciela z 3 września 2026 ───────────────────────────
   1. Do koszyka wchodzi WYŁĄCZNIE towar oceniony „na stan". Przecena
      i utylizacja zostają poza tą ścieżką; utylizacji nie wolno wysłać MM na
      regał zwrotów, bo to towar, który ma zejść ze stanu, a nie pojechać na
      półkę.
   2. Otwarty koszyk jest JEDEN NA OPERATORA. Fizyczny kosz stoi przy jednym
      biurku, więc dwie osoby przy zwrotach nie mieszają towaru w jednym
      dokumencie.
   3. Dokładanie nie jest osobnym ruchem. Ocena „na stan", którą operator
      i tak naciska, JEST dołożeniem do koszyka — najszybsza decyzja to ta,
      której nie podejmuje się dwa razy.                                     */

/** Przedrostek kodu koszy składanych u nas. */
const PRZEDROSTEK = "Z-";

export interface StanKosza {
  id: number;
  kod: string;
  pozycji: number;
  sztuk: number;
  otwartyOd: string;
  pozycje: Array<{ symbol: string; nazwa: string; ilosc: number }>;
}

/**
 * Kod nowego koszyka.
 *
 * PRZEDROSTEK JEST KONIECZNY, nie ozdobny. Kosze z Subiekta noszą jako kod
 * samą liczbę z numeru MM („1209") — tę z kartki, którą magazynier wpisuje na
 * kolektorze. Gołe „7" z naszego licznika zderzyłoby się z tamtą przestrzenią
 * przy pierwszym trafieniu i otworzyłoby cudzy kosz.
 */
function nowyKod(database: Db): string {
  const uzyte = (database.prepare(
    `SELECT kod FROM kosz WHERE kod LIKE '${PRZEDROSTEK}%'`).all() as Array<{ kod: string }>)
    .map((k) => Number(k.kod.slice(PRZEDROSTEK.length)))
    .filter((n) => Number.isFinite(n));
  return `${PRZEDROSTEK}${(uzyte.length ? Math.max(...uzyte) : 0) + 1}`;
}

/**
 * Otwarty koszyk tego operatora — istniejący albo świeżo założony.
 *
 * Szuka po `utworzono_przez`, bo to jest właściciel fizycznego kosza. Kosze
 * z Subiekta (`mm_dok_id IS NOT NULL`) odpadają: tamte rodzi dokument, a nie
 * praca przy biurku, i nigdy nie stoją otwarte.
 */
export function otwartyKosz(database: Db, kto: { id: number; name: string },
  teraz = new Date()): number {
  const juz = database.prepare(
    `SELECT id FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL
       AND utworzono_przez=? ORDER BY id LIMIT 1`).get(kto.name) as { id: number } | undefined;
  if (juz) return Number(juz.id);

  const at = teraz.toISOString();
  const kod = nowyKod(database);
  const id = Number(database.prepare(
    `INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez)
     VALUES (?, 'otwarty', 'zwroty', ?, ?)`).run(kod, at, kto.name).lastInsertRowid);
  logEvent("kosz_zwrotow_otwarty", kto.name, null, { koszId: id, kod }, kto.id, database);
  return id;
}

/**
 * Dokłada pozycję zwrotu do otwartego koszyka operatora.
 *
 * Oddaje `null`, gdy dołożyć się NIE DA — i to nie jest awaria, tylko stan
 * pracy: pozycja bez kartoteki nie ma `tw_id`, a dokument MM przesuwa stany
 * kartotek, nie nazwy. Ocena zapisuje się mimo to, bo jest faktem o towarze;
 * ekran ma wtedy powiedzieć, czego nie zrobił. Cicha utrata pozycji byłaby
 * najgorszym z wyjść: karton pojechałby na halę z towarem, którego nie ma na
 * żadnym dokumencie.
 */
export function dolozDoKosza(
  database: Db, pozycjaId: number, kto: { id: number; name: string }, teraz = new Date(),
): number | null {
  const p = database.prepare(
    `SELECT p.id, p.tw_id, p.nazwa, p.ilosc, t.symbol
       FROM zwrot_klienta_pozycja p
       LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
      WHERE p.id=?`).get(pozycjaId) as
    { id: number; tw_id: number | null; nazwa: string; ilosc: number; symbol: string | null }
    | undefined;
  if (!p || p.tw_id == null) return null;

  const koszId = otwartyKosz(database, kto, teraz);
  /* Dwa razy ta sama pozycja to jeden wiersz. Operator bywa poprawiany:
     cofnięcie oceny i ponowne „na stan" nie ma prawa podwoić sztuk na MM. */
  const stoi = database.prepare(
    "SELECT id FROM kosz_pozycja WHERE kosz_id=? AND zwrot_pozycja_id=?")
    .get(koszId, pozycjaId) as { id: number } | undefined;
  if (stoi) return koszId;

  database.prepare(
    `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
     VALUES (?,?,?,?,?,?)`).run(koszId, Number(p.tw_id),
      p.symbol ?? String(p.tw_id), p.nazwa, Number(p.ilosc), pozycjaId);
  logEvent("kosz_zwrotow_dolozono", kto.name, null,
    { koszId, pozycjaId, twId: Number(p.tw_id), ilosc: Number(p.ilosc) }, kto.id, database);
  return koszId;
}

/**
 * Zdejmuje pozycję z koszyka po cofnięciu albo zmianie oceny.
 *
 * TYLKO Z OTWARTEGO. Kosz zamknięty pojechał już na halę z wystawionym
 * dokumentem — wyjęcie z niego wiersza rozjechałoby papier z zawartością,
 * a magazynier szukałby towaru, którego nikt nie wyjął z kartonu.
 */
export function zdejmijZKosza(
  database: Db, pozycjaId: number, kto: { id: number; name: string },
): boolean {
  const w = database.prepare(
    `SELECT kp.id, kp.kosz_id FROM kosz_pozycja kp
       JOIN kosz k ON k.id = kp.kosz_id
      WHERE kp.zwrot_pozycja_id=? AND k.status='otwarty'`)
    .get(pozycjaId) as { id: number; kosz_id: number } | undefined;
  if (!w) return false;
  database.prepare("DELETE FROM kosz_pozycja WHERE id=?").run(w.id);
  logEvent("kosz_zwrotow_zdjeto", kto.name, null,
    { koszId: Number(w.kosz_id), pozycjaId }, kto.id, database);
  return true;
}

/** Co leży w otwartym koszyku operatora. `null`, gdy jeszcze żadnego nie ma. */
export function stanOtwartegoKosza(database: Db, kto: { name: string }): StanKosza | null {
  const k = database.prepare(
    `SELECT id, kod, utworzono_at FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL
       AND utworzono_przez=? ORDER BY id LIMIT 1`).get(kto.name) as
    { id: number; kod: string; utworzono_at: string } | undefined;
  if (!k) return null;
  const pozycje = database.prepare(
    "SELECT symbol, nazwa, ilosc FROM kosz_pozycja WHERE kosz_id=? ORDER BY id")
    .all(k.id) as Array<{ symbol: string; nazwa: string; ilosc: number }>;
  return {
    id: Number(k.id), kod: k.kod, otwartyOd: k.utworzono_at,
    pozycji: pozycje.length,
    sztuk: pozycje.reduce((s, p) => s + Number(p.ilosc), 0),
    pozycje: pozycje.map((p) => ({ ...p, ilosc: Number(p.ilosc) })),
  };
}

/**
 * Zamyka koszyk i KOLEJKUJE dokument MM (magazyn główny → regał zwrotów).
 *
 * Kosz staje się `zamkniety` OD RAZU, nie po powrocie numeru z Sfery. Hala ma
 * wtedy co rozkładać, a numer dochodzi w sekundach — wiązanie widoku
 * magazyniera z dostępnością Subiekta zatrzymywałoby pracę fizyczną przy
 * awarii, która jej nie dotyczy. Numer wraca do `sfera_queue.sgt_doc_number`
 * i panel czyta go stamtąd, przez `kosz.mm_queue_id`.
 *
 * Pusty kosz odmawia. Dokument bez pozycji nie jest dokumentem, a Sfera i tak
 * odrzuciłaby go dopiero w workerze — czyli po tym, jak operator odszedłby
 * od biurka.
 */
export function zamknijKosz(
  database: Db, koszId: number, kto: { id: number; name: string }, teraz = new Date(),
): { koszId: number; kod: string; pozycji: number; queueId: number } {
  return transaction(database, () => {
    const k = database.prepare(
      "SELECT id, kod, status FROM kosz WHERE id=? AND mm_dok_id IS NULL")
      .get(koszId) as { id: number; kod: string; status: string } | undefined;
    if (!k) throw new Error("Nie znam takiego koszyka zwrotów.");
    if (k.status !== "otwarty") throw new Error(`Koszyk ${k.kod} jest już ${k.status}.`);

    const pozycje = database.prepare(
      "SELECT tw_id, ilosc FROM kosz_pozycja WHERE kosz_id=?")
      .all(koszId) as Array<{ tw_id: number; ilosc: number }>;
    if (!pozycje.length) {
      throw new Error(`Koszyk ${k.kod} jest pusty — nie ma z czego wystawić MM.`);
    }

    /* Pozycje SUMUJĄ SIĘ po kartotece. Ten sam towar z dwóch różnych zwrotów
       to jedna linia dokumentu — Subiekt przyjąłby i dwie, ale magazynier
       liczyłby wtedy ten sam symbol dwa razy przy tym samym regale. */
    const wgTowaru = new Map<number, number>();
    for (const p of pozycje) {
      wgTowaru.set(Number(p.tw_id), (wgTowaru.get(Number(p.tw_id)) ?? 0) + Number(p.ilosc));
    }
    const items = [...wgTowaru].map(([twId, qty]) => ({ twId, qty }));

    const at = teraz.toISOString();
    const queueId = Number(database.prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, created_by, created_by_ref,
                               created_at)
       VALUES ('mm', ?, 'pending', ?, ?, ?, ?, ?)`).run(
      JSON.stringify({ magFrom: config.magId.MAG, magTo: config.magId.ZWROTY, items }),
      `Koszyk zwrotów ${k.kod}`,
      `${items.length} kartotek na regał zwrotów`,
      kto.name, kto.id, at).lastInsertRowid);

    database.prepare(
      `UPDATE kosz SET status='zamkniety', zamknieto_at=?, zamknieto_przez=?, mm_queue_id=?
        WHERE id=?`).run(at, kto.name, queueId, koszId);

    logEvent("kosz_zwrotow_zamkniety", kto.name, null,
      { koszId, kod: k.kod, pozycji: pozycje.length, kartotek: items.length, queueId },
      kto.id, database);
    return { koszId, kod: k.kod, pozycji: pozycje.length, queueId };
  })();
}
