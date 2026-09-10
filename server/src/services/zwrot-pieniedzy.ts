import { randomUUID } from "node:crypto";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Zwrot pieniędzy i odmowa w Allegro (0.190.0) ────────────────────────────

   DO 0.190.0 PANEL KOŃCZYŁ PRACĘ W POŁOWIE. Operator rozstrzygał zwrot,
   zaznaczał pozycje, dostawał policzoną kwotę — i szedł oddać pieniądze do
   panelu Allegro, czyli dokładnie tam, gdzie §25 obiecuje nie zaglądać.
   Panel zapisywał sam FAKT, że to się stało, i wierzył człowiekowi na słowo.

   DWIE KOŃCÓWKI, DWA RÓŻNE KSZTAŁTY. Zwrot pieniędzy to
   `POST /payments/refunds` w wersji `public.v1` i uprawnieniu
   `allegro:api:payments:write`. Odmowa to
   `POST /order/customer-returns/{id}/rejection` w wersji `beta.v1`
   i uprawnieniu `allegro:api:orders:write`. Oba kształty czytane ze SCHEMATU
   w `docs/allegro/swagger.yaml`, nie z przykładów i nie z pamięci.

   IDEMPOTENCJA JEST TU JEDYNĄ OSŁONĄ PRZED DRUGIM PRZELEWEM. `commandId`
   powstaje RAZ na zwrot i wraca ten sam przy każdej próbie. Sieć zerwana po
   wysłaniu żądania, a przed odpowiedzią, jest scenariuszem normalnym, nie
   wyjątkowym — a bez stałego identyfikatora ponowienie oddałoby pieniądze
   drugi raz. To jest różnica względem rabatu (`services/rabaty.ts`), gdzie
   końcówka idempotencji NIE MA i strażnik musiał być w całości nasz.

   Wysyłkę wstrzykujemy, tak jak przy rabacie: test nie ma prawa potrzebować
   sieci, a kolejność „najpierw Allegro, potem nasz zapis" ma być widoczna.  */

export class ZwrotPieniedzyConflict extends Error {}

/**
 * Statusy zwrotu, przy których PŁATNOŚĆ JEST ODDANA.
 *
 * Ze SCHEMATU `CustomerReturn.status` w `docs/allegro/swagger.yaml`:
 * `FINISHED` to „the payment has been refunded", `FINISHED_APT` to to samo
 * ręką Allegro Protect. Dla nas obie znaczą jedno — pieniądze są u klienta —
 * bo różnica mówi, KTO zapłacił, a nie CZY.
 *
 * Mieszka TUTAJ, choć czyta to także kolejka (`zwroty.ts`): to jest wiedza
 * o pieniądzach, a dwie kopie tej listy rozjechałyby się przy pierwszym
 * nowym statusie — i wtedy kolejka mówiłaby co innego niż przycisk.
 */
export const STATUSY_ODDANE = new Set(["FINISHED", "FINISHED_APT"]);

/** Kody odmowy ze schematu `CustomerReturnRefundRejectionRequest`. */
export const KODY_ODMOWY = [
  "REFUND_REJECTED", "NEW_ITEM_SENT", "ITEM_FIXED", "MISSING_PART_SENT",
  "ITEM_MISMATCH", "BUSINESS_PURCHASE", "NO_RETURN_RIGHT",
] as const;
export type KodOdmowy = (typeof KODY_ODMOWY)[number];

/* `reason` jest wymagany WYŁĄCZNIE przy `REFUND_REJECTED` — tak mówi opis
   pola w schemacie. Przy pozostałych kodach powód jest opcjonalny i nadal
   wolno go podać. */
const KOD_Z_POWODEM: KodOdmowy = "REFUND_REJECTED";
/** `maxLength: 250` ze schematu. Ucięcie po stronie Allegro byłoby 400. */
const LIMIT_POWODU = 250;

/**
 * Powód zwrotu w słowniku Allegro (`InitializeRefund.reason`).
 *
 * Bierzemy `REFUND` — zwrot towaru przez kupującego. `COMPLAINT` to
 * reklamacja, a te chodzą u nas osobną drogą; pozostałe pięć wartości opisuje
 * sytuacje, których ten ekran nie obsługuje. Wartość jest STAŁA i to jest
 * decyzja: menu z siedmioma powodami kazałoby operatorowi wybierać przy
 * każdym zwrocie coś, co w tym przebiegu ma zawsze tę samą odpowiedź.
 */
