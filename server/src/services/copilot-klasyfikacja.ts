import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { zamaskuj, zostalyDaneOsobowe, type TrescBezpieczna } from "./copilot-maskowanie.js";
import { kosztUsd, type Tokeny } from "./copilot-koszt.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";

/* ── Copilot: rozpoznanie, o co pyta klient (§14, etap F) ────────────────────

   PIERWSZY przyrost etapu F i pierwsze miejsce, z którego treść rozmowy
   wychodzi poza firmę. Stąd trzy ostrożności, których nie ma nigdzie indziej.

   PIERWSZA: nic nie wychodzi niezamaskowane. Pilnuje tego KOMPILATOR — nadawca
   przyjmuje `TrescBezpieczna`, a ten typ umie wyprodukować wyłącznie
   `zamaskuj()`. Drugi zamek to asercja `zostalyDaneOsobowe()` tuż przed
   wysyłką: fałszywy alarm jest niemożliwy, więc kosztuje zero, a łapie jedyny
   realny scenariusz — ktoś zepsuł maskowanie, a testy tego nie objęły.

   DRUGA: automat NIE DECYDUJE. Klasyfikacja jest osobnym bytem i nie dotyka
   ani statusu rozmowy (§7 — „czyj jest ruch"), ani priorytetu (flaga ręczna
   decyzją właściciela), ani `conversation.version`. Ta ostatnia pilnuje
   przejęcia i szkicu: podniesienie jej wywracałoby komuś szkic na 409
   w trakcie pisania.

   TRZECIA: każda rozmowa to WŁASNA transakcja, a partia leci sekwencyjnie.
   Jedna wielka transakcja cofnęłaby przy limicie kilkanaście odpowiedzi, za
   które już zapłaciliśmy. Sekwencyjnie, bo cache prefiksu zapisuje pierwsze
   wywołanie, a czytają je dopiero następne.                                  */

/**
 * Słownik kategorii. Sześć roboczych plus dwa kosze, i te dwa kosze mówią
 * o DWÓCH RÓŻNYCH naprawach: `inne` znaczy „słownik jest za krótki",
 * `nie_wiadomo` znaczy „za mało treści, przeczytaj sam". Zlanie ich w jedno
 * zabrałoby pomiarowi połowę wartości.
 *
 * Lista jest tu, a nie w `CHECK` bazy — patrz komentarz przy tabeli
 * `klasyfikacja_rozmowy` w `schema.sql` (blizna 0.135.0).
 */
export const KATEGORIE = [
  "dobor", "dostepnosc", "wysylka", "zwrot", "reklamacja", "dokumenty",
  "inne", "nie_wiadomo",
] as const;
export type Kategoria = (typeof KATEGORIE)[number];

export const PEWNOSCI = ["wysoka", "srednia", "niska"] as const;
export type Pewnosc = (typeof PEWNOSCI)[number];

