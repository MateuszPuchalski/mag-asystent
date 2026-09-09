import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { BladReklamacji, ReklamacjaConflict } from "./reklamacje.js";
import { odpowiedzWSprawie, type WyslijWiadomosc } from "./reklamacje-wysylka.js";
import { ZAKONCZENIE_WYSLANE, type StatusZakonczenia } from "./dyskusje.js";

/* ── Prośba o zakończenie dyskusji (0.245.0) ─────────────────────────────────
   JEDYNA operacja zapisu, którą Allegro przewiduje WYŁĄCZNIE dla dyskusji.
   Werdykt tu nie istnieje: `POST /sale/issues/{id}/status` ma w specyfikacji
   adnotację „Not a valid operation for disputes", a `MessageRequest.type`
   opisuje `END_REQUEST` jako dozwolony tylko przy dyskusjach.

   NAZYWAMY TO PROŚBĄ, NIE ZAKOŃCZENIEM, i to jest najważniejsze zdanie w tym
   pliku. Enum mówi `END_REQUEST` — żądanie zakończenia. Ani schemat, ani opis
   nigdzie nie obiecują, że dyskusja zamyka się od naszego strzału; jedynym
   dowodem zamknięcia jest `DISPUTE_CLOSED` przywiezione synchronizacją.
   Kod, który obiecuje więcej, niż mówi specyfikacja, kosztował już adres
   `/sale/disputes/{id}/messages` (do 0.155.0) i wzorzec adresu sprawy
   w Centrum Sprzedaży (do 0.226.1).

   CAŁA MASZYNERIA JEST GOTOWA. `odpowiedzWSprawie` niesie bramkę
   `czat_aktywny`, kontrolę wersji, świeżość od ostatniej NIE naszej
   wiadomości, klucz idempotencji liczony po stronie serwera i jeden wiersz
   skrzynki nadawczej na PRÓBĘ. Ten plik dokłada dokładnie dwie rzeczy:
   zakaz drugiej prośby i ślad po pierwszej.

   PORAŻKA KODEM NIE DOTYKA WIERSZA — zostaje w skrzynce nadawczej, a agent
   może spróbować jeszcze raz. Na sprawie zapisujemy wyłącznie to, po czym
   drugiej próby robić NIE WOLNO: `sent` i `send_uncertain`. Ten sam wzorzec
   co krok „towar do odesłania?" z 0.242.0.                                   */

export interface ZadanieZakonczenia {
  dyskusjaId: number;
  autor: { id: number; name: string };
  /** Wiadomość dla kupującego — WYMAGANA, patrz `poprosOZakonczenie`. */
  tresc: string;
  expectedWersja: number;
  expectedLastMessageId: number | null;
  /** Jawna zgoda agenta po 409 „ktoś dopisał" — nigdy domyślna. */
  mimoNowejWiadomosci?: boolean;
  database?: Db;
  wyslij?: WyslijWiadomosc;
}

export interface WynikZakonczenia {
  status: StatusZakonczenia;
  wersja: number;
}

/**
 * Poproś kupującego o zakończenie dyskusji.
 *
 * WIADOMOŚĆ JEST WYMAGANA i czyta ją kupujący. `MessageRequest` ma `text`
 * na liście `required`, więc pusta prośba wróciłaby z Allegro błędem — ale
 * powód jest głębszy niż schemat: prośba o zamknięcie sprawy bez ani jednego
 * zdania to dla człowieka po drugiej stronie zamknięcie drzwi bez słowa.
 *
 * Limitu znaków ten plik NIE liczy własną liczbą. Pilnuje go `odpowiedzWSprawie`
 * tą samą stałą, co czat — agent nie ma uczyć się dwóch liczb dla dwóch pól
 * tego samego ekranu.
 */
