import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { dopasujPozycjeZamowienia } from "./dopasowanie-sku.js";
import { logEvent } from "./events.js";

/* ── Rabat transakcyjny przy pozycji zwrotu (0.163.0) ────────────────────────
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
};

/* Wniosek anulowany NIE liczy się jak istniejący. `DELETE` zostawia go ze
   statusem `CANCELLED`, a gdyby blokował pozycję, jedna pomyłka odbierałaby
   rabat na zawsze. */
const MARTWE = new Set(["CANCELLED"]);
const PRZYZNANE = new Set(["GRANTED"]);
const ODRZUCONE = new Set(["REJECTED", "REJECTED_AFTER_APPEAL"]);

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
    prowizjaGrosze: null, waluta: null, typ: null, powod,
  });

  const w = database.prepare(`SELECT z.order_id FROM zwrot_klienta_pozycja p
    JOIN zwrot_klienta z ON z.id = p.zwrot_id WHERE p.id = ?`)
    .get(pozycjaZwrotuId) as { order_id: string | null } | undefined;
  if (!w) return pusty("Nie znaleziono pozycji zwrotu");
  if (!w.order_id) return pusty("Allegro nie podało numeru zamówienia dla tego zwrotu");

  const cel = pozycjaDoWniosku(database, pozycjaZwrotuId);
  if (!cel) {
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
    return { ...wspolne, stan: "brak", wniosekId: null, prowizjaGrosze: null,
      waluta: null, typ: null };
  }
  const status = String(zywy.status ?? "");
  return {
    ...wspolne,
    stan: PRZYZNANE.has(status) ? "przyznany" : ODRZUCONE.has(status) ? "odrzucony" : "zlozony",
    wniosekId: String(zywy.external_id),
    prowizjaGrosze: zywy.prowizja_grosze == null ? null : Number(zywy.prowizja_grosze),
    waluta: zywy.waluta == null ? null : String(zywy.waluta),
    typ: zywy.typ == null ? null : String(zywy.typ),
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

/** Statusy zwrotu, przy których Allegro samo mówi, że wniosek już był. */
const JUZ_W_ALLEGRO = new Set(["COMMISSION_REFUND_CLAIMED", "COMMISSION_REFUNDED"]);

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
  /* STRAŻNIK PIERWSZY: nasze lustro wniosków. */
  if (stan.stan !== "brak") {
    throw new RabatConflict(
      `Wniosek o rabat już istnieje (${stan.wniosekId}), status: ${stan.stan}.`);
  }

  const z = database.prepare(`SELECT z.id, z.status_allegro FROM zwrot_klienta_pozycja p
    JOIN zwrot_klienta z ON z.id = p.zwrot_id WHERE p.id = ?`)
    .get(pozycjaZwrotuId) as { id: number; status_allegro: string | null };
  /* STRAŻNIK DRUGI: wniosek mógł powstać poza panelem — w panelu Allegro albo
     ich własnym automatem (`type: AUTOMATIC` w 40 rekordach na 100). Nasze
     lustro wtedy o nim nie wie, ale zwrot niesie status. */
  if (JUZ_W_ALLEGRO.has(String(z.status_allegro ?? ""))) {
    throw new RabatConflict(
      `Allegro podaje przy tym zwrocie status ${z.status_allegro} — prowizja jest ` +
      "już objęta wnioskiem. Drugi wniosek byłby osobnym zgłoszeniem.");
  }

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
