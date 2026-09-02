import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { dopasujPozycjeZamowienia } from "./dopasowanie-sku.js";
import { logEvent } from "./events.js";

/* ── Rabat transakcyjny przy pozycji zwrotu (0.164.0) ────────────────────────
   Zwrot prowizji od sprzedaży. Do tego wydania firma klikała po niego ręcznie
   przy KAŻDYM zwrocie w panelu Allegro — nie dlatego, że tak trzeba, tylko
   dlatego, że znikąd nie było widać, przy którym wniosek już jest.

   IDENTYFIKATOR DO ZŁOŻENIA WNIOSKU BIERZE SIĘ Z POZYCJI ZAMÓWIENIA i to jest
   najważniejsza decyzja tego pliku. `POST /order/refund-claims` żąda
   `lineItem.id`, czyli identyfikatora pozycji zamówienia; zwrot niesie własne
   `items[].offerId`, o którym wciąż nie wiemy, do której przestrzeni należy
   (`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`). Idąc przez zamówienie, pytanie
   nas nie dotyczy — a przy okazji to samo złączenie odpowiada, dlaczego
   czasem nie da się nic złożyć.                                             */

/** Stan rabatu przy jednej pozycji zwrotu. */
export type StanRabatu = {
  stan: "brak" | "zlozony" | "przyznany" | "odrzucony" | "nie_wiadomo";
  /** Identyfikator pozycji ZAMÓWIENIA — to on idzie w żądaniu. `null` = nie ma czego złożyć. */
  lineItemId: string | null;
  ilosc: number;
  wniosekId: string | null;
  prowizjaGrosze: number | null;
  waluta: string | null;
  typ: string | null;
  /** Dlaczego nie da się nic złożyć. Zdanie pisze SERWER, panel go nie układa. */
  powod: string | null;
  /**
   * Skąd wiadomo o wniosku: z naszego lustra `allegro_rabat` czy ze statusu
   * samego zwrotu. Panel MUSI to rozróżniać — patrz komentarz przy odczycie
   * statusu zwrotu niżej.
   */
  zrodlo: "lustro" | "zwrot" | null;
};

/* Wniosek anulowany NIE liczy się jak istniejący. `DELETE` zostawia go ze
   statusem `CANCELLED`, a gdyby blokował pozycję, jedna pomyłka odbierałaby
   rabat na zawsze. */
const MARTWE = new Set(["CANCELLED"]);
const PRZYZNANE = new Set(["GRANTED"]);
const ODRZUCONE = new Set(["REJECTED", "REJECTED_AFTER_APPEAL"]);

/* ── Wniosek złożony POZA panelem (0.176.0) ──────────────────────────────────
   Statusy zwrotu, przy których Allegro samo mówi, że prowizja jest już objęta
   wnioskiem. `zlozWniosekORabat` PILNOWAŁO ich od 0.164.0 jako drugi strażnik,
   ale `stanRabatu` ich nie czytał — i to jest cała usterka, którą zgłosił
   właściciel. Wniosek złożony w panelu Allegro nie ma prawa trafić do naszego
   lustra, dopóki nie przewinie się przez `GET /order/refund-claims`; ekran
   pisał wtedy „brak wniosku" i podstawiał przycisk, który po kliknięciu
   ZAWSZE kończył się konfliktem. Panel obiecywał pracę, której serwer nie
   przyjmował — a to gorsze niż milczenie.

   Zdanie ekranu ma więc dwa źródła, a nie jedno, i mówi wprost, z którego
   pochodzi (zasada 4.3 projektu panelu: wynik automatu nie udaje faktu).   */
const STATUS_ZWROTU: Record<string, StanRabatu["stan"]> = {
  COMMISSION_REFUND_CLAIMED: "zlozony",
  COMMISSION_REFUNDED: "przyznany",
};

type Wiersz = {
  zwrot_id: number; offer_id: string | null; nazwa: string; ilosc: number;
  order_id: string | null; channel_account_id: number;
};

/**
 * Pozycja zamówienia, z której złoży się wniosek dla tej pozycji zwrotu.
 *
 * `zrodlo` mówi wprost, skąd wziął się identyfikator — pole istnieje po to,
 * żeby test mógł tego pilnować, a czytelnik nie musiał wierzyć komentarzowi.
 */
