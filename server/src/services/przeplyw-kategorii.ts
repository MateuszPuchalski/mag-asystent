import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { CEL_KLASYFIKACJI } from "./copilot-klasyfikacja.js";
import { KATEGORIE, TAKSONOMIA_WERSJA, czyKategoria, type Kategoria } from "./klasyfikacja-slownik.js";

/* ── Przepływ automatyzacji dla każdej kategorii (6 października 2026) ───────
   Decyzja właściciela: każda kategoria pytania dostaje przepływ zapisany
   w kodzie. Przepływ może wysłać odpowiedź bez człowieka, zlecić następny
   krok albo oznaczyć sprawę jako pilną.

   START W TRYBIE CIENIA. Automat zapisuje, co BY zrobił, i na tym koniec.
   Nic nie idzie do klienta i nic nie zmienia się samo. Agent potwierdza albo
   odrzuca, a pomiar liczy zgodność osobno dla każdej kategorii. Powód stoi
   w §27 punkt 1 projektu panelu: najpierw dane i dowody, potem automatyzacja.

   W TYM PLIKU NIE MA DROGI WYSYŁKI. Żywe wykonanie wejdzie osobną zmianą,
   kategoria po kategorii, dopiero gdy liczby pokażą, że automat trafia.

   UWAGA NA CYKL IMPORTÓW. `copilot-klasyfikacja.ts` czyta ten moduł, a on
   czyta jej `CEL_KLASYFIKACJI`. Dlatego stała idzie wyłącznie do wnętrza
   funkcji: na poziomie modułu wiązanie bywa jeszcze niezainicjowane.
   Werdykt agenta mieszka w `przeplyw-werdykt.ts`, bo woła `skrzynka.ts`,
   która używa tej stałej już przy ładowaniu. */

export type RodzajPropozycji = "wyslij" | "krok" | "pilne";
export const RODZAJE_PROPOZYCJI = ["wyslij", "krok", "pilne"] as const;

export interface KrokPrzeplywu {
  /** Zadanie dla hali. Dziś jedyny wykonywalny krok — prośby o zdjęcie, model
      czy numer to treść odpowiedzi, więc należą do „wyslij". */
  rodzaj: "weryfikacja";
  /** Zdanie dla hali: co ma zrobić. Bez danych klienta. */
  instrukcja: string;
}

export interface Przeplyw {
  /** Czy odpowiedź tej kategorii może kiedyś wyjść bez człowieka. */
  wysylka: boolean;
  krok: KrokPrzeplywu | null;
  pilne: boolean;
}

/**
 * Wersja tabeli niżej. Zapisuje się przy każdej propozycji, bo pomiar
 * porównuje wyłącznie propozycje jednej tabeli. Zgoda na stary przepływ
 * nie mówi nic o nowym. Zmieniasz tabelę — podnosisz numer.
 */
export const PRZEPLYW_WERSJA = "w1";

/**
 * Przepływy kategorii. `Record<Kategoria, Przeplyw>`: kategoria dopisana do
 * słownika bez przepływu się nie skompiluje, ta sama zasada co przy wzorcach.
 *
 * ZASADA WYSYŁKI: bez człowieka tylko tam, gdzie odpowiedź ZAMYKA pytanie.
 * Gdy wzorzec obiecuje dalszą pracę człowieka, ktoś musi tę obietnicę
 * zobaczyć. Wysłana sama, zostałaby obietnicą bez wykonawcy.
 *
 * PILNE nie ma warunku pewności, bo jest odwracalne jednym kliknięciem.
 */
