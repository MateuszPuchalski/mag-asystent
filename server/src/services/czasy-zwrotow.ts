import { db } from "../db/db.js";
import { czasAktywny, PODSTAWA_PRAWNA, PROG_WIARYGODNOSCI } from "./raporty.js";

/* ── Czasy obsługi zwrotu — ile towar stoi, zanim wróci na półkę ─────────────
   Statystyki produktowe (`statystyki-zwrotow.ts`) mówią, CO wraca. Ta karta
   mówi, JAK DŁUGO to trwa — a to jedyna liczba w całym procesie zwrotów, która
   przelicza się wprost na pieniądze: towar w buforze jest niesprzedawalny,
   więc każda godzina drogi od drzwi do regału to zamrożony kapitał.

   OKNO LICZY SIĘ OD ZDARZENIA KOŃCZĄCEGO ODCINEK, nie od przyjęcia paczki.
   Odpowiadamy na pytanie „ile trwało to, co się w tym oknie SKOŃCZYŁO", a nie
   „ile trwało to, co w tym oknie przyszło". Różnica jest istotna: przy drugim
   liczeniu sprawy jeszcze niedokończone — czyli z definicji te najwolniejsze —
   nigdy nie weszłyby do mediany i proces wyglądałby na szybszy, niż jest.

   Cena tego wyboru: rzeczy STOJĄCE nadal nie są tu widoczne, bo się nie
   skończyły. Dlatego odpowiedź niesie sekcję `teraz` — listę spraw, które
   czekają w tej chwili. Mediana mówi o przeszłości, tamta lista o dzisiaj
   i dopiero razem nie kłamią.                                                */

/** Mediana i ogon w jednym: p50 mówi o typowym dniu, p90 o tym, co boli. */
export interface Odcinek {
  klucz: string;
  nazwa: string;
  /** Co dokładnie jest mierzone — jedno zdanie na kafel. */
  opis: string;
  medianaH: number | null;
  p90H: number | null;
  /** Ile zdarzeń weszło do wyniku. Mediana z dwóch to nie wynik. */
  ile: number;
  /** Gdy `ile` jest zerem — dlaczego. Puste pole bez wyjaśnienia kłamie. */
  czemuPusto: string | null;
}

export interface CzasyZwrotow {
  dni: number;
  odcinki: Odcinek[];
  /** Trend całej drogi. `ile` przy słupku mówi, na ilu zwrotach on stoi. */
  tygodnie: Array<{ tydzien: string; medianaH: number | null; ile: number }>;
  ludzie: Array<{
    kto: string;
    pozycji: number;
    minutyAktywne: number;
    /** Pozycji na godzinę pracy aktywnej; `null` przy zbyt małej próbce. */
    tempo: number | null;
    wiarygodne: boolean;
  }>;
  /** Monitoring pracowniczy — jedzie z danymi, żeby nie dało się go pominąć. */
  podstawaPrawna: string;
  progWiarygodnosci: number;
  teraz: {
    kosze: Array<{
      id: number;
      kod: string;
      zamknietoAt: string;
      godzin: number;
      doZrobienia: number;
      pozycji: number;
    }>;
    zwroty: Array<{
      id: number;
      waybill: string;
      referencja: string | null;
      utworzonoAt: string;
      godzin: number;
      etap: string;
    }>;
  };
}

/** Kwantyl z posortowanej listy, rangą w dół — tak samo jak mediana w raporcie. */
function kwantyl(posortowane: number[], q: number): number | null {
  if (!posortowane.length) return null;
  const i = Math.min(posortowane.length - 1, Math.floor((posortowane.length - 1) * q));
  return Math.round(posortowane[i] * 10) / 10;
}

/**
 * Godziny odcinka, posortowane rosnąco i oczyszczone z wartości ujemnych.
 *
 * Ujemna różnica znaczy, że zdarzenie kończące ma wcześniejszy znacznik niż
 * zaczynające — po cofnięciu i powtórzeniu kroku to możliwe. Taka liczba nie
 * jest „bardzo szybkim odcinkiem", tylko brakiem odcinka, i w medianie
 * ciągnęłaby wynik w dół bez pokrycia w rzeczywistości.
 */
