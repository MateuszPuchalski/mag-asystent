import { db } from "../db/db.js";
import { PODSTAWA_PRAWNA, PROG_WIARYGODNOSCI } from "./raporty.js";

/* ── Czasy obsługi klienta — ile klient czekał na odpowiedź (0.134.0) ────────
   Etap E3 z docs/architektura-spraw.md; ostatnie z czterech zapożyczeń od
   Responso wypisanych w tamtym dokumencie. Liczy się z osi czasu sprawy
   (`sprawa_zdarzenie`, 0.130.0) — nowej tabeli nie trzeba, bo fakt „klient
   napisał" i „odpowiedzieliśmy" leży tam od tamtej wersji z dokładnością do
   minuty i z nazwiskiem przy naszej stronie.

   OKNO LICZY SIĘ OD ODPOWIEDZI, nie od pytania — ta sama decyzja co przy
   czasach zwrotów i z tego samego powodu: przy liczeniu od pytania sprawy
   jeszcze nieodpowiedziane (czyli te najwolniejsze) nigdy nie weszłyby do
   mediany i obsługa wyglądałaby na szybszą, niż jest. Cenę tego wyboru
   płaci sekcja `teraz`: mówi, kto czeka W TEJ CHWILI i od ilu godzin.

   Para liczy się per ŹRÓDŁO: klient pisze w wątku pytania albo w dyskusji
   i tam czeka na odpowiedź. Sklejenie kilku źródeł jednej sprawy dałoby
   „odpowiedź" w kanale, w którym nikt nie odpisał.                          */

/** Głosy klienta, od których biegnie zegar. Nasze `odpowiedzielismy` go zatrzymuje. */
const GLOSY_KLIENTA = ["zalozona", "klient_napisal", "allegro_napisalo"] as const;

export interface OdcinekObslugi {
  klucz: string;
  nazwa: string;
  opis: string;
  medianaH: number | null;
  p90H: number | null;
  ile: number;
  czemuPusto: string | null;
}

export interface CzasyObslugi {
  dni: number;
  odcinki: OdcinekObslugi[];
  ludzie: Array<{
    kto: string;
    odpowiedzi: number;
    medianaH: number | null;
    p90H: number | null;
    /** Poniżej progu mediana jest szumem — panel pisze to przy wierszu. */
    wiarygodne: boolean;
  }>;
  /** Kto czeka TERAZ: sprawy z piłką u nas, najdłużej czekające pierwsze. */
  teraz: Array<{
    rodzaj: string;
    lokalnyId: number;
    odKiedy: string;
    godzin: number;
    klient: string | null;
  }>;
  podstawaPrawna: string;
  progWiarygodnosci: number;
}

/** Kwantyl rangą w dół — dokładnie jak w `czasy-zwrotow.ts`. */
function kwantyl(posortowane: number[], q: number): number | null {
  if (!posortowane.length) return null;
  const i = Math.min(posortowane.length - 1, Math.floor((posortowane.length - 1) * q));
  return Math.round(posortowane[i] * 10) / 10;
}

interface Para {
  rodzaj: string;
  autor: string | null;
  godzin: number;
  odpowiedzAt: string;
}

/**
 * Pary „głos klienta → nasza pierwsza odpowiedź po nim".
 *
 * Kolejne głosy klienta BEZ naszej odpowiedzi między nimi liczą się jako
 * JEDEN odcinek — od pierwszego z nich. Klient, który pisze trzy razy pod
 * rząd, czeka od pierwszej wiadomości, nie od trzeciej; liczenie od ostatniej
 * dawałoby najkrótszy czas dokładnie tam, gdzie obsługa była najgorsza.
 */
function pary(odKiedy: string): Para[] {
  const wiersze = db()
    .prepare(
      `SELECT rodzaj, lokalny_id, typ, kto, autor, kiedy_at
         FROM sprawa_zdarzenie
        WHERE typ IN ('zalozona','klient_napisal','allegro_napisalo','odpowiedzielismy')
        ORDER BY rodzaj, lokalny_id, kiedy_at, id`
    )
    .all() as Array<Record<string, unknown>>;

  const wynik: Para[] = [];
  let klucz = "";
  let czekaOd: string | null = null;
  for (const w of wiersze) {
    const mojKlucz = `${w.rodzaj}:${w.lokalny_id}`;
    if (mojKlucz !== klucz) {
      klucz = mojKlucz;
      czekaOd = null;
    }
    const typ = w.typ as string;
    const kiedy = w.kiedy_at as string;
    if ((GLOSY_KLIENTA as readonly string[]).includes(typ)) {
      /* `zalozona` bywa nasza (zwrot ręczny) — wtedy nikt na nas nie czeka. */
      if (w.kto !== "my" && czekaOd === null) czekaOd = kiedy;
      continue;
    }
    if (czekaOd === null) continue; // odpowiedź bez pytania: nasza inicjatywa
    const godzin = (Date.parse(kiedy) - Date.parse(czekaOd)) / 3_600_000;
    czekaOd = null;
    /* Okno przycinamy PO ODPOWIEDZI, a ujemny odcinek to brak odcinka
       (przestawiony zegar, poprawiony znacznik), nie błyskawiczna obsługa. */
    if (kiedy >= odKiedy && godzin >= 0) {
      wynik.push({ rodzaj: w.rodzaj as string, autor: (w.autor as string | null) ?? null, godzin, odpowiedzAt: kiedy });
    }
  }
  return wynik;
}

