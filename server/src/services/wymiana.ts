import { db } from "../db/db.js";
import { mediana, OKNO } from "./raporty.js";

/**
 * Ile trwa wymiana między halą a biurem — własność „Miara".
 *
 * DLACZEGO TO POWSTAŁO. §22 projektu panelu wymienia „czas realizacji zadania
 * magazynowego" wśród metryk biznesowych i nie podaje przy nim ani progu, ani
 * miejsca pomiaru. W kodzie nie było go wcale: znaczniki obu końców każdej
 * wymiany leżą w bazie od lat — `utworzono_at`/`wykonano_at` przy zadaniach,
 * `created_at`/`resolved_at` przy niezgodnościach, `pominieto_at`/
 * `zalatwione_at` przy koszu — i NIKT NIGDY nie liczył różnicy. Trzy miejsca
 * czytały `wykonano_at`, żeby go WYŚWIETLIĆ.
 *
 * MEDIANA I OGON, NIGDY ŚREDNIA. Jedna sprawa sprzed tygodnia utopiłaby sto
 * załatwionych w kwadrans, a właśnie ta jedna jest tu treścią. `p90` mówi,
 * jak wygląda zły dzień; mediana — jak wygląda zwykły.
 *
 * KAŻDA LICZBA NIESIE SWOJE `n`. Reguła z raportu wydajności magazynu:
 * mediana z czterech spraw i tak zostanie przeczytana jako werdykt, więc
 * liczba spraw jedzie obok, a nie w przypisie.
 *
 * CZEGO TU NIE MA: PROGU „ZA PÓŹNO". Żadna liczba godzin nie jest ustaleniem
 * właściciela — §22 wymienia metrykę i nie podaje terminu. Raport pokazuje,
 * ile trwa; czy to długo, rozstrzyga człowiek. Termin wpisany tutaj byłby
 * werdyktem, którego nikt nie wydał.
 *
 * OTWARTE LICZĄ SIĘ OSOBNO i to nie jest ozdoba: wymiana, która trwa DO DZIŚ,
 * nie ma czasu zamknięcia, więc nie wchodzi do mediany — a bywa najgorsza
 * z całej listy. Bez kolumny „najstarsza otwarta" raport pokazywałby wyłącznie
 * sprawy, które ktoś domknął, czyli mierzył własny sukces.
 */

export interface WierszWymiany {
  /** Klucz kanału — polszczyzna stoi na ekranie, nie w API. */
  kanal: "zadanie" | "niezgodnosc" | "pominiecie" | "kolizja";
  /** Kierunek: kto na kogo czeka, gdy sprawa stoi. */
  kierunek: "biuro→hala" | "hala→biuro";
  zamknietych: number;
  medianaMin: number | null;
  p90Min: number | null;
  otwartych: number;
  najstarszaOtwartaMin: number | null;
}