function godziny(sql: string, odKiedy: string): number[] {
  return (db().prepare(sql).all(odKiedy) as Array<{ h: number | null }>)
    .map((w) => w.h)
    .filter((h): h is number => h != null && h >= 0)
    .sort((a, b) => a - b);
}

function odcinek(
  klucz: string,
  nazwa: string,
  opis: string,
  h: number[],
  czemuPusto: string
): Odcinek {
  return {
    klucz,
    nazwa,
    opis,
    medianaH: kwantyl(h, 0.5),
    p90H: kwantyl(h, 0.9),
    ile: h.length,
    czemuPusto: h.length ? null : czemuPusto,
  };
}

/* Zwrot jest OCENIONY, gdy KAŻDA jego pozycja ma decyzję — jedna nieoceniona
   trzyma całą paczkę, więc liczy się znacznik ostatniej, nie pierwszej. */
const OCENIONY = "SUM(CASE WHEN p.decyzja_at IS NULL THEN 1 ELSE 0 END) = 0";

export function czasyZwrotow(dni: number): CzasyZwrotow {
  const d = db();
  const odKiedy = `-${dni} days`;

  const doOceny = godziny(
    `SELECT (julianday(MAX(p.decyzja_at)) - julianday(z.utworzono_at)) * 24.0 AS h
     FROM zwrot z JOIN zwrot_pozycja p ON p.zwrot_id = z.id
     GROUP BY z.id
     HAVING ${OCENIONY} AND MAX(p.decyzja_at) >= datetime('now', ?)`,
    odKiedy
  );

  const doKosza = godziny(
    `SELECT (julianday(k.zamknieto_at) - julianday(MAX(p.decyzja_at))) * 24.0 AS h
     FROM zwrot z
     JOIN kosz k ON k.id = z.kosz_id
     JOIN zwrot_pozycja p ON p.zwrot_id = z.id
     WHERE k.zamknieto_at IS NOT NULL AND k.zamknieto_at >= datetime('now', ?)
     GROUP BY z.id
     HAVING ${OCENIONY}`,
    odKiedy
  );

  /* Serce karty: ile kosz czeka od zamknięcia do odłożenia towaru na regał.
     Liczone per POZYCJA, nie per kosz — kosz rozłożony w pięć minut poza jedną
     pozycją odłożoną nazajutrz to nie jest „kosz rozłożony w pięć minut". */
  const doPolki = godziny(
    `SELECT (julianday(kp.odlozono_at) - julianday(k.zamknieto_at)) * 24.0 AS h
     FROM kosz_pozycja kp JOIN kosz k ON k.id = kp.kosz_id
     WHERE kp.odlozono_at IS NOT NULL AND k.zamknieto_at IS NOT NULL
       AND kp.odlozono_at >= datetime('now', ?)`,
    odKiedy
  );

  /* Cała droga: od skanu etykiety u drzwi do chwili, gdy OSTATNIA pozycja
     zwrotu stoi na regale. Pozycja pominięta nie ma `odlozono_at`, więc zwrot
     z pominięciem tu nie wchodzi — i słusznie: on jeszcze nie wrócił. */
  const razem = godziny(
    `SELECT (julianday(MAX(kp.odlozono_at)) - julianday(z.utworzono_at)) * 24.0 AS h
     FROM zwrot z JOIN kosz_pozycja kp ON kp.zwrot_id = z.id
     GROUP BY z.id
     HAVING SUM(CASE WHEN kp.odlozono_at IS NULL THEN 1 ELSE 0 END) = 0
        AND MAX(kp.odlozono_at) >= datetime('now', ?)`,
    odKiedy
  );

  const doPieniedzy = godziny(
    `SELECT (julianday(zwrot_srodkow_at) - julianday(utworzono_at)) * 24.0 AS h
     FROM zwrot
     WHERE zwrot_srodkow_at IS NOT NULL AND zwrot_srodkow_at >= datetime('now', ?)`,
    odKiedy
  );

  const odcinki = [
    odcinek(
      "razem",
      "PRZYJĘCIE → PÓŁKA",
      "Cała droga towaru: od skanu etykiety do odłożenia ostatniej pozycji na regał.",
      razem,
      "Żaden zwrot nie przeszedł w tym oknie całej drogi. Kosze z dokumentu MM nie mają przypiętego zwrotu i do tej liczby nie wchodzą."
    ),
    odcinek(
      "doOceny",
      "PRZYJĘCIE → OCENA",
      "Ile paczka czeka, aż biuro obejrzy towar i nada decyzję każdej pozycji.",
      doOceny,
      "Żaden zwrot nie został w tym oknie oceniony do końca."
    ),
    odcinek(
      "doKosza",
      "OCENA → ZAMKNIĘCIE KOSZA",
      "Ile oceniony towar czeka w biurze, zanim kosz pojedzie na halę.",
      doKosza,
      "Żaden kosz ze zwrotami nie został w tym oknie zamknięty."
    ),
    odcinek(
      "doPolki",
      "ZAMKNIĘCIE KOSZA → PÓŁKA",
      "Czas rozłożenia: ile pozycja czeka od zamknięcia kosza do odłożenia na regał.",
      doPolki,
      "W tym oknie nie odłożono żadnej pozycji z kosza."
    ),
    odcinek(
      "doPieniedzy",
      "PRZYJĘCIE → ZWROT ŚRODKÓW",
      "Ile klient czeka na pieniądze od chwili, gdy paczka dotarła do nas.",
      doPieniedzy,
      "W tym oknie nie odnotowano żadnego zwrotu środków."
    ),
  ];

  /* Trend całej drogi. Tygodnie PUSTE zostają na osi z tego samego powodu co
     w statystykach produktowych: wykres bez słupka to co innego niż wykres
     bez tygodnia, a zwinięta oś udaje równy rytm tam, gdzie była przerwa. */
  const perTydzien = new Map<string, number[]>();
  for (const w of d
    .prepare(
      `SELECT strftime('%Y-%W', MAX(kp.odlozono_at)) AS tydzien,
              (julianday(MAX(kp.odlozono_at)) - julianday(z.utworzono_at)) * 24.0 AS h
       FROM zwrot z JOIN kosz_pozycja kp ON kp.zwrot_id = z.id
       GROUP BY z.id
       HAVING SUM(CASE WHEN kp.odlozono_at IS NULL THEN 1 ELSE 0 END) = 0
          AND MAX(kp.odlozono_at) >= datetime('now', ?)`
    )
    .all(odKiedy) as Array<{ tydzien: string; h: number | null }>) {
    if (w.h == null || w.h < 0) continue;
    const lista = perTydzien.get(w.tydzien);
    if (lista) lista.push(w.h);
    else perTydzien.set(w.tydzien, [w.h]);
  }
  const tygodnie = (
    d
      .prepare(
        `WITH RECURSIVE kalendarz(dzien) AS (
           SELECT date('now', ?)
           UNION ALL SELECT date(dzien, '+1 day') FROM kalendarz WHERE dzien < date('now')
         )
         SELECT DISTINCT strftime('%Y-%W', dzien) AS tydzien FROM kalendarz ORDER BY tydzien`
      )
      .all(odKiedy) as Array<{ tydzien: string }>
  ).map((w) => {
    const h = (perTydzien.get(w.tydzien) ?? []).sort((a, b) => a - b);
    return { tydzien: w.tydzien, medianaH: kwantyl(h, 0.5), ile: h.length };
  });

  /* Tempo per magazynier. Miarą jest CZAS AKTYWNY z `raporty.ts`, a nie odstęp
     od zamknięcia kosza do odłożenia — ta druga liczba mierzyłaby głównie to,
     jak długo kosz czekał, zanim ktokolwiek go wziął, i karałaby człowieka za
     to, że sięgnął po najstarszą robotę. Jedna definicja tempa w całym
     projekcie zamiast drugiej, mniej uczciwej. */
  const znaczniki = new Map<string, number[]>();
  for (const w of d
    .prepare(
      `SELECT odlozono_przez AS kto, odlozono_at AS kiedy
       FROM kosz_pozycja
       WHERE odlozono_at >= datetime('now', ?)
         AND odlozono_przez IS NOT NULL AND odlozono_przez <> ''`
    )
    .all(odKiedy) as Array<{ kto: string; kiedy: string }>) {
    const t = Date.parse(znacznikIso(w.kiedy));
    if (Number.isNaN(t)) continue;
    const lista = znaczniki.get(w.kto);
    if (lista) lista.push(t);
    else znaczniki.set(w.kto, [t]);
  }
  const ludzie = [...znaczniki.entries()]
    .map(([kto, czasy]) => {
      const minuty = czasAktywny(czasy);
      const wiarygodne = czasy.length >= PROG_WIARYGODNOSCI && minuty > 0;
      return {
        kto,
        pozycji: czasy.length,
        minutyAktywne: Math.round(minuty),
        tempo: wiarygodne ? Math.round((czasy.length / (minuty / 60)) * 10) / 10 : null,
        wiarygodne,
      };
    })
    .sort((a, b) => b.pozycji - a.pozycji);

  return {
    dni,
    odcinki,
    tygodnie,
    ludzie,
    podstawaPrawna: PODSTAWA_PRAWNA,
    progWiarygodnosci: PROG_WIARYGODNOSCI,
    teraz: coStoiTeraz(),
  };
}