const POWOD_ZWROTU = "REFUND";

type Wiersz = {
  id: number; external_id: string; order_id: string | null;
  channel_account_id: number; wersja: number;
  werdykt: string | null; zamkniety_at: string | null;
  kwota_grosze: number | null; kwota_dostawa_grosze: number | null;
  waluta: string | null;
  platnosc_id: string | null; platnosc_typ: string | null;
  zwrot_pieniedzy_id: string | null; zwrot_pieniedzy_command_id: string | null;
  zwrot_pieniedzy_status: string | null; zwrot_pieniedzy_at: string | null;
  odmowa_kod: string | null; odmowa_powod: string | null; odmowa_at: string | null;
  status_allegro: string | null;
  przelew_at: string | null; przelew_przez: string | null;
  przelew_referencja: string | null;
};

const wczytaj = (database: Db, zwrotId: number): Wiersz => {
  const w = database.prepare(`SELECT z.id, z.external_id, z.order_id, z.channel_account_id,
      z.wersja, z.werdykt, z.zamkniety_at, z.kwota_grosze, z.kwota_dostawa_grosze,
      z.zwrot_pieniedzy_id, z.zwrot_pieniedzy_command_id,
      z.zwrot_pieniedzy_status, z.zwrot_pieniedzy_at,
      z.odmowa_kod, z.odmowa_powod, z.odmowa_at, z.status_allegro,
      z.przelew_at, z.przelew_przez, z.przelew_referencja,
      o.platnosc_id, o.platnosc_typ, o.waluta
    FROM zwrot_klienta z
    LEFT JOIN zamowienie_klienta o
      ON o.external_id = z.order_id AND o.channel_account_id = z.channel_account_id
    WHERE z.id = ?`).get(zwrotId) as Wiersz | undefined;
  if (!w) throw new Error("Nie znaleziono zwrotu");
  return w;
};

/** Co widać na ekranie przy przycisku. Zdanie o przeszkodzie pisze SERWER. */
export type StanZwrotuPieniedzy = {
  moznaZwrocic: boolean;
  moznaOdmowic: boolean;
  /** Dlaczego nie da się oddać pieniędzy. `null` = da się. */
  powod: string | null;
  kwotaGrosze: number | null;
  waluta: string;
  oddane: {
    id: string | null; status: string | null; kiedy: string | null;
    /**
     * Czy ALLEGRO potwierdziło, że pieniądze wyszły.
     *
     * `status` to odpowiedź na nasze polecenie sprzed chwili; to pole mówi,
     * co Allegro sądzi o zwrocie TERAZ. Do 0.209.0 ekran pokazywał wyłącznie
     * to pierwsze i przez to nie umiał odróżnić przelewu udanego od
     * przyjętego-i-odrzuconego.
     */
    potwierdzone: boolean;
  } | null;
  odmowa: { kod: string; powod: string | null; kiedy: string | null } | null;
  /**
   * Ślad po przelewie oddanym POZA Allegro (0.269.0) — przy pobraniu jedyny,
   * jaki może istnieć. To notatka biura o ruchu pieniędzy, nie sam ruch:
   * dlatego wolno ją cofnąć, inaczej niż zwrot przez Allegro.
   */
  przelew: { kiedy: string; przez: string | null; referencja: string | null } | null;
  /** Czy da się zapisać taki ślad; `powodPrzelewu` mówi, czego brakuje. */
  moznaZapisacPrzelew: boolean;
  powodPrzelewu: string | null;
};

/**
 * Czy wolno zapisać ślad po przelewie oddanym poza Allegro (0.269.0).
 *
 * Osobna bramka od `moznaZwrocic`, bo to DRUGA DROGA, nie wariant pierwszej.
 * Przy pobraniu Allegro nie trzymało tych pieniędzy i pierwsza droga jest
 * zamknięta z definicji; przy pozostałych płatnościach ta droga jest wyjściem
 * awaryjnym — przelew ręką zdarza się, gdy Allegro odmówi.
 *
 * NIE PATRZY na `zamkniety_at`. Zwrot zamyka korekta, a przelew idzie zwykle
 * PO niej; bramka na stanie końcowym kazałaby wybierać między poprawną
 * kolejnością pracy a zapisaniem prawdy.
 *
 * Werdykt i kwota są wymagane, bo bez nich zdanie „oddaliśmy" nie ma o czym
 * mówić: nie wiadomo, ile miało wyjść ani czy w ogóle przyjęliśmy zwrot.
 */