export const PRZEPLYWY: Readonly<Record<Kategoria, Przeplyw>> = {
  /* Stan zamówienia i paczki stoi w faktach, a odpowiedź go podaje i kończy. */
  ORDER_STATUS: { wysylka: true, krok: null, pilne: false },
  /* Wzorzec obiecuje „sprawdzimy u przewoźnika", więc ktoś musi to zrobić. */
  DELIVERY_DELAY: { wysylka: false, krok: null, pilne: false },
  /* Wyjaśnienie z przewoźnikiem robi człowiek. Pilne, bo klient nie ma towaru
     i każdy dzień zwłoki to ryzyko dyskusji w Allegro. */
  DELIVERY_LOST: { wysylka: false, krok: null, pilne: true },
  /* Szkoda w transporcie ma terminy u przewoźnika, a decyzję o wymianie
     podejmuje człowiek. */
  DELIVERY_DAMAGED: { wysylka: false, krok: null, pilne: true },
  /* §27 punkt 3: automat nie jest źródłem kompatybilności. Zła odpowiedź
     o pasowaniu kończy się zwrotem i złą opinią. */
  PRODUCT_COMPATIBILITY: { wysylka: false, krok: null, pilne: false },
  /* Parametr z kartoteki zamyka pytanie. Brak faktu daje zastrzeżenie,
     a zastrzeżenie odcina wysyłkę w `propozycje`. */
  PRODUCT_QUESTION: { wysylka: true, krok: null, pilne: false },
  /* Stan na dziś stoi w faktach i odpowiedź go podaje. */
  PRODUCT_AVAILABILITY: { wysylka: true, krok: null, pilne: false },
  /* Pomyłka jest nasza, więc najpierw hala sprawdza półkę. Bez tego biuro
     obiecuje wymianę towaru, którego może nie być. Pilne, bo klient czeka
     na właściwą część. */
  WRONG_PRODUCT: {
    wysylka: false,
    krok: {
      rodzaj: "weryfikacja",
      instrukcja: "Klient zgłasza, że dostał inny towar niż zamówił. Sprawdź na półce, "
        + "czy towar z zamówienia zgadza się z etykietą i lokalizacją.",
    },
    pilne: true,
  },
  /* Dosyłka wymaga towaru na stanie, a stan potwierdza hala, nie read-model. */
  MISSING_PRODUCT: {
    wysylka: false,
    krok: {
      rodzaj: "weryfikacja",
      instrukcja: "Klient zgłasza brak pozycji w paczce. Sprawdź stan brakującego towaru "
        + "do ewentualnej dosyłki.",
    },
    pilne: true,
  },
  /* Wada towaru to droga do reklamacji, a tę ocenia człowiek. */
  DAMAGED_PRODUCT: { wysylka: false, krok: null, pilne: false },
  /* Zwrot idzie przez Allegro, a odpowiedź tylko wskazuje drogę. */
  RETURN: { wysylka: true, krok: null, pilne: false },
  /* §14.2: automat nie uznaje reklamacji. Pilne, bo biegnie zegar ustawowy. */
  COMPLAINT: { wysylka: false, krok: null, pilne: true },
  /* Anulowanie robi człowiek. Pilne, bo musi zdążyć, zanim paczka wyjdzie. */
  CANCEL_ORDER: { wysylka: false, krok: null, pilne: true },
  /* Fakturę wystawia człowiek w Subiekcie. */
  INVOICE: { wysylka: false, krok: null, pilne: false },
  /* Za mało treści, żeby cokolwiek zrobić bez człowieka. */
  OTHER: { wysylka: false, krok: null, pilne: false },
};

/** Kolejność na karcie i w pomiarze: od najmocniejszego działania. */
const KOLEJNOSC: Record<RodzajPropozycji, number> = { wyslij: 0, krok: 1, pilne: 2 };

export interface DecyzjaDoPrzeplywu {
  kategoria: string; akcja: string; status: string; zrodlo: string;
  pewnosc: string | null; wymagaCzlowieka: boolean;
  brakDanychZamowienia: boolean; brakDanychProduktu: boolean;
}