/** Znacznik z bazy bywa bez strefy — SQLite pisze `YYYY-MM-DD HH:MM:SS` w UTC. */
function znacznikIso(s: string): string {
  return /[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z";
}

/**
 * Co czeka W TEJ CHWILI — druga połowa prawdy o czasach.
 *
 * Mediana liczy się z rzeczy ZAKOŃCZONYCH, więc sprawa stojąca trzeci tydzień
 * nie ma na nią żadnego wpływu aż do dnia, w którym ktoś ją domknie. Ta lista
 * jest po to, żeby taka sprawa była widoczna wcześniej niż w statystyce.
 */
function coStoiTeraz(): CzasyZwrotow["teraz"] {
  const d = db();
  const kosze = (
    d
      .prepare(
        `SELECT k.id, k.kod, k.zamknieto_at AS zamknietoAt,
                (julianday('now') - julianday(k.zamknieto_at)) * 24.0 AS godzin,
                COUNT(kp.id) AS pozycji,
                SUM(CASE WHEN kp.status = 'todo' THEN 1 ELSE 0 END) AS doZrobienia
         FROM kosz k LEFT JOIN kosz_pozycja kp ON kp.kosz_id = k.id
         WHERE k.status = 'zamkniety' AND k.zamknieto_at IS NOT NULL
         GROUP BY k.id
         ORDER BY k.zamknieto_at
         LIMIT 10`
      )
      .all() as Array<Record<string, unknown>>
  ).map((w) => ({
    id: w.id as number,
    kod: w.kod as string,
    zamknietoAt: w.zamknietoAt as string,
    godzin: Math.round((w.godzin as number) * 10) / 10,
    pozycji: w.pozycji as number,
    doZrobienia: (w.doZrobienia as number) ?? 0,
  }));

  /* Etap mówi, CZEGO sprawa czeka — bez tego lista jest samą listą numerów,
     a biuro i tak musi otworzyć każdy zwrot, żeby wiedzieć, co z nim zrobić. */
  const zwroty = (
    d
      .prepare(
        `SELECT z.id, z.waybill, z.referencja, z.utworzono_at AS utworzonoAt,
                (julianday('now') - julianday(z.utworzono_at)) * 24.0 AS godzin,
                CASE
                  WHEN SUM(CASE WHEN p.decyzja_at IS NULL THEN 1 ELSE 0 END) > 0
                    THEN 'czeka na ocenę'
                  WHEN z.kosz_id IS NULL THEN 'oceniony, bez kosza'
                  WHEN (SELECT status FROM kosz WHERE id = z.kosz_id) <> 'rozlozony'
                    THEN 'w koszu, nierozłożony'
                  ELSE 'czeka na zwrot środków'
                END AS etap
         FROM zwrot z LEFT JOIN zwrot_pozycja p ON p.zwrot_id = z.id
         WHERE z.status <> 'rozliczony'
         GROUP BY z.id
         ORDER BY z.utworzono_at
         LIMIT 10`
      )
      .all() as Array<Record<string, unknown>>
  ).map((w) => ({
    id: w.id as number,
    waybill: w.waybill as string,
    referencja: (w.referencja as string) ?? null,
    utworzonoAt: w.utworzonoAt as string,
    godzin: Math.round((w.godzin as number) * 10) / 10,
    etap: w.etap as string,
  }));

  return { kosze, zwroty };
}
