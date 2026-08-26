import type { FastifyInstance } from "fastify";
import { ROLE_BIUROWE } from "../services/users.js";
import { analiza, type AnalizaAudytu } from "../services/raporty.js";
import { analizaDostaw } from "../services/podglad-dostawy.js";
import { wierszCsv, zbudujCsv } from "../services/csv.js";
import { logEvent } from "../services/events.js";
import { sesjaZadania } from "../context.js";

/* ── Analiza śladu audytowego dla biura ──────────────────────────────────────
   Jedna trasa z kompletem sekcji (zakładka ANALIZA robi jeden fetch) + CSV.

   BRAMKA JAK W AUDYCIE, nie jak w /api/metrics — i to jest różnica istotna,
   nie kosmetyczna. Metryki opisują SYSTEM i wolno je pokazać każdemu
   zalogowanemu. Analiza niesie raport wydajności per osoba, czyli monitoring
   pracowniczy — czyta go biuro, nie hala.                                     */

/* Jedno źródło listy (services/users.ts) — czwarta ręczna kopia ról była
   zapalnikiem, przed którym kod ostrzegał w trzech miejscach naraz. */
const CZYTAJACY = ROLE_BIUROWE;

/** Okno przycinane do trzech wartości, które oferuje selektor strony. */
function dniZQuery(v: string | undefined): number {
  const n = Number(v);
  return n === 30 || n === 90 ? n : 7;
}

/**
 * Okno zakresu DOSTAWY — inny zbiór niż ślad audytowy i to jest zamierzone.
 *
 * Ślad mierzy TEMPO PRACY i sensownie patrzy się na niego od tygodnia. Dostawa
 * przyjeżdża co kilka dni, więc tydzień bywa w niej pusty, a mediana czasu
 * rozłożenia z dwóch faktur nie mówi nic. Ta lista MUSI zgadzać się z
 * `OKNA_ANALIZY.dostawy` w `web/biuro.html` — czip spoza zbioru wyglądałby na
 * wybrany, a trasa liczyłaby po cichu swoje domyślne. Dokładnie tak rozjechało
 * się okno pytań w 0.96.0.
 */
function dniDostaw(v: string | undefined): number {
  const n = Number(v);
  return n === 30 || n === 180 ? n : 90;
}

export async function analizaRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!CZYTAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Analiza jest dostępna dla biura" };
    }
    return null;
  }

  app.get<{ Querystring: { days?: string } }>("/api/analiza", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return analiza(dniZQuery(req.query.days));
  });

  /**
   * Analiza dostaw (0.100.0) — czwarty zakres zakładki.
   *
   * Ta sama bramka co ślad audytowy, choć dane nie są imienne. Karta odpowiada
   * na pytanie „u którego dostawcy jest problem", a to jest ocena kontrahenta:
   * wniesie się ją na rozmowę handlową, nie na halę. Trasa mieszka tu, a nie
   * w `routes/biuro.ts`, właśnie dla tej bramki — tamten plik jej nie ma, bo
   * pokazuje to, co i tak widać na liście dostaw.
   */
  app.get<{ Querystring: { dni?: string } }>("/api/biuro/dostawy/analiza", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { analiza: analizaDostaw(dniDostaw(req.query.dni)) };
  });

  app.get<{ Querystring: { days?: string } }>("/api/analiza/csv", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const a = analiza(dniZQuery(req.query.days));

    /* Eksport zawiera dane imienne, więc zostawia ślad — ta sama zasada co
       `audyt_eksport`: kto pobiera zestawienia o ludziach, sam trafia do logu. */
    const s = sesjaZadania();
    logEvent("analiza_eksport", s?.user.name ?? "?", null, { days: a.days });

    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="wertis-analiza-${a.days}d.csv"`)
      .send(csvAnalizy(a));
  });
}

/**
 * Jeden plik, sekcje rozdzielone pustą linią i nagłówkiem — biuro dostaje
 * całość na raz, zamiast pięciu osobnych plików do sklejania w Excelu.
 * Separator `;`, bo to eksport „dla biura" (patrz services/csv.ts).
 */
export function csvAnalizy(a: AnalizaAudytu): string {
  const SEP = ";" as const;
  const w = (pola: unknown[]) => wierszCsv(pola, SEP);
  const linie: string[] = [];

  linie.push(`# WERTIS analiza · okno ${a.days} dni`, "");

  linie.push("# OPERACJE PER DZIEN", w(["data", "pozycje", "zdarzen"]));
  for (const d of a.dni) linie.push(w([d.data, d.pozycje, d.zdarzen]));

  linie.push("", "# ROZKLAD PO GODZINACH (operacje)", w(["godzina", "operacji"]));
  a.godziny.forEach((ile, g) => linie.push(w([g, ile])));

  linie.push(
    "",
    "# RYTM MAGAZYNU",
    w(["dostaw zamknietych", "mediana minut", "pozycji na dostawe", "problemy zgloszone", "rozwiazane", "otwarte"]),
    w([
      a.rytm.dostawZamknietych,
      a.rytm.medianaMinutDostawy ?? "",
      a.rytm.pozycjiNaDostawe ?? "",
      a.rytm.problemyZgloszone,
      a.rytm.problemyRozwiazane,
      a.rytm.problemyOtwarte,
    ])
  );

  linie.push("", "# NAJCZESCIEJ SZUKANE", w(["zapytanie", "razy"]));
  for (const t of a.szukania.top) linie.push(w([t.q, t.ile]));
  linie.push("", "# SZUKANE BEZ WYNIKU", w(["zapytanie", "razy"]));
  for (const t of a.szukania.bezWynikow) linie.push(w([t.q, t.ile]));

  linie.push("", "# URZADZENIA", w(["urzadzenie", "upadki", "niskie baterie", "odrzucone", "zdarzen"]));
  for (const u of a.urzadzenia)
    linie.push(w([u.device, u.upadki, u.niskieBaterie, u.odrzucone, u.zdarzen]));

  /* Sekcja imienna idzie OSTATNIA i z podstawą prawną nad danymi — plik bywa
     przekazywany dalej i ta informacja ma jechać razem z liczbami. */
  linie.push(
    "",
    "# WYDAJNOSC PER OSOBA",
    w([a.wydajnosc.podstawaPrawna]),
    w(["osoba", "pozycje", "minuty aktywne", "tempo/h", "zgloszone problemy (to nie miara bledu)", "wiarygodne"])
  );
  for (const o of a.wydajnosc.wiersze)
    linie.push(
      w([o.osoba, o.pozycje, o.minutyAktywne, o.tempo ?? "", o.zgloszoneProblemy, o.wiarygodne ? "tak" : "malo danych"])
    );
  if (a.wydajnosc.nieprzypisanychZdarzen > 0)
    linie.push(w(["(bez konta)", a.wydajnosc.nieprzypisanychZdarzen, "", "", "", ""]));

  return zbudujCsv(linie);
}