/** Czysta funkcja, bez bazy. Co automat BY zrobił przy tej decyzji i szkicu. */
export function propozycje(
  d: DecyzjaDoPrzeplywu,
  szkic: { zastrzezen: number } | null,
): Array<{ rodzaj: RodzajPropozycji; instrukcja: string | null }> {
  if (!czyKategoria(d.kategoria)) return [];
  /* Te same trzy warunki, co przy szkicu po rozpoznaniu. „Nic do zrobienia",
     rozpoznanie zastępcze i awaria nie mówią, czego chce klient. */
  if (d.akcja === "NO_ACTION" || d.zrodlo === "FALLBACK" || d.status === "FAILED") return [];
  const p = PRZEPLYWY[d.kategoria];
  const wynik: Array<{ rodzaj: RodzajPropozycji; instrukcja: string | null }> = [];
  /* Wysyłka bez człowieka to jedyne działanie nieodwracalne, więc stoi na
     najwęższej bramce. Każdy warunek to sytuacja, w której szkic mógłby
     powiedzieć klientowi nieprawdę. */
  const pewna = d.pewnosc === "wysoka" || d.zrodlo === "ALLEGRO_MAPPING";
  if (p.wysylka && d.status === "SUCCESS" && pewna && !d.wymagaCzlowieka
    && !d.brakDanychZamowienia && !d.brakDanychProduktu
    && szkic !== null && szkic.zastrzezen === 0) {
    wynik.push({ rodzaj: "wyslij", instrukcja: null });
  }
  /* Krok kosztuje pracę hali, więc wymaga rozpoznania bez zastrzeżeń
     polityki. Przegląd do zrobienia przez człowieka nie zleca zadań. */
  if (p.krok && d.status === "SUCCESS") wynik.push({ rodzaj: "krok", instrukcja: p.krok.instrukcja });
  if (p.pilne) wynik.push({ rodzaj: "pilne", instrukcja: null });
  return wynik;
}

export interface PropozycjaPrzeplywu {
  id: number;
  rodzaj: RodzajPropozycji;
  kategoria: string;
  instrukcja: string | null;
  at: string;
  werdykt: "zgoda" | "sprzeciw" | null;
  werdyktZrodlo: "agent" | "wysylka" | null;
  werdyktPrzez: string | null;
  werdyktAt: string | null;
}

export interface WierszPomiaruPrzeplywu {
  kategoria: string;
  rodzaj: RodzajPropozycji;
  propozycji: number;
  zgod: number;
  sprzeciwow: number;
  bezWerdyktu: number;
}

export const naPropozycje = (w: Record<string, unknown>): PropozycjaPrzeplywu => ({
  id: Number(w.id),
  rodzaj: String(w.rodzaj) as RodzajPropozycji,
  kategoria: String(w.kategoria),
  instrukcja: w.instrukcja == null ? null : String(w.instrukcja),
  at: String(w.at),
  werdykt: w.werdykt == null ? null : String(w.werdykt) as "zgoda" | "sprzeciw",
  werdyktZrodlo: w.werdykt_zrodlo == null ? null : String(w.werdykt_zrodlo) as "agent" | "wysylka",
  werdyktPrzez: w.werdykt_przez == null ? null : String(w.werdykt_przez),
  werdyktAt: w.werdykt_at == null ? null : String(w.werdykt_at),
});

/** Aktywna decyzja OSTATNIEJ wiadomości klienta — ta sama reguła co przy szkicu. */
export const biezacaDecyzja = () => `
  FROM conversation c
  JOIN message m ON m.id = ${CEL_KLASYFIKACJI}
  JOIN decyzja_klasyfikacji k ON k.message_id = m.id AND k.aktywna = 1
   AND k.taksonomia_wersja = '${TAKSONOMIA_WERSJA}'`;

/** Ile zastrzeżeń ma szkic. Uszkodzony JSON to brak wiedzy, więc `null`. */
function zastrzezenSzkicu(json: unknown): number | null {
  try {
    const lista = JSON.parse(String(json ?? "[]")) as unknown;
    return Array.isArray(lista) ? lista.length : null;
  } catch {
    return null;
  }
}

/**
 * Zapisuje propozycje dla AKTYWNEJ decyzji ostatniej wiadomości klienta
 * każdej z podanych rozmów. Idempotentne: jeden wiersz na decyzję i rodzaj.
 * Zwraca liczbę nowych wierszy.
 *
 * Wołane PO szkicu, bo „wyslij" patrzy na szkic. Wołane drugi raz po nowym
 * szkicu dopisze brakujące „wyslij", a reszty nie ruszy.
 */