export function pozycjaDoWniosku(
  database: Db, pozycjaZwrotuId: number,
): { lineItemId: string; ilosc: number; zrodlo: "zamowienie" } | null {
  const w = database.prepare(`SELECT p.zwrot_id, p.offer_id, p.nazwa, p.ilosc,
      z.order_id, z.channel_account_id
    FROM zwrot_klienta_pozycja p JOIN zwrot_klienta z ON z.id = p.zwrot_id
    WHERE p.id = ?`).get(pozycjaZwrotuId) as Wiersz | undefined;
  if (!w?.order_id) return null;

  const t = dopasujPozycjeZamowienia(
    database, Number(w.channel_account_id), w.order_id, w.offer_id, w.nazwa);
  const lineItemId = t.pozycja?.external_id ?? null;
  if (!lineItemId) return null;
  return { lineItemId, ilosc: Math.max(1, Math.round(Number(w.ilosc) || 1)), zrodlo: "zamowienie" };
}

/** Stan rabatu dla pozycji zwrotu — to zdanie rysuje panel. */
export function stanRabatu(
  database: Db = defaultDb(), pozycjaZwrotuId: number,
): StanRabatu {
  const pusty = (powod: string | null): StanRabatu => ({
    stan: "nie_wiadomo", lineItemId: null, ilosc: 0, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod, zrodlo: null,
  });

  const w = database.prepare(`SELECT z.order_id, z.status_allegro
    FROM zwrot_klienta_pozycja p
    JOIN zwrot_klienta z ON z.id = p.zwrot_id WHERE p.id = ?`)
    .get(pozycjaZwrotuId) as
      { order_id: string | null; status_allegro: string | null } | undefined;
  if (!w) return pusty("Nie znaleziono pozycji zwrotu");

  /* Status zwrotu czytamy PRZED dopasowaniem pozycji zamówienia, bo mówi
     prawdę także wtedy, gdy dopasowanie pęka: „wniosek już jest" nie zależy
     od tego, czy MY umiemy wskazać pozycję, do której go złożono. */
  const zeZwrotu = STATUS_ZWROTU[String(w.status_allegro ?? "")] ?? null;
  const wgZwrotu = (lineItemId: string | null, ilosc: number): StanRabatu => ({
    stan: zeZwrotu!, lineItemId, ilosc, wniosekId: null, prowizjaGrosze: null,
    waluta: null, typ: null, zrodlo: "zwrot",
    /* Powód niesie DOSŁOWNY status Allegro, bo to jedyne, co o tym wniosku
       wiemy — kwoty ani numeru zwrot nie podaje. */
    powod: `Allegro podaje przy tym zwrocie status ${w.status_allegro}.`,
  });

  if (!w.order_id) {
    return zeZwrotu ? wgZwrotu(null, 0)
      : pusty("Allegro nie podało numeru zamówienia dla tego zwrotu");
  }

  const cel = pozycjaDoWniosku(database, pozycjaZwrotuId);
  if (!cel) {
    if (zeZwrotu) return wgZwrotu(null, 0);
    /* Ten sam łańcuch, co przy kartotekach: powód mówi, KTÓRE ogniwo pękło,
       bo wszystkie zerwane wyglądają na ekranie identycznie. */
    return pusty("Nie dopasowano pozycji zamówienia — bez niej Allegro nie wie, czego dotyczy wniosek");
  }

  /* Najnowszy żywy wniosek na tę pozycję. Anulowane odpadają, więc pomyłka
     nie blokuje rabatu na zawsze. */
  const r = database.prepare(`SELECT external_id, status, typ, prowizja_grosze, waluta
    FROM allegro_rabat WHERE line_item_id = ? ORDER BY created_at DESC, id DESC`)
    .all(cel.lineItemId) as Array<Record<string, unknown>>;
  const zywy = r.find((x) => !MARTWE.has(String(x.status ?? "")));

  const wspolne = { lineItemId: cel.lineItemId, ilosc: cel.ilosc, powod: null };
  if (!zywy) {
    /* Lustro milczy, a zwrot mówi — pierwszeństwo ma ten, który coś wie.
       Odwrotna kolejność dawała „brak wniosku" przy wniosku złożonym ręcznie
       w panelu Allegro. */
    if (zeZwrotu) return wgZwrotu(cel.lineItemId, cel.ilosc);
    return { ...wspolne, stan: "brak", wniosekId: null, prowizjaGrosze: null,
      waluta: null, typ: null, zrodlo: null };
  }
  const status = String(zywy.status ?? "");
  return {
    ...wspolne,
    stan: PRZYZNANE.has(status) ? "przyznany" : ODRZUCONE.has(status) ? "odrzucony" : "zlozony",
    wniosekId: String(zywy.external_id),
    prowizjaGrosze: zywy.prowizja_grosze == null ? null : Number(zywy.prowizja_grosze),
    waluta: zywy.waluta == null ? null : String(zywy.waluta),
    typ: zywy.typ == null ? null : String(zywy.typ),
    zrodlo: "lustro",
  };
}

