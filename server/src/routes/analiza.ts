import type { FastifyInstance } from "fastify";
import { ROLE_BIUROWE } from "../services/users.js";
import { analiza, type AnalizaAudytu } from "../services/raporty.js";
import { analizaDostaw } from "../services/podglad-dostawy.js";
import { wierszCsv, zbudujCsv } from "../services/csv.js";
import { logEvent } from "../services/events.js";
import { sesjaZadania } from "../context.js";
import { czasOdpowiedzi } from "../services/czas-odpowiedzi.js";
import { raportUzycia } from "../services/uzycie.js";
import { pomiarTarcia } from "../services/tarcie.js";
import { ergonomia } from "../services/ergonomia.js";
import { listaRaportow, raportTygodnia } from "../services/raport-tygodnia.js";

/* ── Analiza śladu audytowego dla biura ──────────────────────────────────────
   Jedna trasa z kompletem sekcji (zakładka ANALIZA robi jeden fetch) + CSV.

   BRAMKA JAK W AUDYCIE, nie jak w /api/metrics — i to jest różnica istotna,
   nie kosmetyczna. Metryki opisują SYSTEM i wolno je pokazać każdemu
   zalogowanemu. Analiza niesie raport wydajności per osoba, czyli monitoring
   pracowniczy — czyta go biuro, nie hala.                                     */

/* Jedno źródło listy (services/users.ts) — czwarta ręczna kopia ról była
   zapalnikiem, przed którym kod ostrzegał w trzech miejscach naraz. */
const CZYTAJACY = ROLE_BIUROWE;

/* RAPORT PER OSOBA TYLKO DLA ADMINISTRATORA (0.431.0, decyzja właściciela).
   Do tej wersji czytało go całe biuro, a `services/auth.ts` mówiło wprost, że
   admin nie ma nad biurem przewagi w raporcie o pracy ludzi. Audyt 0.427.0
   odwrócił tę kolejność: monitoring pracowniczy to decyzja kadrowa, nie
   robota biura przy dostawie. Reszta analizy zostaje dla biura bez zmian.
   Sprawdzane tutaj, nie w przeglądarce — raport nie powinien opuszczać
   serwera w odpowiedzi dla kogoś, kto i tak by go nie zobaczył. */
function mozeWidziecLudzi(): boolean {
  return sesjaZadania()?.user.role === "admin";
}

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
 * `OKNA.dostawy` w `panel/src/ekrany/Analiza.tsx` — czip spoza zbioru wyglądałby na
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
    return analiza(dniZQuery(req.query.days), mozeWidziecLudzi());
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

  /**
   * Czas odpowiedzi klientowi (23 września 2026) — zakres „Obsługa klienta".
   *
   * Ta sama bramka co ślad audytowy i to samo okno 7/30/90: to tempo pracy,
   * patrzy się na nie od tygodnia. Rozbicie na osoby tą samą regułą co raport
   * wydajności — liczy się wyłącznie dla administratora, więc dla biura nie
   * opuszcza serwera wcale. Odczyt niczego nie zapisuje.
   */
  app.get<{ Querystring: { days?: string } }>("/api/analiza/obsluga", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return czasOdpowiedzi(dniZQuery(req.query.days), mozeWidziecLudzi());
  });

  /* Pomiar tarcia w skrzynce (@wydanie) — cofnięcia, czas do wysyłki
     i szkice wysłane bez zmian. Ta sama bramka i okno co czas odpowiedzi;
     rozbicie na osoby wyłącznie dla administratora. Odczyt niczego nie
     zapisuje. Powód każdej liczby przy `services/tarcie.ts`. */
  app.get<{ Querystring: { days?: string } }>("/api/analiza/tarcie", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return pomiarTarcia(dniZQuery(req.query.days), mozeWidziecLudzi());
  });

  /* Czego nikt nie używa (23 września 2026) — raport z dziennika zdarzeń,
     bez ludzi: liczy CZYNNOŚCI, nie osoby, więc bramka biura wystarcza.
     Odczyt niczego nie zapisuje. Powód i granice przy `services/uzycie.ts`. */
  app.get<{ Querystring: { days?: string } }>("/api/analiza/uzycie", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    /* Domyślnie MIESIĄC, nie tydzień jak ślad audytowy: funkcja nieużyta przez
       tydzień bywa po prostu rzadka — zwrot za pobraniem zdarza się raz na
       kilkanaście dni. Trzydzieści dni to próg z pytania właściciela. */
    const n = Number(req.query.days);
    return raportUzycia(n === 7 || n === 90 ? n : 30);
  });

  /**
   * Ergonomia w liczbach — zakres „Praca hali". Ta sama bramka i to samo okno
   * co ślad audytowy, bo liczy z tego samego dziennika. Dane per urządzenie
   * i per czynność, nigdy per osoba — powód w nagłówku `services/ergonomia.ts`.
   */
  app.get<{ Querystring: { days?: string } }>("/api/analiza/ergonomia", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return ergonomia(dniZQuery(req.query.days));
  });

  /* Raporty tygodni (0.497.0). Ta sama bramka biura, bo raport nie niesie
     ludzi — patrz nagłówek `services/raport-tygodnia.ts`. Trasy tylko
     CZYTAJĄ: raport zapisuje takt w `main()`, a tydzień niepoliczony
     odpowiada 404, nie liczy się w locie. Inaczej pierwsze otwarcie ekranu
     byłoby zapisem, a to łamie zasadę zera zapisu przy patrzeniu. */
  app.get("/api/analiza/tygodnie", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { tygodnie: listaRaportow() };
  });

  app.get<{ Params: { tydzien: string } }>("/api/analiza/tygodnie/:tydzien", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    if (!/^\d{4}-W\d{2}$/.test(req.params.tydzien)) {
      return reply.code(400).send({ error: "Tydzień w postaci RRRR-Www, np. 2026-W38" });
    }
    const r = raportTygodnia(req.params.tydzien);
    if (!r) return reply.code(404).send({ error: `Raportu tygodnia ${req.params.tydzien} nie ma` });
    return r;
  });

  app.get<{ Querystring: { days?: string } }>("/api/analiza/csv", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const a = analiza(dniZQuery(req.query.days), mozeWidziecLudzi());

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
     przekazywany dalej i ta informacja ma jechać razem z liczbami. Bez prawa
     do raportu (rola biuro) sekcji nie ma wcale, nawet nagłówka. */
  if (!a.wydajnosc) return zbudujCsv(linie);
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