export function zapiszPropozycje(database: DatabaseSync, rozmowyId: number[], teraz = new Date()): number {
  if (rozmowyId.length === 0) return 0;
  const wiersze = database.prepare(`
    SELECT c.id AS rozmowa, m.id AS wiadomosc, k.id AS decyzja, k.kategoria, k.akcja, k.status,
           k.zrodlo, k.pewnosc, k.wymaga_czlowieka, k.brak_danych_zamowienia,
           k.brak_danych_produktu, s.zastrzezenia, s.message_id AS szkic_wiadomosc,
           s.decyzja_id AS szkic_decyzja
    ${biezacaDecyzja()}
    LEFT JOIN szkic_copilota s ON s.conversation_id = c.id
    WHERE c.id IN (${rozmowyId.map(() => "?").join(",")})`).all(...rozmowyId) as Array<Record<string, unknown>>;

  const wstaw = database.prepare(`INSERT OR IGNORE INTO propozycja_przeplywu
    (conversation_id, message_id, decyzja_id, kategoria, rodzaj, instrukcja, przeplyw_wersja, at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const zNowymi = new Set<number>();
  let nowych = 0;
  transaction(database, () => {
    for (const w of wiersze) {
      /* Szkic liczy się tylko ułożony pod TĘ wiadomość i TĘ decyzję. Szkic
         sprzed poprawki kategorii odpowiada na inne pytanie. */
      const swiezy = Number(w.szkic_wiadomosc) === Number(w.wiadomosc)
        && Number(w.szkic_decyzja) === Number(w.decyzja);
      const zastrzezen = swiezy ? zastrzezenSzkicu(w.zastrzezenia) : null;
      const lista = propozycje({
        kategoria: String(w.kategoria), akcja: String(w.akcja), status: String(w.status),
        zrodlo: String(w.zrodlo), pewnosc: w.pewnosc == null ? null : String(w.pewnosc),
        wymagaCzlowieka: Number(w.wymaga_czlowieka) === 1,
        brakDanychZamowienia: Number(w.brak_danych_zamowienia) === 1,
        brakDanychProduktu: Number(w.brak_danych_produktu) === 1,
      }, zastrzezen === null ? null : { zastrzezen });
      for (const p of lista) {
        const r = wstaw.run(Number(w.rozmowa), Number(w.wiadomosc), Number(w.decyzja),
          String(w.kategoria), p.rodzaj, p.instrukcja, PRZEPLYW_WERSJA, teraz.toISOString());
        if (Number(r.changes) > 0) { nowych++; zNowymi.add(Number(w.rozmowa)); }
      }
    }
    /* Jeden wpis zbiorczy na przebieg. Wpis na propozycję zalałby dziennik
       przy partii dwudziestu rozmów, a niczego więcej by nie powiedział. */
    if (nowych > 0) {
      logEvent("przeplyw_propozycje", "automat", null,
        { rozmow: zNowymi.size, propozycji: nowych, wersja: PRZEPLYW_WERSJA }, null, database);
    }
  })();
  /* Po zatwierdzeniu, nie w transakcji: panel odświeży kartę i ma zastać
     wiersze, a nie stan sprzed zapisu. */
  for (const r of zNowymi) publishConversationEvent("assignment.changed", r, { przeplyw: true });
  return nowych;
}

/** Propozycje bieżącej decyzji rozmowy — dla osi rozmowy. Czyta, nic nie pisze. */
export function propozycjeRozmowy(database: DatabaseSync, conversationId: number): PropozycjaPrzeplywu[] {
  const wiersze = database.prepare(`
    SELECT p.* ${biezacaDecyzja()}
    JOIN propozycja_przeplywu p ON p.decyzja_id = k.id
    WHERE c.id = ?`).all(conversationId) as Array<Record<string, unknown>>;
  return wiersze.map(naPropozycje)
    .sort((a, b) => KOLEJNOSC[a.rodzaj] - KOLEJNOSC[b.rodzaj]);
}

/**
 * Werdykt dla „wyslij" bez werdyktu, pod decyzję szkicu z tej rozmowy.
 * Bez własnej transakcji, bo obaj wołający już w niej są.
 *
 * Decyzja SZKICU, nie aktywna decyzja rozmowy: werdykt dotyczy dokładnie
 * tego szkicu, który porównano z wysłaną treścią albo który odrzucono.
 */
function werdyktSzkicu(
  database: DatabaseSync, conversationId: number, messageId: number,
  werdykt: "zgoda" | "sprzeciw", autor: { id: number; name: string }, przyczyna: string,
): void {
  const r = database.prepare(`UPDATE propozycja_przeplywu SET werdykt=?, werdykt_zrodlo='wysylka',
      werdykt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), werdykt_przez=?, werdykt_user_id=?
    WHERE conversation_id=? AND message_id=? AND rodzaj='wyslij' AND werdykt IS NULL
      AND decyzja_id = (SELECT s.decyzja_id FROM szkic_copilota s
                         WHERE s.conversation_id=? AND s.message_id=?)`)
    .run(werdykt, autor.name, autor.id, conversationId, messageId, conversationId, messageId);
  if (Number(r.changes) > 0) {
    logEvent("przeplyw_werdykt", autor.name, null,
      { conversationId, rodzaj: "wyslij", werdykt, przyczyna }, autor.id, database);
  }
}

/**
 * Werdykt wysyłki: woła go `wysylka.ts` po udanej wysyłce, w TEJ SAMEJ
 * transakcji. Szkic wysłany bez zmian to zgoda z tym, co automat by wysłał,
 * a poprawiony to sprzeciw. Wysyłka bez szkicu (`null`) nie ocenia niczego.
 */
export function werdyktWysylki(
  database: DatabaseSync, conversationId: number, messageId: number | null,
  szkicLos: "bez_zmian" | "poprawiony" | null, autor: { id: number; name: string },
): void {
  if (messageId === null || szkicLos === null) return;
  werdyktSzkicu(database, conversationId, messageId, szkicLos === "bez_zmian" ? "zgoda" : "sprzeciw",
    autor, szkicLos);
}

/**
 * Odrzucenie szkicu przez agenta to też sprzeciw wobec „wyslij": automat
 * wysłałby właśnie ten tekst. Zapisujemy to przy ocenie, nie liczymy przy
 * odczycie. Szkic ma jeden wiersz na rozmowę i następny kasuje jego ocenę,
 * więc liczenie przy odczycie gubiłoby sprzeciw przy każdym nowym szkicu.
 *
 * Źródłem jest „wysylka", bo to los szkicu, a nie klik na karcie przepływu.
 * Bez własnej transakcji: woła ją ocena szkicu ze swojej.
 */
export function werdyktOdrzucenia(
  database: DatabaseSync, conversationId: number, autor: { id: number; name: string },
): void {
  const s = database.prepare("SELECT message_id FROM szkic_copilota WHERE conversation_id=?")
    .get(conversationId) as { message_id: number | null } | undefined;
  if (s?.message_id == null) return;
  werdyktSzkicu(database, conversationId, Number(s.message_id), "sprzeciw", autor, "odrzucony");
}

/**
 * Pomiar: kategoria × rodzaj, wyłącznie bieżąca wersja przepływów. Zgoda
 * na starą tabelę nie jest dowodem dla nowej, tak jak etykieta starego
 * słownika nie jest trafieniem w nowym. Czysty odczyt.
 */
export function pomiarPrzeplywu(database: DatabaseSync): WierszPomiaruPrzeplywu[] {
  const wiersze = database.prepare(`SELECT kategoria, rodzaj, COUNT(*) AS propozycji,
      SUM(CASE WHEN werdykt='zgoda' THEN 1 ELSE 0 END) AS zgod,
      SUM(CASE WHEN werdykt='sprzeciw' THEN 1 ELSE 0 END) AS sprzeciwow,
      SUM(CASE WHEN werdykt IS NULL THEN 1 ELSE 0 END) AS bezWerdyktu
    FROM propozycja_przeplywu WHERE przeplyw_wersja=?
    GROUP BY kategoria, rodzaj`).all(PRZEPLYW_WERSJA) as Array<Record<string, unknown>>;
  const pozycja = (k: string) => {
    const i = (KATEGORIE as readonly string[]).indexOf(k);
    return i < 0 ? KATEGORIE.length : i;
  };
  return wiersze.map((w) => ({
    kategoria: String(w.kategoria), rodzaj: String(w.rodzaj) as RodzajPropozycji,
    propozycji: Number(w.propozycji), zgod: Number(w.zgod ?? 0),
    sprzeciwow: Number(w.sprzeciwow ?? 0), bezWerdyktu: Number(w.bezWerdyktu ?? 0),
  })).sort((a, b) => pozycja(a.kategoria) - pozycja(b.kategoria)
    || KOLEJNOSC[a.rodzaj] - KOLEJNOSC[b.rodzaj]);
}