function bramkaPrzelewu(w: Wiersz): { moznaZapisacPrzelew: boolean; powodPrzelewu: string | null } {
  const nie = (powod: string) => ({ moznaZapisacPrzelew: false, powodPrzelewu: powod });
  if (w.przelew_at) return nie("Przelew jest już zapisany — cofnij go, żeby poprawić.");
  if (w.zwrot_pieniedzy_id) return nie("Pieniądze oddano przez panel Allegro.");
  if (w.odmowa_kod) return nie("Odmowa wypłaty jest zgłoszona — nie ma czego oddawać.");
  if (w.werdykt !== "przyjety") {
    return nie("Najpierw przyjmij zwrot — przelew zapisuje się po werdykcie.");
  }
  if (w.kwota_grosze == null) return nie("Najpierw zaznacz, co oddajemy.");
  return { moznaZapisacPrzelew: true, powodPrzelewu: null };
}

/**
 * Czy da się oddać pieniądze przez API i czego brakuje.
 *
 * PRZESZKODY SĄ WYMIENIONE PO IMIENIU, nie zwinięte w jedno „nie można".
 * Każda z nich prowadzi gdzie indziej: brak zamówienia dociąga się jednym
 * przyciskiem, pobranie oddaje się przelewem poza Allegro, a brak kwoty
 * znaczy, że operator nie skończył zaznaczania.
 */
export function stanZwrotuPieniedzy(
  database: Db = defaultDb(), zwrotId: number,
): StanZwrotuPieniedzy {
  const w = wczytaj(database, zwrotId);
  const podstawa = {
    kwotaGrosze: w.kwota_grosze == null ? null : Number(w.kwota_grosze),
    waluta: w.waluta ?? "PLN",
    /* Kolumny CZYTANE, nie zerowane. Do 0.209.0 stały tu trzy `null`-e mimo
       wypełnionych kolumn — ekran nie mówił ani kiedy przelew poszedł, ani co
       Allegro na niego odpowiedziało. Zapisane i nieodczytane pole jest
       gorsze od nieistniejącego: wygląda jak wiedza, której nie ma. */
    oddane: w.zwrot_pieniedzy_id || w.zwrot_pieniedzy_command_id
      ? {
        id: w.zwrot_pieniedzy_id,
        status: w.zwrot_pieniedzy_status,
        kiedy: w.zwrot_pieniedzy_at,
        potwierdzone: STATUSY_ODDANE.has(String(w.status_allegro ?? "")),
      }
      : null,
    odmowa: w.odmowa_kod
      ? { kod: w.odmowa_kod, powod: w.odmowa_powod, kiedy: w.odmowa_at } : null,
    przelew: w.przelew_at
      ? { kiedy: w.przelew_at, przez: w.przelew_przez, referencja: w.przelew_referencja }
      : null,
    ...bramkaPrzelewu(w),
  };
  const nie = (powod: string) =>
    ({ ...podstawa, moznaZwrocic: false, moznaOdmowic: false, powod });

  if (w.zwrot_pieniedzy_id) return nie("Pieniądze już oddano przez panel.");
  if (w.odmowa_kod) return nie("Odmowa zwrotu pieniędzy jest już zgłoszona w Allegro.");
  if (w.zamkniety_at) return nie("Zwrot jest zamknięty.");

  /* Odmówić wolno ZANIM zapadnie werdykt o kwocie — to jest osobna droga,
     nie wariant zwrotu. Oddać pieniądze wolno dopiero po przyjęciu. */
  const moznaOdmowic = true;
  if (w.werdykt !== "przyjety") {
    return { ...podstawa, moznaZwrocic: false, moznaOdmowic,
      powod: "Najpierw przyjmij zwrot — pieniądze oddaje się po werdykcie." };
  }
  if (w.kwota_grosze == null) {
    return { ...podstawa, moznaZwrocic: false, moznaOdmowic,
      powod: "Najpierw zaznacz, co oddajemy — bez kwoty nie ma czego wysłać." };
  }
  if (!w.order_id) {
    return { ...podstawa, moznaZwrocic: false, moznaOdmowic,
      powod: "Zwrot nie ma numeru zamówienia, a Allegro żąda go przy zwrocie pieniędzy." };
  }
  if (!w.platnosc_id) {
    return { ...podstawa, moznaZwrocic: false, moznaOdmowic,
      powod: "Nie znamy identyfikatora płatności — dociągnij zamówienie z Allegro." };
  }
  /* Pobranie: nie ma płatności, którą można cofnąć. Pieniądze wracają
     przelewem poza Allegro, a panel ma to powiedzieć, zamiast wysyłać
     żądanie, które skończy się odmową bez czytelnego powodu. */
  if (w.platnosc_typ === "CASH_ON_DELIVERY") {
    return { ...podstawa, moznaZwrocic: false, moznaOdmowic,
      powod: "Zamówienie za pobraniem — tych pieniędzy Allegro nie trzymało. Oddaj je przelewem." };
  }
  if (Number(w.kwota_grosze) <= 0) {
    return { ...podstawa, moznaZwrocic: false, moznaOdmowic,
      powod: "Kwota do oddania wynosi zero." };
  }
  return { ...podstawa, moznaZwrocic: true, moznaOdmowic, powod: null };
}

