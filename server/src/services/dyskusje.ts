import { db, nowIso } from "../db/db.js";
import { metaWatku, stempelWyslano, zapiszMetaDyskusji } from "./watek-meta.js";
import { przebudujSprawy } from "./sprawa.js";
import { dopiszZdarzenie } from "./os-sprawy.js";
import { uruchomTakt } from "./takt.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { allegroAdapter, LIMIT_WIADOMOSCI } from "../adapters/allegro.js";
import type { WiadomoscDyskusji } from "../adapters/allegro.js";
import { stanPolaczenia } from "./allegro-token.js";
import { terminReklamacji } from "./reklamacje.js";
import { aiTryb, generujOdpowiedz, stanAI, zbudujSystem } from "./ai.js";
import { pobierzKonfiguracje } from "./pytania.js";
import { kontekstKlienta } from "./klienci.js";

export type { WiadomoscDyskusji } from "../adapters/allegro.js";

/* ── Dyskusje i reklamacje Allegro — rejestr pracy biura ─────────────────────
   Do tej pory sekcja dyskusji była podglądem na kliknięcie: przycisk pobierał
   listę z API i nic nie zostawało. To wystarczało, żeby ZOBACZYĆ sprawy, ale
   nie żeby je PROWADZIĆ — sprawa bez właściciela i bez statusu potrafiła
   czekać niezauważona aż do terminu ustawowego, a przy dwóch biurkach dwie
   osoby brały tę samą.

   Ten moduł powtarza wzorzec `pytania.ts`. Od 0.104.0 ma też ścieżkę
   odpowiedzi: rozmowę czyta się i pisze przez `/sale/disputes` (sekcja
   „Rozmowa i odpowiedź" niżej), więc sprawa od zgłoszenia do odpowiedzi
   toczy się w aplikacji. Lokalnie zostaje to, czego panel Allegro nie daje:
   kolejka z priorytetem wg terminu, właściciel sprawy, notatka z ustaleń,
   powiązanie ze zwrotem po numerze zamówienia oraz nasz szkic i odpowiedź.  */

/** Awaria pracy z dyskusją. `kod` niesie status HTTP dla trasy (wzorzec BladPytania). */
export class BladDyskusji extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladDyskusji";
  }
}

/** Lokalne statusy — dozwolone przejścia ręką biura (`nowa` nadaje sync). */
export const STATUSY_DYSKUSJI = ["w_toku", "zamknieta", "pominieta"] as const;

/**
 * Statusy Allegro, po których sprawę zamykamy automatem. [WERYFIKUJ] na
 * własnym koncie: `/sale/issues` jest w becie i lista wartości końcowych nie
 * jest udokumentowana do końca. Nazwa spoza listy zostawia sprawę otwartą —
 * degradacja w stronę ręcznego ZAMKNIJ, nie błąd.
 */
export const FINALNE_STATUSY_ALLEGRO = ["CLOSED", "ENDED", "FINISHED"] as const;

/**
 * Statusy Allegro, które ZNAMY jako otwarte. [WERYFIKUJ] jak lista finalnych:
 * wartości spoza obu list nie są błędem — sync je liczy i pokazuje biuru,
 * żeby właściciel potwierdził na żywym koncie, czy to sprawa otwarta, czy
 * końcowa, której nie zamykamy. To jest mechanizm weryfikacji listy
 * finalnych, nie ozdoba.
 */
export const ZNANE_STATUSY_OTWARTE = ["ONGOING", "NEW"] as const;

/**
 * Rozkład statusów przebiegu + wartości, których nie zna żadna lista.
 * Czysta funkcja — testuje się bez adaptera i bez bazy.
 */
export function podzielStatusy(sprawy: Array<{ status: string | null }>): {
  statusy: Record<string, number>;
  nieznane: string[];
} {
  const statusy: Record<string, number> = {};
  for (const s of sprawy) {
    const nazwa = s.status ?? "(brak)";
    statusy[nazwa] = (statusy[nazwa] ?? 0) + 1;
  }
  const znane: readonly string[] = [...FINALNE_STATUSY_ALLEGRO, ...ZNANE_STATUSY_OTWARTE];
  const nieznane = Object.keys(statusy)
    .filter((n) => n !== "(brak)" && !znane.includes(n))
    .sort();
  return { statusy, nieznane };
}

export interface Dyskusja {
  id: number;
  allegroId: string;
  typ: string | null;
  statusAllegro: string | null;
  status: string;
  temat: string | null;
  kupujacyLogin: string | null;
  orderId: string | null;
  utworzonoAllegro: string | null;
  zwrotId: number | null;
  notatka: string | null;
  prowadzi: string | null;
  prowadziAt: string | null;
  zamknietoAt: string | null;
  zamknietoPrzez: string | null;
  /** Termin ustawowy — tylko dla typu CLAIM; rozmowa (DISCUSSION) nie ma zegara. */
  termin: string | null;
  dniDoTerminu: number | null;
  poTerminie: boolean;
  /** Szkic modelu i nasza odpowiedź (0.104.0) — wzorzec pytań. */
  szkicAi: string | null;
  szkicAt: string | null;
  odpowiedz: string | null;
  edytowano: boolean;
  /** OSTATNIA wysyłka — dyskusja to wiele odpowiedzi, historia w events. */
  wyslanoAt: string | null;
  odpowiedzial: string | null;
}

const tekstLubNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