/* ── Złożenie wniosku: PIERWSZY ZAPIS tego systemu do Allegro ────────────────
   Dotąd wychodziła stąd wyłącznie wiadomość do klienta; wszystko inne było
   odczytem. Dlatego dwie ostrożności, których nie ma przy odczycie.

   PIERWSZA: końcówka NIE MA idempotencji. `commandId` jest przy zwrocie
   pieniędzy, nie tutaj — powtórzone żądanie zakłada DRUGI wniosek, a nie
   oddaje tego samego. Strażnik jest więc nasz i stoi PRZED wyjściem do sieci.

   DRUGA: zapis lokalny idzie PO udanej odpowiedzi, nigdy przed. Odwrotna
   kolejność zostawiłaby przy pozycji wniosek-widmo — u nas jest, w Allegro go
   nie ma — a własny strażnik nie pozwoliłby spróbować drugi raz.            */

export class RabatConflict extends Error {}

/** Wysyłka do Allegro. Wstrzykiwana, żeby test nie potrzebował sieci. */
export type NadawcaWniosku = (
  lineItemId: string, ilosc: number,
) => Promise<{ id?: string } | null>;

export async function zlozWniosekORabat(
  database: Db, pozycjaZwrotuId: number, kto: { id: number; name: string },
  nadaj: NadawcaWniosku, teraz = new Date(),
): Promise<{ wniosekId: string; lineItemId: string }> {
  const stan = stanRabatu(database, pozycjaZwrotuId);
  if (stan.stan === "nie_wiadomo" || !stan.lineItemId) {
    throw new Error(stan.powod ?? "Nie ma czego złożyć dla tej pozycji");
  }
  /* STRAŻNIK PIERWSZY: stan wniosku — obojgiem oczu naraz.

     Do 0.175.0 stały tu DWA strażniki po kolei: lustro wniosków, a pod nim
     status zwrotu. Od 0.176.0 `stanRabatu` czyta oba źródła, więc drugi
     strażnik przeniósł się TAM, gdzie i tak trzeba było go postawić — do
     zdania, które czyta panel. Tu zostaje jedno rozgałęzienie, bo powód
     odmowy MA WYMIENIĆ ŹRÓDŁO: numer wniosku z lustra albo status zwrotu.
     „Wniosek już istnieje (null)" byłoby gorsze niż milczenie. */
  if (stan.stan !== "brak") {
    /* Wniosek spoza panelu: w panelu Allegro albo ich własnym automatem
       (`type: AUTOMATIC` w 40 rekordach na 100). Numeru takiego wniosku
       jeszcze nie znamy — zwrot go nie niesie. */
    if (stan.zrodlo === "zwrot") {
      throw new RabatConflict(
        `${stan.powod} Prowizja jest już objęta wnioskiem, ` +
        "a drugi byłby osobnym zgłoszeniem.");
    }
    throw new RabatConflict(
      `Wniosek o rabat już istnieje (${stan.wniosekId}), status: ${stan.stan}.`);
  }

  const z = database.prepare(`SELECT z.id FROM zwrot_klienta_pozycja p
    JOIN zwrot_klienta z ON z.id = p.zwrot_id WHERE p.id = ?`)
    .get(pozycjaZwrotuId) as { id: number };

  const odp = await nadaj(stan.lineItemId, stan.ilosc);
  const wniosekId = typeof odp?.id === "string" ? odp.id : null;
  if (!wniosekId) {
    throw new Error("Allegro nie oddało numeru wniosku — sprawdź w panelu Allegro, czy powstał");
  }

  const at = teraz.toISOString();
  transaction(database, () => {
    /* Zapisujemy OD RAZU, nie czekając na następny przebieg synchronizacji:
       takt chodzi co kwadrans, a między dwoma kliknięciami są sekundy. */
    database.prepare(`INSERT INTO allegro_rabat
      (channel_account_id,external_id,line_item_id,ilosc,status,typ,created_at,synced_at)
      SELECT z.channel_account_id, ?, ?, ?, 'IN_PROGRESS', 'MANUAL', ?, ?
        FROM zwrot_klienta z WHERE z.id = ?
      ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
        line_item_id=excluded.line_item_id, status=excluded.status,
        synced_at=excluded.synced_at`)
      .run(wniosekId, stan.lineItemId, stan.ilosc, at, at, z.id);

    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(z.id, "rabat", `Złożono wniosek o rabat transakcyjny ${wniosekId}`,
        JSON.stringify({ wniosekId, lineItemId: stan.lineItemId, pozycjaZwrotuId }),
        at, kto.name, kto.id);

    logEvent("zwrot_rabat_zgloszony", kto.name, null,
      { zwrotId: z.id, pozycjaZwrotuId, wniosekId, lineItemId: stan.lineItemId },
      kto.id, database);
  })();

  return { wniosekId, lineItemId: stan.lineItemId };
}