/** Wysyłka zwrotu pieniędzy. Wstrzykiwana, żeby test nie potrzebował sieci. */
export type NadawcaZwrotu = (
  ciało: Record<string, unknown>,
) => Promise<{ id?: string; status?: string } | null>;

/** Wysyłka odmowy. Ta sama zasada. */
export type NadawcaOdmowy = (
  zwrotExternalId: string, kod: string, powod: string | null,
) => Promise<unknown | null>;

/**
 * Oddanie pieniędzy kupującemu przez API Allegro.
 *
 * KOLEJNOŚĆ JEST CZĘŚCIĄ BEZPIECZEŃSTWA. `commandId` zapisujemy PRZED
 * wyjściem do sieci, a wynik PO odpowiedzi. Odwrotnie byłoby tak: żądanie
 * wychodzi, sieć pada, identyfikatora nie ma nigdzie — i ponowienie tworzy
 * drugi przelew, bo Allegro widzi nowe polecenie. Zapisany wcześniej
 * `commandId` sprawia, że druga próba jest TĄ SAMĄ próbą.
 *
 * Kwoty NIE liczymy tutaj po raz drugi. Idzie ta, którą policzył serwer przy
 * zaznaczeniu (`zapiszKwote`) — panel nie ma prawa podać liczby, a i ten
 * serwis nie ma prawa jej poprawić.
 */
export async function zwrocPieniadze(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  nadaj: NadawcaZwrotu, teraz = new Date(),
): Promise<{ refundId: string; status: string | null; wersja: number }> {
  const stan = stanZwrotuPieniedzy(database, zwrotId);
  if (!stan.moznaZwrocic) {
    throw new ZwrotPieniedzyConflict(stan.powod ?? "Nie da się oddać pieniędzy dla tego zwrotu");
  }
  const w = wczytaj(database, zwrotId);
  if (Number(w.wersja) !== wersja) {
    throw new ZwrotPieniedzyConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.");
  }

  /* Identyfikator polecenia: ten sam przy ponowieniu. Gdy już jest, znaczy to
     próbę, która nie doszła do końca — i właśnie po to go trzymamy. */
  const commandId = w.zwrot_pieniedzy_command_id ?? randomUUID();
  if (!w.zwrot_pieniedzy_command_id) {
    database.prepare("UPDATE zwrot_klienta SET zwrot_pieniedzy_command_id=? WHERE id=?")
      .run(commandId, zwrotId);
  }

  const kwota = Number(w.kwota_grosze);
  const dostawa = w.kwota_dostawa_grosze == null ? 0 : Number(w.kwota_dostawa_grosze);
  const waluta = w.waluta ?? "PLN";
  const naZlote = (grosze: number) => (grosze / 100).toFixed(2);

  /* Cztery pola wymagane wprost przez schemat `InitializeRefund`: `payment`,
     `order`, `commandId`, `reason`. `delivery` idzie tylko wtedy, gdy operator
     zaznaczył dostawę — pole z zerem znaczyłoby „oddaj zero za dostawę",
     czyli co innego niż jego pominięcie. */
  const ciało: Record<string, unknown> = {
    payment: { id: w.platnosc_id },
    order: { id: w.order_id },
    commandId,
    reason: POWOD_ZWROTU,
  };
  if (dostawa > 0) {
    ciało.delivery = { value: { amount: naZlote(dostawa), currency: waluta } };
  }

  const odp = await nadaj(ciało);
  const refundId = typeof odp?.id === "string" ? odp.id : null;
  if (!refundId) {
    throw new Error(
      "Allegro nie oddało numeru zwrotu płatności — sprawdź w panelu Allegro, " +
      "czy pieniądze wyszły, zanim spróbujesz ponownie.");
  }
  const status = typeof odp?.status === "string" ? odp.status : null;

  const at = teraz.toISOString();
  transaction(database, () => {
    database.prepare(`UPDATE zwrot_klienta
      SET zwrot_pieniedzy_id=?, zwrot_pieniedzy_status=?, zwrot_pieniedzy_at=?,
          zwrot_pieniedzy_przez=?, zwrot_pieniedzy_user_id=?, wersja=wersja+1
      WHERE id=?`).run(refundId, status, at, kto.name, kto.id, zwrotId);

    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(zwrotId, "pieniadze",
        `Oddano ${naZlote(kwota)} ${waluta} przez Allegro (${refundId})`,
        JSON.stringify({ refundId, status, commandId, kwotaGrosze: kwota,
          dostawaGrosze: dostawa }),
        at, kto.name, kto.id);

    logEvent("zwrot_pieniadze_oddane", kto.name, null,
      { zwrotId, refundId, status, kwotaGrosze: kwota }, kto.id, database);
  })();

  return { refundId, status, wersja: wersja + 1 };
}