export async function poprosOZakonczenie(
  z: ZadanieZakonczenia,
): Promise<WynikZakonczenia> {
  const database = z.database ?? defaultDb();

  const w = database.prepare(
    `SELECT id, wersja, zakonczenie_status, zakonczenie_przez
       FROM reklamacja_klienta WHERE id=? AND typ='DISPUTE'`,
  ).get(z.dyskusjaId) as
    | { id: number; wersja: number; zakonczenie_status: string | null; zakonczenie_przez: string | null }
    | undefined;
  if (!w) throw new BladReklamacji(`Dyskusja ${z.dyskusjaId} nie istnieje`, 404);

  /* DRUGIEJ PROŚBY NIE MA. Pierwsza mogła dojść — także ta o niejednoznacznym
     losie — a druga byłaby dla kupującego drugą wiadomością w tej samej
     sprawie, o której nikt z nas nie wie, czy pierwsza do niego dotarła. */
  if (ZAKONCZENIE_WYSLANE.includes(w.zakonczenie_status ?? "")) {
    throw new ReklamacjaConflict(
      { zakonczenieStatus: w.zakonczenie_status, zakonczeniePrzez: w.zakonczenie_przez },
      "O zakończenie tej dyskusji już poproszono — drugiej prośby nie wysyłamy");
  }

  if (!(z.tresc ?? "").trim()) {
    throw new BladReklamacji(
      "Napisz kupującemu, dlaczego prosisz o zakończenie — Allegro nie przyjmie pustej prośby");
  }

  /* Strzał POZA transakcją, jak wszędzie w tym module: trzymanie otwartej
     transakcji SQLite na czas żądania HTTP blokowałoby zapisy na tyle, ile
     trwa najwolniejsza odpowiedź Allegro. */
  const wynik = await odpowiedzWSprawie({
    reklamacjaId: z.dyskusjaId,
    autor: z.autor,
    tresc: z.tresc,
    expectedWersja: z.expectedWersja,
    expectedLastMessageId: z.expectedLastMessageId,
    mimoNowejWiadomosci: z.mimoNowejWiadomosci,
    typ: "END_REQUEST",
    rodzaj: "DISPUTE",
    database,
    wyslij: z.wyslij,
  });

  /* Tu docieramy wyłącznie wtedy, gdy prośba WYSZŁA albo mogła wyjść —
     porażka kodem rzuciła wyżej i wiersza nie dotknęła. Sprawdzamy to jednak
     JAWNIE, zamiast rzutować typ: gdyby `odpowiedzWSprawie` kiedyś zaczęła
     oddawać porażkę zamiast ją rzucać, cichy zapis `send_failed` na wierszu
     zablokowałby drugą próbę na zawsze — a wolno ją zrobić. */
  if (!ZAKONCZENIE_WYSLANE.includes(wynik.status)) {
    throw new BladReklamacji(
      `Prośba o zakończenie wróciła ze stanem „${wynik.status}", którego ten ekran nie zna`);
  }
  const status = wynik.status as StatusZakonczenia;
  const wersja = transaction(database, () => {
    database.prepare(
      `UPDATE reklamacja_klienta
          SET zakonczenie_status=?, zakonczenie_at=datetime('now'),
              zakonczenie_przez=?, zakonczenie_user_id=?, wersja=wersja+1
        WHERE id=? AND typ='DISPUTE'`,
    ).run(status, z.autor.name, z.autor.id, z.dyskusjaId);
    /* Do dziennika idą DŁUGOŚĆ i los, nigdy treść: prośba bywa zdaniem
       o kliencie, a `events` nie ma retencji i nie jest kasowane. */
    logEvent("dyskusja_zakonczenie", z.autor.name, null,
      { id: z.dyskusjaId, status, znakow: z.tresc.trim().length }, undefined, database);
    /* bez typu: sam numer wersji do odpowiedzi, po zapisie wyżej. */
    return Number((database.prepare("SELECT wersja FROM reklamacja_klienta WHERE id=?")
      .get(z.dyskusjaId) as { wersja: number }).wersja);
  })();

  return { status, wersja };
}