function zWiersza(w: Record<string, unknown>, teraz: number = Date.now()): Dyskusja {
  /* Termin liczymy, nie pobieramy: `/sale/issues` nie zwraca żadnego zegara,
     a dla CLAIM obowiązuje ten sam termin ustawowy co przy reklamacjach ze
     zwrotów — więc liczy go ta sama funkcja, od zgłoszenia w Allegro. */
  const utworzono = tekstLubNull(w.utworzono_allegro);
  const claim = (w.typ as string | null) === "CLAIM" && utworzono !== null;
  const t = claim ? terminReklamacji(utworzono!, teraz) : null;
  return {
    id: w.id as number,
    allegroId: w.allegro_id as string,
    typ: tekstLubNull(w.typ),
    statusAllegro: tekstLubNull(w.status_allegro),
    status: w.status as string,
    temat: tekstLubNull(w.temat),
    kupujacyLogin: tekstLubNull(w.kupujacy_login),
    orderId: tekstLubNull(w.order_id),
    utworzonoAllegro: utworzono,
    zwrotId: (w.zwrot_id as number) ?? null,
    notatka: tekstLubNull(w.notatka),
    prowadzi: tekstLubNull(w.prowadzi),
    prowadziAt: tekstLubNull(w.prowadzi_at),
    zamknietoAt: tekstLubNull(w.zamknieto_at),
    zamknietoPrzez: tekstLubNull(w.zamknieto_przez),
    termin: t?.termin ?? null,
    dniDoTerminu: t?.dniDoTerminu ?? null,
    poTerminie: t ? t.dniDoTerminu < 0 : false,
    szkicAi: tekstLubNull(w.szkic_ai),
    szkicAt: tekstLubNull(w.szkic_at),
    odpowiedz: tekstLubNull(w.odpowiedz),
    edytowano: (w.edytowano as number) === 1,
    wyslanoAt: tekstLubNull(w.wyslano_at),
    odpowiedzial: tekstLubNull(w.odpowiedzial),
  };
}