/**
 * Odmowa zwrotu pieniędzy w Allegro.
 *
 * NAZWA MÓWI O PIENIĄDZACH, nie o zwrocie. Kupujący dalej ma otwarty zwrot;
 * my odmawiamy wypłaty i podajemy kod. Nasz werdykt `odrzucony` jest czym
 * innym — to decyzja biura, która do tej pory nigdzie nie wychodziła.
 */
export async function odmowZwrotuPieniedzy(
  database: Db, zwrotId: number, kod: string, powod: string | null, wersja: number,
  kto: { id: number; name: string }, nadaj: NadawcaOdmowy, teraz = new Date(),
): Promise<{ kod: string; wersja: number }> {
  if (!(KODY_ODMOWY as readonly string[]).includes(kod)) {
    throw new Error(`Nieznany kod odmowy: ${kod}`);
  }
  const uzasadnienie = (powod ?? "").trim();
  if (kod === KOD_Z_POWODEM && uzasadnienie === "") {
    throw new Error("Ten kod odmowy wymaga powodu — bez niego Allegro odrzuci żądanie.");
  }
  if (uzasadnienie.length > LIMIT_POWODU) {
    throw new Error(`Powód odmowy ma najwyżej ${LIMIT_POWODU} znaków.`);
  }

  const stan = stanZwrotuPieniedzy(database, zwrotId);
  if (!stan.moznaOdmowic) {
    throw new ZwrotPieniedzyConflict(stan.powod ?? "Nie da się odmówić przy tym zwrocie");
  }
  const w = wczytaj(database, zwrotId);
  if (Number(w.wersja) !== wersja) {
    throw new ZwrotPieniedzyConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.");
  }

  await nadaj(w.external_id, kod, uzasadnienie === "" ? null : uzasadnienie);

  const at = teraz.toISOString();
  transaction(database, () => {
    database.prepare(`UPDATE zwrot_klienta
      SET odmowa_kod=?, odmowa_powod=?, odmowa_at=?, odmowa_przez=?, odmowa_user_id=?,
          wersja=wersja+1
      WHERE id=?`).run(kod, uzasadnienie === "" ? null : uzasadnienie, at,
        kto.name, kto.id, zwrotId);

    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(zwrotId, "odmowa", `Odmówiono zwrotu pieniędzy w Allegro (${kod})`,
        JSON.stringify({ kod, powod: uzasadnienie || null }), at, kto.name, kto.id);

    logEvent("zwrot_pieniadze_odmowa", kto.name, null,
      { zwrotId, kod, powod: uzasadnienie || null }, kto.id, database);
  })();

  return { kod, wersja: wersja + 1 };
}