/** Odpowiedź modelu, SUROWA. Walidacja jest niżej, w serwisie. */
export interface OdpowiedzModelu {
  kategoria: string;
  pewnosc: string;
  uzasadnienie: string;
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

/**
 * Wysyłka do dostawcy. Wstrzykiwana, żeby test nie potrzebował ani sieci, ani
 * klucza — ten sam wzorzec, co `NadawcaWniosku` w `rabaty.ts`.
 *
 * Przyjmuje `TrescBezpieczna`, nie `string`: to jest bramka prywatności
 * postawiona w typie, a nie w dyscyplinie.
 */
export type NadawcaKlasyfikacji = (tresc: TrescBezpieczna) => Promise<OdpowiedzModelu>;

export interface WynikPartii {
  sklasyfikowane: number;
  /** Rozmowy, za które NIE zapłaciliśmy, i powód. */
  pominiete: Array<{ rozmowaId: number; powod: string }>;
  bledy: Array<{ rozmowaId: number; powod: string }>;
  /** Zdanie dla człowieka, gdy partia STANĘŁA. `null` = przeszła do końca. */
  przerwane: string | null;
  zuzycie: Tokeny & { kosztUsd: number };
}

type Wiersz = {
  id: number; subject: string | null;
  message_id: number | null; body: string | null;
  sklasyfikowana_na: number | null;
};

/* Ostatnia wiadomość KLIENTA i to, na czym liczono poprzednim razem. Jedno
   zapytanie na rozmowę, bo partia jest krótka, a łączenie tego w jedno
   zapytanie po `IN (...)` zaciemniłoby pominięcia. */
const WIERSZ = `
  SELECT c.id, c.subject,
         (SELECT m.id FROM message m WHERE m.conversation_id=c.id
            AND m.direction='incoming' ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS message_id,
         (SELECT m.body FROM message m WHERE m.conversation_id=c.id
            AND m.direction='incoming' ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS body,
         (SELECT k.message_id FROM klasyfikacja_rozmowy k
            WHERE k.conversation_id=c.id) AS sklasyfikowana_na
  FROM conversation c WHERE c.id = ?`;

const pusty: Tokeny = { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 };

/**
 * Rozpoznanie kategorii dla podanych rozmów.
 *
 * Identyfikatory podaje EKRAN, a nie serwis wyliczający kubełek: panel i tak
 * ma przed sobą wiersze kolejki i wie, które są nierozpoznane. Dzięki temu
 * przyszły przycisk w pojedynczej rozmowie wyśle jeden identyfikator — bez
 * nowej trasy i bez nowego serwisu.
 */
export async function sklasyfikujRozmowy(
  database: DatabaseSync,
  rozmowyId: number[],
  kto: { id: number; name: string },
  nadaj: NadawcaKlasyfikacji,
  teraz = new Date(),
): Promise<WynikPartii> {
  const wynik: WynikPartii = {
    sklasyfikowane: 0, pominiete: [], bledy: [], przerwane: null,
    zuzycie: { ...pusty, kosztUsd: 0 },
  };

  for (const rozmowaId of rozmowyId) {
    const w = database.prepare(WIERSZ).get(rozmowaId) as Wiersz | undefined;
    if (!w) {
      wynik.pominiete.push({ rozmowaId, powod: "nie ma takiej rozmowy" });
      continue;
    }
    /* Rozmowa bez pytania klienta nie ma czego klasyfikować — a wysłanie
       naszej własnej odpowiedzi do dostawcy byłoby płaceniem za echo. */
    if (!w.message_id || !(w.body ?? "").trim()) {
      wynik.pominiete.push({ rozmowaId, powod: "brak wiadomości od klienta" });
      continue;
    }
    /* Ta sama treść nie idzie do dostawcy dwa razy. Etykieta liczona na tej
       samej wiadomości jest AKTUALNA; dopisek klienta czyni ją nieaktualną
       i wtedy rozmowa wraca do partii. */
    if (w.sklasyfikowana_na !== null && Number(w.sklasyfikowana_na) === Number(w.message_id)) {
      wynik.pominiete.push({ rozmowaId, powod: "już rozpoznana na tej wiadomości" });
      continue;
    }

    const tresc = zamaskuj(String(w.body), w.subject);
    /* Asercja końcowa PRZED siecią. Te same wzorce właśnie maskowały, więc
       trafienie znaczy zepsute maskowanie, a nie fałszywy alarm. */
    if (zostalyDaneOsobowe(String(tresc))) {
      wynik.bledy.push({ rozmowaId, powod: "maskowanie nie oczyściło treści — nie wysyłam" });
      zapiszBlad(database, rozmowaId, "maskowanie", kto, teraz);
      continue;
    }

    let odp: OdpowiedzModelu;
    try {
      odp = await nadaj(tresc);
    } catch (e) {
      const powod = (e as Error).message;
      /* Do księgi idzie ŚLAD (typ, status, identyfikator żądania), a na ekran
         zdanie. Gdy śladu nie ma, wpisujemy zdanie — pusta rubryka w księdze
         byłaby gorsza niż zdanie nie na swoim miejscu. */
      const slad = (e as { slad?: string }).slad || powod;
      zapiszBlad(database, rozmowaId, slad, kto, teraz);
      wynik.bledy.push({ rozmowaId, powod });
      /* CZTERY POWODY ZATRZYMUJĄ CAŁĄ PARTIĘ i wszystkie cztery są tym samym
         argumentem: opisują stan DOSTAWCY, a nie tej jednej rozmowy, więc
         następna dostałaby identyczną odpowiedź. Ponowienia nie ma (doktryna
         `takt.ts`), a dwadzieścia prób w ten sam mur to dwadzieścia śladów
         w księdze i zero informacji ponad tę z pierwszej próby. */
      if (e instanceof BladLimituCopilota) {
        const za = e.poIluMs ? ` Spróbuj za ${Math.ceil(e.poIluMs / 60000)} min.` : "";
        wynik.przerwane = `Dostawca poprosił o przerwę.${za}`;
        break;
      }
      if (e instanceof BladKluczaCopilota || e instanceof BladPrzeciazeniaCopilota
        || e instanceof BladLacznosciCopilota) {
        wynik.przerwane = e.message;
        break;
      }
      continue;
    }

    const kategoria = (KATEGORIE as readonly string[]).includes(odp.kategoria)
      ? (odp.kategoria as Kategoria) : null;
    if (kategoria === null) {
      /* NIE zakładamy nowej kategorii. Zdarzenie z odrzuconą wartością jest
         głównym mechanizmem wzrostu słownika — dla niego kolumna nie ma
         `CHECK`-a. Wywołanie było płatne, więc ląduje w księdze. */
      zapiszWywolanie(database, rozmowaId, odp, "blad", `kategoria spoza słownika: ${odp.kategoria}`, kto, teraz);
      logEvent("copilot_kategoria_spoza_slownika", kto.name, null,
        { conversationId: rozmowaId, wartosc: odp.kategoria, model: odp.model }, kto.id, database);
      wynik.bledy.push({ rozmowaId, powod: "model zwrócił kategorię spoza słownika" });
      dolicz(wynik, odp);
      continue;
    }
    const pewnosc = (PEWNOSCI as readonly string[]).includes(odp.pewnosc)
      ? (odp.pewnosc as Pewnosc) : "niska";

    transaction(database, () => {
      database.prepare(`INSERT INTO klasyfikacja_rozmowy
        (conversation_id,kategoria,pewnosc,uzasadnienie,message_id,model,at,przez,przez_user_id)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          kategoria=excluded.kategoria, pewnosc=excluded.pewnosc,
          uzasadnienie=excluded.uzasadnienie, message_id=excluded.message_id,
          model=excluded.model, at=excluded.at, przez=excluded.przez,
          przez_user_id=excluded.przez_user_id,
          /* Nowa treść znaczy nową propozycję — stara ocena jej nie dotyczy. */
          ocena=NULL, ocenil_user_id=NULL, ocena_at=NULL`)
        .run(rozmowaId, kategoria, pewnosc, odp.uzasadnienie || null,
          w.message_id, odp.model, teraz.toISOString(), kto.name, kto.id);

      zapiszWywolanie(database, rozmowaId, odp, "ok", null, kto, teraz);
      /* Ładunek niesie IDENTYFIKATORY i kategorię, nigdy treści wiadomości
         (§19 i polityka danych skrzynki). */
      logEvent("copilot_klasyfikacja", kto.name, null,
        { conversationId: rozmowaId, kategoria, pewnosc, model: odp.model,
          tokeny: odp.zuzycie }, kto.id, database);
    })();

    wynik.sklasyfikowane += 1;
    dolicz(wynik, odp);
  }

  wynik.zuzycie.kosztUsd = Number(wynik.zuzycie.kosztUsd.toFixed(6));
  return wynik;
}

function dolicz(wynik: WynikPartii, odp: OdpowiedzModelu): void {
  wynik.zuzycie.wej += odp.zuzycie.wej;
  wynik.zuzycie.wyj += odp.zuzycie.wyj;
  wynik.zuzycie.cacheZapis += odp.zuzycie.cacheZapis;
  wynik.zuzycie.cacheOdczyt += odp.zuzycie.cacheOdczyt;
  wynik.zuzycie.kosztUsd += kosztUsd(odp.model, odp.zuzycie);
}

function zapiszWywolanie(
  database: DatabaseSync, rozmowaId: number, odp: OdpowiedzModelu,
  wynik: "ok" | "blad", blad: string | null, kto: { id: number }, teraz: Date,
): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('klasyfikacja',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rozmowaId, odp.model, odp.zuzycie.wej, odp.zuzycie.wyj,
      odp.zuzycie.cacheZapis, odp.zuzycie.cacheOdczyt, odp.ms, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}

/* Próba, która nie doszła do odpowiedzi, też bywa płatna — a przy braku
   wiersza w księdze ta część rachunku znika bez śladu. Tokenów nie znamy,
   więc idą zera; liczy się fakt i klasa błędu. */
function zapiszBlad(
  database: DatabaseSync, rozmowaId: number, powod: string,
  kto: { id: number }, teraz: Date,
): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,wynik,blad,przez_user_id,at)
    VALUES ('klasyfikacja',?,'',?,?,?,?)`)
    .run(rozmowaId, "blad", powod.slice(0, 300), kto.id, teraz.toISOString());
}

/**
 * Werdykt człowieka o propozycji maszyny.
 *
 * Bez niego trafności nie da się policzyć, a decyzja „po pomiarze zejść na
 * tańszy model" tego wymaga. Ocena dotyczy TEGO werdyktu, nie rozmowy —
 * dlatego siedzi przy klasyfikacji i znika razem z nią przy ponownym
 * rozpoznaniu.
 */
export function ocenKlasyfikacje(
  database: DatabaseSync, conversationId: number, ocena: string,
  kto: { id: number; name: string }, teraz = new Date(),
): { ocena: string } {
  if (ocena !== "trafna" && ocena !== "nietrafna") {
    throw new Error("Ocena może być \u201etrafna\u201d albo \u201enietrafna\u201d.");
  }
  const jest = database.prepare("SELECT 1 FROM klasyfikacja_rozmowy WHERE conversation_id=?")
    .get(conversationId);
  if (!jest) throw new Error("Ta rozmowa nie ma jeszcze rozpoznanej kategorii");

  transaction(database, () => {
    database.prepare(`UPDATE klasyfikacja_rozmowy
      SET ocena=?, ocenil_user_id=?, ocena_at=? WHERE conversation_id=?`)
      .run(ocena, kto.id, teraz.toISOString(), conversationId);
    logEvent("copilot_ocena", kto.name, null,
      { conversationId, ocena }, kto.id, database);
  })();
  return { ocena };
}

export interface PomiarCopilota {
  wywolan: number;
  bledow: number;
  tokeny: Tokeny;
  kosztUsd: number;
  /** Udział tokenów wejścia obsłużonych z cache. `null` = nie było czego liczyć. */
  udzialCache: number | null;
  ocen: number;
  trafnych: number;
  /** Ile klasyfikacji NIKT nie ocenił. Bez tej liczby „100 % trafności" kłamie. */
  nieocenionych: number;
  wgKategorii: Array<{ kategoria: string; ile: number; ocen: number; trafnych: number }>;
}

/** Pomiar do ekranu ustawień. Czysty odczyt — nie zapisuje niczego. */
export function pomiarCopilota(database: DatabaseSync = defaultDb()): PomiarCopilota {
  const w = database.prepare(`SELECT
      COUNT(*) AS wywolan,
      SUM(CASE WHEN wynik='blad' THEN 1 ELSE 0 END) AS bledow,
      COALESCE(SUM(tokeny_wej),0) AS wej, COALESCE(SUM(tokeny_wyj),0) AS wyj,
      COALESCE(SUM(tokeny_cache_zapis),0) AS cacheZapis,
      COALESCE(SUM(tokeny_cache_odczyt),0) AS cacheOdczyt
    FROM copilot_wywolanie`).get() as Record<string, number>;

  const tokeny: Tokeny = {
    wej: Number(w.wej), wyj: Number(w.wyj),
    cacheZapis: Number(w.cacheZapis), cacheOdczyt: Number(w.cacheOdczyt),
  };
  /* Koszt liczymy po modelach, nie ryczałtem: partia sprzed zmiany modelu ma
     inną stawkę niż dzisiejsza. */
  const perModel = database.prepare(`SELECT model,
      COALESCE(SUM(tokeny_wej),0) AS wej, COALESCE(SUM(tokeny_wyj),0) AS wyj,
      COALESCE(SUM(tokeny_cache_zapis),0) AS cacheZapis,
      COALESCE(SUM(tokeny_cache_odczyt),0) AS cacheOdczyt
    FROM copilot_wywolanie WHERE model <> '' GROUP BY model`)
    .all() as Array<Record<string, string | number>>;
  const usd = perModel.reduce((suma, m) => suma + kosztUsd(String(m.model), {
    wej: Number(m.wej), wyj: Number(m.wyj),
    cacheZapis: Number(m.cacheZapis), cacheOdczyt: Number(m.cacheOdczyt),
  }), 0);

  const o = database.prepare(`SELECT COUNT(*) AS ile,
      SUM(CASE WHEN ocena IS NOT NULL THEN 1 ELSE 0 END) AS ocen,
      SUM(CASE WHEN ocena='trafna' THEN 1 ELSE 0 END) AS trafnych
    FROM klasyfikacja_rozmowy`).get() as Record<string, number>;

  const wgKategorii = database.prepare(`SELECT kategoria,
      COUNT(*) AS ile,
      SUM(CASE WHEN ocena IS NOT NULL THEN 1 ELSE 0 END) AS ocen,
      SUM(CASE WHEN ocena='trafna' THEN 1 ELSE 0 END) AS trafnych
    FROM klasyfikacja_rozmowy GROUP BY kategoria ORDER BY ile DESC`)
    .all() as Array<Record<string, string | number>>;

  const wejscieRazem = tokeny.wej + tokeny.cacheOdczyt;
  return {
    wywolan: Number(w.wywolan), bledow: Number(w.bledow ?? 0),
    tokeny, kosztUsd: Number(usd.toFixed(6)),
    udzialCache: wejscieRazem > 0
      ? Number((tokeny.cacheOdczyt / wejscieRazem).toFixed(2)) : null,
    ocen: Number(o.ocen ?? 0), trafnych: Number(o.trafnych ?? 0),
    nieocenionych: Number(o.ile ?? 0) - Number(o.ocen ?? 0),
    wgKategorii: wgKategorii.map((k) => ({
      kategoria: String(k.kategoria), ile: Number(k.ile),
      ocen: Number(k.ocen ?? 0), trafnych: Number(k.trafnych ?? 0),
    })),
  };
}