function wiersz(id: number): Record<string, unknown> {
  const w = db().prepare("SELECT * FROM dyskusja WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!w) throw new BladDyskusji("Nie ma takiej dyskusji", 404);
  return w;
}

export function szczegolDyskusji(id: number): Dyskusja {
  return zWiersza(wiersz(id));
}

export function listaDyskusji(opcje: { status?: string; limit?: number } = {}): Dyskusja[] {
  const limit = Math.min(Math.max(opcje.limit ?? 100, 1), 500);
  /* Domyślnie WORKLISTA (nowe + w toku), nie archiwum — ta sama zasada co
     `listaPytan`. Filtr statusu i tryb `wszystkie` dają wgląd w resztę. */
  const wszystko = opcje.status === "wszystkie";
  const sql = wszystko
    ? "SELECT * FROM dyskusja ORDER BY utworzono_allegro DESC, id DESC LIMIT ?"
    : opcje.status
      ? "SELECT * FROM dyskusja WHERE status = ? ORDER BY utworzono_allegro DESC, id DESC LIMIT ?"
      : `SELECT * FROM dyskusja WHERE status IN ('nowa','w_toku')
         ORDER BY utworzono_allegro DESC, id DESC LIMIT ?`;
  const args = !wszystko && opcje.status ? [opcje.status, limit] : [limit];
  const teraz = Date.now();
  const lista = (db().prepare(sql).all(...args) as Array<Record<string, unknown>>).map((w) =>
    zWiersza(w, teraz)
  );
  /* Na workliście CLAIM-y z zegarem idą PRZED rozmowami, najpilniejsze na
     górze — pytanie biura brzmi „co się dziś przeterminuje", jak przy
     reklamacjach ze zwrotów. Archiwum zostaje chronologiczne. */
  if (!wszystko && !opcje.status) {
    lista.sort((a, b) => {
      if (a.dniDoTerminu !== null && b.dniDoTerminu !== null) {
        return a.dniDoTerminu - b.dniDoTerminu;
      }
      if (a.dniDoTerminu !== null) return -1;
      if (b.dniDoTerminu !== null) return 1;
      return 0; // rozmowy zostają w kolejności z SQL (najświeższe na górze)
    });
  }
  return lista;
}

/** Liczby do licznika na zakładce — odpytywane co 30 s, więc same COUNT-y. */
export function licznikDyskusji(): { nowe: number; wToku: number; claimyPoTerminie: number } {
  const w = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'nowa'   THEN 1 ELSE 0 END) AS nowe,
         SUM(CASE WHEN status = 'w_toku' THEN 1 ELSE 0 END) AS w_toku
       FROM dyskusja`
    )
    .get() as { nowe: number | null; w_toku: number | null };
  /* Przeterminowane CLAIM-y liczymy w JS, nie w SQL: termin to arytmetyka
     `terminReklamacji` i drugie jej wydanie w SQL rozjechałoby się z listą. */
  const claimy = db()
    .prepare(
      `SELECT utworzono_allegro FROM dyskusja
       WHERE typ = 'CLAIM' AND status IN ('nowa','w_toku') AND utworzono_allegro IS NOT NULL`
    )
    .all() as Array<{ utworzono_allegro: string }>;
  const teraz = Date.now();
  const poTerminie = claimy.filter(
    (c) => terminReklamacji(c.utworzono_allegro, teraz).dniDoTerminu < 0
  ).length;
  return { nowe: w.nowe ?? 0, wToku: w.w_toku ?? 0, claimyPoTerminie: poTerminie };
}

export interface WynikSynchronizacjiDyskusji {
  nowych: number;
  zamknietychPrzezAllegro: number;
  przejrzanych: number;
  /* Metadane rozmów otwartych spraw (0.129.0). Trzy kubełki domykają liczbę
     otwartych dyskusji: pobrane, niedostępne przez API i odłożone przez
     sufit. Suma bez rozbicia kłamałaby tak samo jak „przejrzano 2, nowych 0"
     przy pytaniach — patrz `pominiete` w services/pytania.ts. */
  rozmow: number;
  bezRozmowy: number;
  pominietychRozmow: number;
}

/**
 * Ślad ostatniego pobrania — na ekran biura. W PAMIĘCI, nie w bazie, z tych
 * samych powodów co `stanSynchronizacji` przy pytaniach: po restarcie „nie
 * wiem, kiedy ostatnio pytaliśmy" jest prawdą, nie brakiem danych.
 */
export interface StanSynchronizacjiDyskusji {
  at: string;
  przez: string;
  nowych: number;
  zamknietychPrzezAllegro: number;
  przejrzanych: number;
  rozmow: number;
  bezRozmowy: number;
  pominietychRozmow: number;
  /* Wartości `status_allegro` spoza znanych list — do potwierdzenia przez
     właściciela na żywym koncie (patrz ZNANE_STATUSY_OTWARTE). */
  nieznaneStatusy: string[];
}

let stanSynchronizacji: StanSynchronizacjiDyskusji | null = null;

export function stanSynchronizacjiDyskusji(): StanSynchronizacjiDyskusji | null {
  return stanSynchronizacji;
}

/** Powiązany zwrot po numerze zamówienia; NULL = zwrot jeszcze nie przyjechał. */
function znajdzZwrot(orderId: string | null): number | null {
  if (!orderId) return null;
  const w = db()
    .prepare("SELECT id FROM zwrot WHERE allegro_order_id = ? ORDER BY id DESC LIMIT 1")
    .get(orderId) as { id: number } | undefined;
  return w?.id ?? null;
}

/**
 * Ile rozmów wolno dociągnąć w JEDNYM pobraniu (0.129.0).
 *
 * Metadanych rozmowy `/sale/issues` nie zwraca — trzeba po nie pójść osobno,
 * jeden GET na sprawę. Bez sufitu konto z setkami otwartych dyskusji
 * zamieniłoby jedno kliknięcie w kilkuminutowe zawieszenie przycisku.
 * Sto spraw to około pół minuty; reszta dogania się w kolejnych pobraniach,
 * a licznik na ekranie mówi, ile czeka.
 */
const SUFIT_ROZMOW = 100;

/**
 * Metadane rozmów otwartych spraw — piłka („kto ma ruch") dla dyskusji.
 *
 * Kolejność jest częścią projektu, nie ozdobą: najpierw sprawy bez żadnych
 * metadanych, potem te z najstarszymi. Stały porządek (np. po id) sprawiłby,
 * że po przekroczeniu sufitu ten sam ogon zostaje ślepy w nieskończoność.
 *
 * TREŚCI NIE ZAPISUJEMY — rozmowa przelatuje tędy tylko po to, żeby policzyć
 * metadane (zasada prywatności; patrz services/watek-meta.ts).
 */
/**
 * Głosy z rozmowy na oś czasu sprawy (0.130.0) — SAM FAKT, nigdy treść.
 *
 * Rozmowa przelatuje przez sync po metadane piłki, więc oś czasu dostaje ją
 * za darmo: bez tego historia dyskusji zaczynałaby się dopiero od naszej
 * pierwszej odpowiedzi. Id wiadomości jest wariantem klucza, więc kolejne
 * pobrania tej samej rozmowy niczego nie dublują.
 *
 * Zapisujemy tylko CUDZE głosy: nasze wysyłki mają własne zdarzenie
 * z chwili wysłania, a wysyłka spoza WERTIS (panel Allegro) i tak jest
 * ruchem, którego nasza historia nie widziała.
 */
function glosyNaOsCzasu(dyskusjaId: number, lista: WiadomoscDyskusji[]): void {
  for (const w of lista) {
    if (w.odNas) continue;
    /* Mediator Allegro to trzeci głos w sprawie — osobny typ, nie tylko inny
       kolor: „klient napisał" o wiadomości od Allegro byłoby nieprawdą. */
    const odAllegro = w.autorRola === "ALLEGRO_ADVISOR";
    dopiszZdarzenie({
      rodzaj: "dyskusja",
      lokalnyId: dyskusjaId,
      typ: odAllegro ? "allegro_napisalo" : "klient_napisal",
      kto: odAllegro ? "allegro" : "klient",
      kiedy: w.at ?? undefined,
      wariant: w.id,
    });
  }
}

async function dociagnijRozmowy(): Promise<{
  rozmow: number;
  bezRozmowy: number;
  pominietychRozmow: number;
}> {
  const otwarte = db()
    .prepare(
      `SELECT d.id AS id, d.allegro_id AS allegro_id
         FROM dyskusja d
         LEFT JOIN watek_meta m ON m.rodzaj = 'dyskusja' AND m.allegro_id = d.allegro_id
        WHERE d.status IN ('nowa','w_toku') AND d.allegro_id IS NOT NULL
        ORDER BY m.aktualizowano_at IS NOT NULL, m.aktualizowano_at ASC`
    )
    .all() as Array<{ id: number; allegro_id: string }>;

  const adapter = allegroAdapter();
  let rozmow = 0;
  let bezRozmowy = 0;
  const doPobrania = otwarte.slice(0, SUFIT_ROZMOW);
  for (const { id, allegro_id } of doPobrania) {
    try {
      const lista = await adapter.wiadomosciDyskusji(allegro_id);
      /* `null` = zasób w becie oddał 404: rozmowa niedostępna, nie awaria.
         Piłka takiej sprawy spada na dotychczasowy trop (`wyslano_at`). */
      if (lista === null) bezRozmowy++;
      else {
        zapiszMetaDyskusji(allegro_id, lista, "sync");
        glosyNaOsCzasu(id, lista);
        rozmow++;
      }
    } catch {
      /* Jedna sprawa nie ma prawa wywalić całego przebiegu — degradacja
         w stronę starszych metadanych, nie w stronę błędu pobrania. */
      bezRozmowy++;
    }
  }
  return { rozmow, bezRozmowy, pominietychRozmow: otwarte.length - doPobrania.length };
}

/** Jeden przebieg synchronizacji: sprawy z `/sale/issues` do lokalnego rejestru. */
export async function synchronizujDyskusje(autor: string): Promise<WynikSynchronizacjiDyskusji> {
  const sprawy = await allegroAdapter().listaDyskusji();
  const d = db();
  const teraz = nowIso();

  /* Upsert po `allegro_id` — sync widuje tę samą sprawę w każdym przebiegu.
     Odświeżamy WYŁĄCZNIE pola Allegro; status naszej pracy, prowadzący
     i notatka są nasze i żaden przebieg nie ma prawa ich cofnąć. */
  const upsert = d.prepare(
    `INSERT INTO dyskusja
       (allegro_id, typ, status_allegro, temat, kupujacy_login, order_id,
        utworzono_allegro, zwrot_id, widziano_at, utworzono_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(allegro_id) DO UPDATE SET
       typ = excluded.typ,
       status_allegro = excluded.status_allegro,
       temat = excluded.temat,
       kupujacy_login = excluded.kupujacy_login,
       order_id = excluded.order_id,
       utworzono_allegro = excluded.utworzono_allegro,
       widziano_at = excluded.widziano_at,
       zwrot_id = COALESCE(dyskusja.zwrot_id, excluded.zwrot_id)`
  );

  const istnieje = d.prepare("SELECT 1 AS jest FROM dyskusja WHERE allegro_id = ?");

  let nowych = 0;
  let zamknietychPrzezAllegro = 0;
  for (const s of sprawy) {
    if (!s.id) continue;
    /* `changes` po upsercie nie odróżnia insertu od update'u, więc nowość
       sprawdzamy wprost, PRZED zapisem — dwa procesy nie ścigają się tu
       o ten sam wiersz (sync odpala ticker albo klik, nie oba naraz). */
    const znana = istnieje.get(s.id) !== undefined;
    /* Zwrot dopasowujemy przy KAŻDYM przebiegu, nie tylko przy insercie:
       paczka bywa skanowana dni po pojawieniu się dyskusji, a COALESCE
       w upsercie pilnuje, żeby raz znalezione wiązanie już nie znikło. */
    const zwrotId = znajdzZwrot(s.orderId);
    upsert.run(
      s.id,
      s.typ,
      s.status,
      s.temat,
      s.kupujacyLogin,
      s.orderId,
      s.utworzono,
      zwrotId,
      teraz,
      teraz
    );
    if (!znana) {
      nowych++;
      /* Oś czasu (0.130.0) — id lokalne znamy dopiero po upsercie, bo klucz
         Allegro jest jedynym, który sync ma w ręku. */
      const nowa = d.prepare("SELECT id FROM dyskusja WHERE allegro_id = ?").get(s.id) as
        | { id: number }
        | undefined;
      if (nowa) {
        dopiszZdarzenie({
          rodzaj: "dyskusja",
          lokalnyId: nowa.id,
          typ: "zalozona",
          kto: "klient",
          kiedy: s.utworzono ?? teraz,
        });
      }
    }

    /* Sprawa rozstrzygnięta w panelu Allegro ma zejść z naszej kolejki sama —
       inaczej licznik kłamałby w nieskończoność o sprawach dawno zamkniętych.
       Zamykamy TYLKO otwarte i podpisujemy `allegro`, żeby audyt odróżniał
       automat od decyzji człowieka. */
    if (
      s.status &&
      (FINALNE_STATUSY_ALLEGRO as readonly string[]).includes(s.status)
    ) {
      const zamkniete = d
        .prepare(
          `UPDATE dyskusja
              SET status = 'zamknieta', zamknieto_at = ?, zamknieto_przez = 'allegro'
            WHERE allegro_id = ? AND status IN ('nowa','w_toku')`
        )
        .run(teraz, s.id);
      if (zamkniete.changes > 0) {
        zamknietychPrzezAllegro++;
        logEvent("dyskusja_zamknieta", "allegro", null, {
          allegroId: s.id,
          statusAllegro: s.status,
        });
        const zamknieta = d.prepare("SELECT id FROM dyskusja WHERE allegro_id = ?").get(s.id) as
          | { id: number }
          | undefined;
        if (zamknieta) {
          dopiszZdarzenie({
            rodzaj: "dyskusja",
            lokalnyId: zamknieta.id,
            typ: "zamknieta",
            /* Nie nasz ruch: sprawę rozstrzygnięto w panelu Allegro, a oś
               czasu ma pokazywać właśnie tę różnicę. */
            kto: "allegro",
            szczegol: s.status,
            kiedy: teraz,
            wariant: teraz,
          });
        }
      }
    }
  }

  if (nowych > 0) {
    logEvent("dyskusja_sync", autor, null, { nowych, przejrzanych: sprawy.length });
  }
  /* Status spoza znanych list idzie do dziennika RAZ NA WARTOŚĆ, nie na
     sprawę — sto spraw z tym samym dziwnym statusem to jedno zdarzenie.
     Trwały ślad plus linia na ekranie to cały mechanizm weryfikacji
     [WERYFIKUJ] przy FINALNE_STATUSY_ALLEGRO. */
  const { statusy, nieznane } = podzielStatusy(sprawy);
  for (const status of nieznane) {
    logEvent("dyskusja_status_nieznany", autor, null, { status, ile: statusy[status] });
  }
  /* Rozmowy dociągamy PO auto-zamknięciach: sprawa zamknięta w tym samym
     przebiegu nie ma po co oddawać swojej rozmowy. */
  const rozmowy = await dociagnijRozmowy();
  stanSynchronizacji = {
    at: teraz,
    przez: autor,
    nowych,
    zamknietychPrzezAllegro,
    przejrzanych: sprawy.length,
    ...rozmowy,
    nieznaneStatusy: nieznane,
  };
  /* Rejestr się zmienił — nakładka spraw dogania (0.128.0). */
  przebudujSprawy();
  return { nowych, zamknietychPrzezAllegro, przejrzanych: sprawy.length, ...rozmowy };
}

/**
 * Kto wziął sprawę — ZNACZNIK, nie zamek (ta sama doktryna co
 * `stempelProwadzi` przy pytaniach): nazwisko pojawia się przy zapisie, który
 * i tak następuje, cudzej sprawy nikt nie musi odbijać, a ostatni pracujący
 * podmienia nazwisko. Samo patrzenie na ekran niczego nie zajmuje.
 */
export function stempelProwadziDyskusji(id: number, autor: string): void {
  db()
    .prepare("UPDATE dyskusja SET prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?")
    .run(autor, id);
  dopiszZdarzenie({
    rodzaj: "dyskusja",
    lokalnyId: id,
    typ: "przejeto",
    kto: "my",
    autor,
    /* Wariantem jest OSOBA, nie czas: stempel stawia każda praca nad sprawą,
       więc bez tego oś czasu zbierałaby dziesięć „wzięto sprawę" jednej ręki. */
    wariant: autor,
  });
  przebudujSprawy();
}

export function zmienStatusDyskusji(id: number, status: string, autor: string): Dyskusja {
  if (!(STATUSY_DYSKUSJI as readonly string[]).includes(status)) {
    throw new BladDyskusji(
      `Nieznany status „${status}” — dozwolone: ${STATUSY_DYSKUSJI.join(", ")}`
    );
  }
  const w = wiersz(id);
  const obecny = w.status as string;
  /* Sprawy zamkniętej nie przestawiamy dalej — 409, bo drugi klik z sąsiedniego
     biurka to najpewniej ta sama decyzja podjęta dwa razy, nie nowa. Powrót
     do `w_toku` zostaje możliwy: pomyłkę przy zamykaniu prostuje się samemu. */
  if (obecny === status) {
    throw new BladDyskusji(`Dyskusja jest już w statusie „${status}”`, 409);
  }
  const zamykamy = status === "zamknieta" || status === "pominieta";
  db()
    .prepare(
      `UPDATE dyskusja
          SET status = ?, prowadzi = ?, prowadzi_at = datetime('now'),
              zamknieto_at = ?, zamknieto_przez = ?
        WHERE id = ?`
    )
    .run(status, autor, zamykamy ? nowIso() : null, zamykamy ? autor : null, id);
  logEvent(`dyskusja_${status}`, autor, null, { dyskusjaId: id, poprzedni: obecny });
  dopiszZdarzenie({
    rodzaj: "dyskusja",
    lokalnyId: id,
    typ: zamykamy ? "zamknieta" : "status",
    kto: "my",
    autor,
    szczegol: status,
    wariant: `${status}:${nowIso()}`,
  });
  przebudujSprawy();
  return szczegolDyskusji(id);
}

export function zapiszNotatkeDyskusji(id: number, notatka: string, autor: string): Dyskusja {
  wiersz(id); // 404, zanim cokolwiek zapiszemy
  const tresc = notatka.trim() || null;
  /* Notatka to zapis USTALEŃ z panelu Allegro — jedyna treść, jaka u nas
     zostaje. Pisanie jej JEST braniem sprawy, więc stempluje prowadzącego
     (ta sama zasada co `zapiszOdpowiedz` przy pytaniach). */
  db()
    .prepare(
      "UPDATE dyskusja SET notatka = ?, prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?"
    )
    .run(tresc, autor, id);
  logEvent("dyskusja_notatka", autor, null, { dyskusjaId: id, jest: tresc !== null });
  /* Sam fakt notatki, bez jej treści — mimo że notatka jest NASZA i leży
     w bazie. Oś czasu ma być czytelna, a nie być drugim miejscem, w którym
     trzeba szukać tekstu. */
  dopiszZdarzenie({
    rodzaj: "dyskusja",
    lokalnyId: id,
    typ: "notatka",
    kto: "my",
    autor,
    szczegol: tresc === null ? "skasowana" : `${tresc.length} znaków`,
    wariant: nowIso(),
  });
  return szczegolDyskusji(id);
}

/* ── Rozmowa i odpowiedź w sprawie (0.104.0) ─────────────────────────────────
   Do tej wersji rejestr mówił, ŻE sprawa czeka — odpowiadało się w panelu
   Allegro. Teraz rozmowę czyta się i pisze stąd, przez `/sale/disputes`.
   Rozmowa dalej NIE jest zapisywana u nas (jedno miejsce prawdy, jak przy
   wątkach pytań); zostaje nasz szkic, nasza ostatnia odpowiedź i ślad
   wysyłek w `events`. Zasób jest w becie — 404 z API degraduje do zdania
   „otwórz panel", nigdy do awarii rejestru.                                  */

/**
 * Rozmowa sprawy — na klik, TREŚĆ bez zapisu; `null` = niedostępna przez API.
 * Od 0.127.0 odczyt zostawia metadane piłki w `watek_meta` (kto ostatni,
 * kiedy, ile) — cache tego, co człowiek właśnie widział; świadomy wyjątek od
 * „zero zapisu przy patrzeniu", decyzja właściciela. Dzięki niemu kontrola
 * świeżości wysyłki ma punkt odniesienia po stronie serwera, nie tylko id
 * przysłane przez przeglądarkę.
 */
export async function wiadomosciDyskusji(id: number): Promise<WiadomoscDyskusji[] | null> {
  const w = wiersz(id);
  const lista = await allegroAdapter().wiadomosciDyskusji(w.allegro_id as string);
  if (lista !== null) {
    zapiszMetaDyskusji(w.allegro_id as string, lista, "odczyt");
    /* Ten sam świadomy wyjątek, co linijkę wyżej, i dla tej samej danej:
       głosy klienta to METADANE (kto, kiedy), nie treść. Bez tego sprawa
       przeczytana na klik przed pobraniem miałaby dziurę w historii. */
    glosyNaOsCzasu(id, lista);
  }
  return lista;
}

function zamknietaLokalnie(status: string): boolean {
  return status === "zamknieta" || status === "pominieta";
}

export function zapiszOdpowiedzDyskusji(id: number, tresc: string, autor: string): Dyskusja {
  const w = wiersz(id);
  if (zamknietaLokalnie(w.status as string)) {
    throw new BladDyskusji(
      "Sprawa jest zamknięta — jeśli to pomyłka, przestaw ją najpierw na W TOKU",
      409
    );
  }
  const czysta = tresc.trim();
  if (czysta === "") throw new BladDyskusji("Odpowiedź jest pusta");
  /* Flaga redakcji liczona względem szkicu — dokładnie jak przy pytaniach:
     miara „ile poprawiamy po modelu" wymaga nietkniętego `szkic_ai` obok. */
  const szkic = (w.szkic_ai as string | null)?.trim() ?? null;
  const edytowano = szkic !== null && czysta === szkic ? 0 : 1;
  db()
    .prepare(
      `UPDATE dyskusja
          SET odpowiedz = ?, edytowano = ?, prowadzi = ?, prowadzi_at = datetime('now')
        WHERE id = ?`
    )
    .run(czysta, edytowano, autor, id);
  return szczegolDyskusji(id);
}

export interface ZalacznikDyskusji {
  nazwa: string;
  mime: string;
  /** Base64, z przedrostkiem `data:` albo bez — serwis go zdejmuje. */
  dane: string;
}

/* Te same granice co przy wklejce pytań plus PDF: dowód w reklamacji bywa
   dokumentem. Lista wklejki mówiła, co umie przeczytać MODEL; ta mówi, co
   przyjmuje Allegro — [WERYFIKUJ] na sandboxie. */
const MIME_ZALACZNIKOW = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_ZALACZNIK_B = 4 * 1024 * 1024;

function sprawdzZalacznik(z: ZalacznikDyskusji): { nazwa: string; mime: string; dane: string } {
  if (!MIME_ZALACZNIKOW.includes(z.mime)) {
    throw new BladDyskusji(
      `Załącznik ${z.mime || "bez typu"} nie przejdzie — dozwolone: PNG, JPEG, WebP, PDF`
    );
  }
  const dane = z.dane.replace(/^data:[^;]+;base64,/, "");
  /* Rozmiar liczony PO dekodowaniu — limit mówi o pliku, nie o jego zapisie
     w base64 (ten sam rachunek co przy wklejce, ~4/3 narzutu). */
  const bajtow = Math.floor((dane.length * 3) / 4);
  if (bajtow > MAX_ZALACZNIK_B) {
    throw new BladDyskusji(
      `Załącznik ma ~${Math.round(bajtow / 1024 / 1024)} MB — limit to 4 MB`
    );
  }
  const nazwa = z.nazwa.trim() || "zalacznik";
  return { nazwa, mime: z.mime, dane };
}

/**
 * Wysyłka odpowiedzi do Allegro. Załącznik (opcjonalny) NIE jest u nas
 * zapisywany — jedzie do Allegro i znika (ta sama zasada prywatności co
 * przy screenshotach pytań). Wysyłka nie zamyka sprawy: dyskusja to wiele
 * odpowiedzi, a koniec ogłasza Allegro (sync auto-zamyka po statusie).
 */
/**
 * Wysyłka zatrzymana, bo w sprawie pojawiła się wiadomość, której panel nie
 * pokazał. Punktem odniesienia jest OSTATNIA WIADOMOŚĆ WIDZIANA na ekranie
 * (rejestr nie przechowuje rozmowy — prywatność, 0.104.0), więc id podaje
 * przeglądarka. Brak punktu odniesienia = brak kontroli, nie blokada.
 */
export class BladSwiezosciDyskusji extends BladDyskusji {
  constructor(readonly wiadomosci: WiadomoscDyskusji[]) {
    super(
      "W sprawie pojawiła się nowa wiadomość po napisaniu tej odpowiedzi — " +
        "przeczytaj ją, zanim wyślesz.",
      409
    );
    this.name = "BladSwiezosciDyskusji";
  }
}

export async function wyslijOdpowiedzDyskusji(
  id: number,
  autor: string,
  zalacznik?: ZalacznikDyskusji,
  opcje: { ostatniaWidzianaId?: string | null; wymus?: boolean } = {}
): Promise<Dyskusja> {
  const w = wiersz(id);
  if (zamknietaLokalnie(w.status as string)) {
    throw new BladDyskusji(
      "Sprawa jest zamknięta — jeśli to pomyłka, przestaw ją najpierw na W TOKU",
      409
    );
  }
  const statusAllegro = w.status_allegro as string | null;
  if (statusAllegro && (FINALNE_STATUSY_ALLEGRO as readonly string[]).includes(statusAllegro)) {
    /* Allegro i tak odrzuci — nasze zdanie jest lepsze od ich błędu. */
    throw new BladDyskusji(`Allegro zamknęło tę sprawę (${statusAllegro})`, 409);
  }
  const tresc = ((w.odpowiedz as string | null) ?? "").trim();
  if (tresc === "") {
    throw new BladDyskusji("Najpierw wygeneruj albo napisz odpowiedź");
  }
  if (tresc.length > LIMIT_WIADOMOSCI) {
    throw new BladDyskusji(
      `Odpowiedź ma ${tresc.length} znaków — limit Allegro to ${LIMIT_WIADOMOSCI}`
    );
  }

  const adapter = allegroAdapter();
  /* KONTROLA ŚWIEŻOŚCI jak przy pytaniach (services/pytania.ts): jedno
     zapytanie NA WYSYŁKĘ, degradacja przy awarii pobrania, „wyślij mimo to"
     jest świadomą decyzją człowieka. Punktem odniesienia jest id z panelu,
     a od 0.127.0 w odwodzie `watek_meta` — serwer pamięta ostatnią widzianą
     wiadomość KLIENTA z odczytu/sync, więc panel bez id nie wyłącza już
     kontroli. Brak obu punktów = brak kontroli (pierwszy kontakt w sprawie,
     degradacja z 0.104.0 zostaje). */
  const punkt =
    opcje.ostatniaWidzianaId ??
    metaWatku("dyskusja", w.allegro_id as string)?.ostatniaKlientId ??
    null;
  let swieze: WiadomoscDyskusji[] | null = null;
  if (!opcje.wymus && punkt) {
    try {
      swieze = await adapter.wiadomosciDyskusji(w.allegro_id as string);
    } catch {
      /* degradacja — wysyłka ważniejsza niż kontrola */
    }
    if (swieze && swieze.length > 0) {
      /* „Nowe" liczą się WYŁĄCZNIE z głosów nie-naszych — symetria z
         `noweOdKlienta` przy pytaniach i ochrona przed samoblokadą: własna
         wysłana wiadomość nie może zatrzymać następnej odpowiedzi, gdy
         punktem odniesienia jest id klienta z meta. */
      const cudze = swieze.filter((m) => !m.odNas);
      const znana = cudze.findIndex((m) => m.id === punkt);
      const nowe = znana >= 0 ? cudze.slice(znana + 1) : cudze;
      if (nowe.length > 0) throw new BladSwiezosciDyskusji(nowe);
    }
  }
  let zalacznikId: string | undefined;
  if (zalacznik) {
    const gotowy = sprawdzZalacznik(zalacznik);
    zalacznikId = await adapter.dodajZalacznikDyskusji(gotowy.nazwa, gotowy.mime, gotowy.dane);
  }
  await adapter.wyslijWiadomoscDyskusji(w.allegro_id as string, tresc, zalacznikId);

  /* `prowadzi` ZOSTAJE na nadawcy (inaczej niż przy pytaniach): sprawa trwa
     dalej i to nadawca czeka teraz na odpowiedź klienta. `szkic_ai` też
     zostaje — to baza miary „ile poprawiamy po modelu". */
  db()
    .prepare(
      `UPDATE dyskusja
          SET wyslano_at = datetime('now'), odpowiedzial = ?,
              prowadzi = ?, prowadzi_at = datetime('now'),
              status = CASE WHEN status = 'nowa' THEN 'w_toku' ELSE status END
        WHERE id = ?`
    )
    .run(autor, autor, id);
  /* Meta z rozmowy pobranej przy kontroli (jeśli była), potem stempel „my":
     ostatnie słowo padło od nas, a id klienta i licznik zostają pod następną
     kontrolę świeżości. */
  if (swieze) zapiszMetaDyskusji(w.allegro_id as string, swieze, "wysylka");
  stempelWyslano("dyskusja", w.allegro_id as string);
  przebudujSprawy();
  logEvent("dyskusja_wyslana", autor, null, {
    dyskusjaId: id,
    znakow: tresc.length,
    edytowano: (w.edytowano as number) === 1,
    zZalacznikiem: zalacznik !== undefined,
    typ: (w.typ as string) ?? null,
  });
  dopiszZdarzenie({
    rodzaj: "dyskusja",
    lokalnyId: id,
    typ: "odpowiedzielismy",
    kto: "my",
    autor,
    szczegol: `${tresc.length} znaków`,
    wariant: nowIso(),
  });
  return szczegolDyskusji(id);
}

/**
 * Blok wiedzy dla modelu — odpowiednik `kontekstPytania`, ale o SPRAWIE:
 * rozmowa, powiązany zwrot z decyzjami biura, historia klienta i notatka.
 * Zwykły polski tekst, bo model czyta go jak człowiek nowy w firmie.
 */
function kontekstDyskusji(d: Dyskusja, wiadomosci: WiadomoscDyskusji[] | null): string {
  const czesci: string[] = [];
  czesci.push(
    `SPRAWA: ${d.typ === "CLAIM" ? "REKLAMACJA (formalna, z terminem ustawowym)" : "DYSKUSJA"}` +
      `${d.temat ? ` · temat: ${d.temat}` : ""}` +
      `${d.statusAllegro ? ` · status Allegro: ${d.statusAllegro}` : ""}` +
      `${d.dniDoTerminu !== null ? ` · dni do terminu ustawowego: ${d.dniDoTerminu}` : ""}`
  );

  if (wiadomosci === null) {
    czesci.push(
      "ROZMOWA W SPRAWIE: niedostępna przez API — masz tylko temat i dane zwrotu poniżej."
    );
  } else if (wiadomosci.length === 0) {
    czesci.push("ROZMOWA W SPRAWIE: pusta — klient nie napisał jeszcze wiadomości.");
  } else {
    /* Ostatnie ~15 wiadomości wystarcza: starsze wątki nie zmieniają tego,
       co trzeba odpisać TERAZ, a rozdęty kontekst rozmywa odpowiedź. */
    const ostatnie = wiadomosci.slice(-15);
    const linie = ostatnie.map((m) => {
      const kto = m.odNas ? "MY" : m.autorRola === "ALLEGRO_ADVISOR" ? "ALLEGRO" : "KLIENT";
      const zal = m.zalacznik ? ` [załącznik: ${m.zalacznik.nazwa ?? "plik"}]` : "";
      return `${kto}: ${m.tresc}${zal}`;
    });
    czesci.push(`ROZMOWA W SPRAWIE (od najstarszej):\n${linie.join("\n")}`);
  }

  if (d.zwrotId) {
    const z = db()
      .prepare("SELECT referencja, status, waybill FROM zwrot WHERE id = ?")
      .get(d.zwrotId) as { referencja: string | null; status: string; waybill: string } | undefined;
    const pozycje = db()
      .prepare(
        `SELECT nazwa, ilosc, powod, powod_opis, decyzja, rekl_wynik, rekl_notatka, rekl_polka
         FROM zwrot_pozycja WHERE zwrot_id = ?`
      )
      .all(d.zwrotId) as Array<Record<string, unknown>>;
    const linie = pozycje.map((p) => {
      const kawalki = [
        `- ${p.nazwa} × ${p.ilosc}`,
        p.powod ? `powód klienta: ${p.powod}${p.powod_opis ? ` (${p.powod_opis})` : ""}` : null,
        p.decyzja ? `decyzja biura: ${p.decyzja}` : null,
        p.rekl_wynik ? `werdykt reklamacji: ${p.rekl_wynik}` : null,
        p.rekl_notatka ? `notatka werdyktu: ${p.rekl_notatka}` : null,
        p.rekl_polka ? `towar leży na półce ${p.rekl_polka}` : null,
      ].filter(Boolean);
      return kawalki.join("; ");
    });
    czesci.push(
      `POWIĄZANY ZWROT U NAS: ${z?.referencja ?? z?.waybill ?? d.zwrotId} · stan: ${z?.status ?? "?"}\n` +
        (linie.length ? linie.join("\n") : "(bez pozycji)")
    );
  }

  if (d.kupujacyLogin) {
    const k = kontekstKlienta(d.kupujacyLogin, { dyskusjaId: d.id });
    czesci.push(
      `KLIENT ${d.kupujacyLogin}: wcześniejszych pytań ${k.pytania.length}, ` +
        `zwrotów ${k.zwroty.length}, innych dyskusji ${k.dyskusje.length}.`
    );
  }

  if (d.notatka) czesci.push(`NOTATKA BIURA (ustalenia): ${d.notatka}`);
  return czesci.join("\n\n");
}

/**
 * Szkic odpowiedzi w sprawie — na jawne kliknięcie, bez tickera. Wolumen jest
 * mały, a stawka wysoka (formalny CLAIM); szkic starzeje się z każdą nową
 * wiadomością klienta, więc automat produkowałby nieaktualne wersje na
 * niezweryfikowanym jeszcze zasobie API.
 */
export async function generujSzkicDyskusji(id: number, autor: string): Promise<Dyskusja> {
  if (aiTryb() === "wylaczone") {
    throw new BladDyskusji(stanAI().opis, 400);
  }
  const d = szczegolDyskusji(id);
  if (zamknietaLokalnie(d.status)) {
    throw new BladDyskusji("Sprawa jest zamknięta — szkic nie ma komu odpowiedzieć", 409);
  }
  const wiadomosci = await allegroAdapter().wiadomosciDyskusji(d.allegroId);
  const ostatniaKlienta = wiadomosci?.filter((m) => !m.odNas).at(-1)?.tresc ?? null;

  const konfiguracja = pobierzKonfiguracje();
  const wynik = await generujOdpowiedz({
    /* Bez przykładów stylu pytań: rejestr dyskusji nie ma jeszcze własnego
       korpusu wysłanych odpowiedzi, a wzorce z doboru części pasują tu słabo. */
    system: zbudujSystem(konfiguracja.prompt, konfiguracja.fakty),
    tekst: ostatniaKlienta ?? d.temat ?? "",
    kontekst: kontekstDyskusji(d, wiadomosci),
  });
  dopiszZdarzenie({
    rodzaj: "dyskusja",
    lokalnyId: id,
    typ: "szkic",
    kto: "my",
    autor,
    wariant: nowIso(),
  });
  db()
    .prepare(
      `UPDATE dyskusja
          SET szkic_ai = ?, szkic_at = datetime('now'), odpowiedz = ?, edytowano = 0,
              prowadzi = ?, prowadzi_at = datetime('now')
        WHERE id = ?`
    )
    .run(wynik.odpowiedz, wynik.odpowiedz, autor, id);
  logEvent("dyskusja_szkic", autor, null, { dyskusjaId: id, znakow: wynik.odpowiedz.length });
  return szczegolDyskusji(id);
}

/**
 * Pętla synchronizacji dyskusji — wołana z `main()`, nigdy z `buildApp()`
 * (testy tras nie mają prawa strzelać do Allegro).
 *
 * Dzieli interwał z zapowiedziami i pytaniami (`ALLEGRO_POLL_MS`): ten sam
 * rodzaj pracy w tle na tym samym koncie, osobne pokrętło niczego by nie
 * dostroiło. Domyślnie zero — pobiera człowiek, kiedy tego potrzebuje.
 */
export function uruchomTickerDyskusji(): void {
  /* Rytm dyktuje wspólny takt (services/takt.ts) — uzasadnienie tamże. */
  uruchomTakt("dyskusje", config.zwroty.pollMs, async () => {
    /* Ten sam strażnik co w tickerach zapowiedzi i pytań: bez sparowanego
       konta przebieg tylko zapełniałby log błędem o brakującym tokenie. */
    const stan = stanPolaczenia().stan;
    if (stan !== "dev" && stan !== "polaczone") return;
    const { nowych } = await synchronizujDyskusje("ticker");
    if (nowych > 0) console.log(`[dyskusje] nowych spraw z Allegro: ${nowych}`);
  });
}