/* ── Przelew oddany poza Allegro (0.269.0) ───────────────────────────────────
   Przy pobraniu klient nigdy nie zapłacił Allegro, więc Allegro nie ma czego
   oddawać: pieniądze wracają przelewem z banku firmy. Panel mówił o tym
   zdaniem od 0.190.0 i na tym kończył — zwrot zamykał się bez ŚLADU po
   wypłacie, a jedynym dowodem był wyciąg bankowy poza aplikacją. Przy sporze
   z klientem odpowiedź „oddaliśmy" nie miała się o co oprzeć.

   TO NOTATKA O RUCHU PIENIĘDZY, NIE SAM RUCH. Aplikacja niczego tu nie
   wysyła; zapisuje, co zrobił człowiek w banku. Dlatego wolno ją cofnąć —
   §25a.5 potwierdzeniem obwarowuje rzeczy NIEODWRACALNE, a pomyłka
   w numerze przelewu odwracalna jest. Cofnięcie zostawia własny ślad na osi,
   więc audyt widzi obie decyzje.

   REFERENCJA JEST OPCJONALNA. Numer przelewu bywa znany dopiero z wyciągu,
   a wymóg zmusiłby do wpisania czegokolwiek albo do odłożenia zapisu na
   później — czyli do stanu, który to wydanie usuwa.                        */

/** Ile znaków referencji zapisujemy. Tytuł przelewu w banku bywa długi. */
export const LIMIT_REFERENCJI = 140;

export function zapiszPrzelew(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  referencja: string | null, teraz = new Date(),
): { kiedy: string; wersja: number } {
  const w = wczytaj(database, zwrotId);
  const bramka = bramkaPrzelewu(w);
  if (!bramka.moznaZapisacPrzelew) {
    throw new ZwrotPieniedzyConflict(bramka.powodPrzelewu ?? "Nie da się zapisać przelewu");
  }
  if (Number(w.wersja) !== wersja) {
    throw new ZwrotPieniedzyConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.");
  }
  const ref = (referencja ?? "").trim().slice(0, LIMIT_REFERENCJI) || null;
  const at = teraz.toISOString();
  transaction(database, () => {
    database.prepare(`UPDATE zwrot_klienta
      SET przelew_at=?, przelew_przez=?, przelew_user_id=?, przelew_referencja=?,
          wersja=wersja+1
      WHERE id=?`).run(at, kto.name, kto.id, ref, zwrotId);
    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(zwrotId, "przelew",
        ref ? `Pieniądze oddane przelewem (${ref})` : "Pieniądze oddane przelewem",
        JSON.stringify({ referencja: ref, kwotaGrosze: w.kwota_grosze }), at, kto.name, kto.id);
    logEvent("zwrot_przelew", kto.name, null,
      { zwrotId, referencja: ref, kwotaGrosze: w.kwota_grosze }, kto.id, database);
  })();
  return { kiedy: at, wersja: wersja + 1 };
}

/**
 * Cofnięcie zapisu — droga wyjścia z pomyłki, nie brak funkcji (§25a.5).
 *
 * Nie pyta o wersję zwrotu w drugą stronę niż zapis: ten sam wzorzec co przy
 * cofaniu kwoty i korekty, bo cofa się TĘ decyzję, a nie stan całego zwrotu.
 */
export function cofnijPrzelew(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { wersja: number } {
  const w = wczytaj(database, zwrotId);
  if (!w.przelew_at) throw new ZwrotPieniedzyConflict("Ten zwrot nie ma zapisanego przelewu.");
  if (Number(w.wersja) !== wersja) {
    throw new ZwrotPieniedzyConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.");
  }
  const at = teraz.toISOString();
  transaction(database, () => {
    database.prepare(`UPDATE zwrot_klienta
      SET przelew_at=NULL, przelew_przez=NULL, przelew_user_id=NULL,
          przelew_referencja=NULL, wersja=wersja+1
      WHERE id=?`).run(zwrotId);
    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(zwrotId, "przelew_cofniety", "Cofnięto zapis o przelewie",
        JSON.stringify({ bylo: w.przelew_at, referencja: w.przelew_referencja }),
        at, kto.name, kto.id);
    logEvent("zwrot_przelew_cofniety", kto.name, null,
      { zwrotId, bylo: w.przelew_at }, kto.id, database);
  })();
  return { wersja: wersja + 1 };
}