/** Dziewięćdziesiąty percentyl metodą najbliższej rangi — bez interpolacji. */
export function p90(liczby: number[]): number | null {
  if (liczby.length === 0) return null;
  const s = [...liczby].sort((a, b) => a - b);
  /* Najbliższa ranga, nie interpolacja: przy ośmiu sprawach interpolacja
     zwróciłaby liczbę, której żadna sprawa nie miała — a ten raport ma mówić
     o sprawach, nie o rozkładzie. */
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

const MINUTA = 60_000;
const zaokr = (v: number | null) => (v === null ? null : Math.round(v));

/** Minuty między dwoma znacznikami ISO; `null`, gdy któregoś nie ma. */
function minuty(od: string | null | undefined, do_: string | null | undefined): number | null {
  if (!od || !do_) return null;
  const m = (Date.parse(do_) - Date.parse(od)) / MINUTA;
  /* Ujemne odpadają zamiast psuć medianę. Biorą się z ręcznych poprawek
     znaczników i z zegara maszyny przestawionego wstecz — ta sama ostrożność
     co przy czasie do wyboru w raporcie skuteczności doboru. */
  return Number.isFinite(m) && m >= 0 ? m : null;
}

function wiersz(
  kanal: WierszWymiany["kanal"],
  kierunek: WierszWymiany["kierunek"],
  zamkniete: number[],
  otwarte: number[],
): WierszWymiany {
  return {
    kanal,
    kierunek,
    zamknietych: zamkniete.length,
    medianaMin: zaokr(mediana(zamkniete)),
    p90Min: zaokr(p90(zamkniete)),
    otwartych: otwarte.length,
    najstarszaOtwartaMin: otwarte.length ? zaokr(Math.max(...otwarte)) : null,
  };
}

/**
 * Cztery kanały, jedno okno czasu.
 *
 * Notatek do dostaw tu NIE MA i to jest świadome: ich pętla ma własny licznik
 * nieprzeczytanych odpowiedzi w nagłówku panelu (0.77.0), a odpowiedź na
 * notatkę bywa rozmową na kilka tur — „czas wymiany" znaczyłby tam co innego
 * niż w pozostałych czterech i jedna tabela kłamałaby o obu naraz.
 */
export function czasyWymiany(dni = 30, teraz = Date.now()): {
  dni: number;
  wiersze: WierszWymiany[];
} {
  const okno = OKNO(dni);
  const granica = "strftime('%Y-%m-%dT%H:%M:%fZ','now',?)";

  /* ── Zadania terenowe: zlecenie → wynik ALBO odesłanie ──────────────────
     Odesłanie liczy się jako zamknięcie, bo hala odpowiedziała. Gdyby nie
     liczyło, „czas realizacji" mierzyłby wyłącznie zadania, które się udały —
     a te trudne wypadałyby z miary właśnie dlatego, że były trudne. */
  const zadania = db().prepare(
    `SELECT utworzono_at AS od, COALESCE(wykonano_at, odeslano_at) AS domkniete, status
       FROM zadanie_terenowe WHERE utworzono_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null; status: string }>;

  const nadal = (s: string) => s === "nowe" || s === "w_toku";
  const zadaniaZamkniete = zadania
    .map((z) => (nadal(z.status) ? null : minuty(z.od, z.domkniete)))
    .filter((m): m is number => m !== null);
  const zadaniaOtwarte = zadania
    .filter((z) => nadal(z.status))
    .map((z) => minuty(z.od, new Date(teraz).toISOString()))
    .filter((m): m is number => m !== null);

  /* ── Niezgodności w dostawie: zgłoszenie → zamknięcie przez biuro ─────── */
  const problemy = db().prepare(
    `SELECT created_at AS od, resolved_at AS domkniete
       FROM problem WHERE created_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  /* ── Pominięcia w koszu: pominięcie → załatwienie ─────────────────────── */
  const pominiecia = db().prepare(
    `SELECT pominieto_at AS od, zalatwione_at AS domkniete
       FROM kosz_pozycja WHERE pominieto_at IS NOT NULL AND pominieto_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  /* ── Kolizje kodów: PIERWSZE trafienie → decyzja biura ─────────────────
     Pierwsze, nie ostatnie: sprawa zaczyna się wtedy, gdy kod zatrzymał
     kogoś po raz pierwszy, a nie gdy zatrzymał po raz dwudziesty. */
  const kolizje = db().prepare(
    `SELECT MIN(c.seen_at) AS od, r.at AS domkniete
       FROM ean_conflict c LEFT JOIN ean_rozstrzygniecie r ON r.ean = c.ean
      WHERE c.seen_at >= ${granica} GROUP BY c.ean`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  const rozbij = (w: Array<{ od: string; domkniete: string | null }>) => {
    const zamkniete: number[] = [];
    const otwarte: number[] = [];
    for (const r of w) {
      const m = r.domkniete
        ? minuty(r.od, r.domkniete)
        : minuty(r.od, new Date(teraz).toISOString());
      if (m === null) continue;
      (r.domkniete ? zamkniete : otwarte).push(m);
    }
    return { zamkniete, otwarte };
  };

  const p = rozbij(problemy);
  const k = rozbij(pominiecia);
  const e = rozbij(kolizje);

  return {
    dni,
    wiersze: [
      wiersz("zadanie", "biuro→hala", zadaniaZamkniete, zadaniaOtwarte),
      wiersz("niezgodnosc", "hala→biuro", p.zamkniete, p.otwarte),
      wiersz("pominiecie", "hala→biuro", k.zamkniete, k.otwarte),
      wiersz("kolizja", "hala→biuro", e.zamkniete, e.otwarte),
    ],
  };
}