const PUSTO_OGOLNE =
  "Brak par „klient napisał → odpowiedzieliśmy” w tym oknie. Oś czasu spraw " +
  "zbiera je od 0.130.0, więc starsza historia jest tu z natury uboga.";

export function czasyObslugi(dni: number): CzasyObslugi {
  const odKiedy = new Date(Date.now() - dni * 86_400_000).toISOString();
  const wszystkie = pary(odKiedy);

  const odcinek = (
    klucz: string,
    nazwa: string,
    opis: string,
    wybrane: Para[]
  ): OdcinekObslugi => {
    const godziny = wybrane.map((p) => p.godzin).sort((a, b) => a - b);
    return {
      klucz,
      nazwa,
      opis,
      medianaH: kwantyl(godziny, 0.5),
      p90H: kwantyl(godziny, 0.9),
      ile: godziny.length,
      czemuPusto: godziny.length === 0 ? PUSTO_OGOLNE : null,
    };
  };

  const odcinki = [
    odcinek("wszystko", "Cała obsługa", "Od głosu klienta do naszej odpowiedzi", wszystkie),
    odcinek(
      "pytanie",
      "Pytania klientów",
      "Wątek Centrum wiadomości — dobór części i pytania przedsprzedażowe",
      wszystkie.filter((p) => p.rodzaj === "pytanie")
    ),
    odcinek(
      "dyskusja",
      "Dyskusje i CLAIM-y",
      "Sprawy z panelu Allegro — reklamacje i spory",
      wszystkie.filter((p) => p.rodzaj === "dyskusja")
    ),
  ];

  const poOsobach = new Map<string, number[]>();
  for (const p of wszystkie) {
    /* Odpowiedź bez autora to wysyłka spoza panelu — nie ma komu jej
       przypisać i nie ma po co zgadywać. */
    if (!p.autor) continue;
    const lista = poOsobach.get(p.autor) ?? [];
    lista.push(p.godzin);
    poOsobach.set(p.autor, lista);
  }
  const ludzie = [...poOsobach.entries()]
    .map(([kto, godziny]) => {
      const posortowane = [...godziny].sort((a, b) => a - b);
      return {
        kto,
        odpowiedzi: posortowane.length,
        medianaH: kwantyl(posortowane, 0.5),
        p90H: kwantyl(posortowane, 0.9),
        wiarygodne: posortowane.length >= PROG_WIARYGODNOSCI,
      };
    })
    .sort((a, b) => b.odpowiedzi - a.odpowiedzi);

  return {
    dni,
    odcinki,
    ludzie,
    teraz: czekajacyTeraz(),
    podstawaPrawna: PODSTAWA_PRAWNA,
    progWiarygodnosci: PROG_WIARYGODNOSCI,
  };
}

/**
 * Kto czeka na odpowiedź TERAZ. Mediana mówi o przeszłości, ta lista o dziś —
 * dopiero razem nie kłamią (ten sam układ co przy czasach zwrotów).
 *
 * Otwartość czytamy z rejestrów, bo oś czasu jej nie zna: zdarzenie „sprawa
 * zamknięta" powstaje przy zamknięciu w panelu, a sprawa zamknięta w Allegro
 * i dociągnięta synchronizacją może go nie mieć.
 */
function czekajacyTeraz(): CzasyObslugi["teraz"] {
  const wiersze = db()
    .prepare(
      `WITH ostatnie AS (
         SELECT rodzaj, lokalny_id,
                MAX(CASE WHEN typ IN ('zalozona','klient_napisal','allegro_napisalo')
                          AND kto <> 'my' THEN kiedy_at END) AS klient_at,
                MAX(CASE WHEN typ = 'odpowiedzielismy' THEN kiedy_at END) AS my_at
           FROM sprawa_zdarzenie
          GROUP BY rodzaj, lokalny_id
       )
       SELECT o.rodzaj, o.lokalny_id, o.klient_at,
              COALESCE(p.kupujacy_login, d.kupujacy_login) AS klient
         FROM ostatnie o
         LEFT JOIN pytanie  p ON o.rodzaj = 'pytanie'  AND p.id = o.lokalny_id
         LEFT JOIN dyskusja d ON o.rodzaj = 'dyskusja' AND d.id = o.lokalny_id
        WHERE o.klient_at IS NOT NULL
          AND (o.my_at IS NULL OR o.my_at < o.klient_at)
          AND (p.status IN ('nowe','szkic') OR d.status IN ('nowa','w_toku'))
        ORDER BY o.klient_at
        LIMIT 20`
    )
    .all() as Array<Record<string, unknown>>;
  const teraz = Date.now();
  return wiersze.map((w) => ({
    rodzaj: w.rodzaj as string,
    lokalnyId: w.lokalny_id as number,
    odKiedy: w.klient_at as string,
    godzin: Math.round(((teraz - Date.parse(w.klient_at as string)) / 3_600_000) * 10) / 10,
    klient: (w.klient as string | null) ?? null,
  }));
}
