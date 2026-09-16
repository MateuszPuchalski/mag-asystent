import { db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Rejestr kolizji kodów kreskowych (§4.5) ──────────────────────────────────
   Ten sam EAN na kilku kartotekach zatrzymuje pracę w alejce (D7). Zamiast
   znosić to w nieskończoność, zapisujemy każde trafienie: aplikacja staje się
   instrumentem pomiaru jakości danych, a biuro dostaje listę kodów do naprawy.

   Osobny moduł, żeby `delivery` (który zapisuje kolizje) i `problems` (który
   domyka dostawę po zgłoszeniu wyjątku) nie zapętliły się na imporcie.        */

const nowIso = () => new Date().toISOString();

export function recordEanConflict(
  ean: string,
  twIds: number[],
  auto: boolean
): void {
  db()
    .prepare("INSERT INTO ean_conflict(ean, tw_ids, auto, seen_at) VALUES (?,?,?,?)")
    .run(ean, JSON.stringify(twIds), auto ? 1 : 0, nowIso());
}

/** Kartoteka z kolizji — surowe tw_Id nie mówi człowiekowi nic. */
export interface KolizjaTowar {
  twId: number;
  sym: string;
  name: string;
}

/**
 * Co biuro postanowiło z kodem (0.360.0).
 *
 * DWA RODZAJE, bo hala reaguje na nie odwrotnie — patrz `schema.sql`.
 * `poprawione` obiecuje, że kolizja zniknie; `dopuszczone` mówi, że zostanie
 * i ma zostać.
 */
export const RODZAJE_ROZSTRZYGNIECIA = ["poprawione", "dopuszczone"] as const;
export type RodzajRozstrzygniecia = (typeof RODZAJE_ROZSTRZYGNIECIA)[number];

export interface RozstrzygniecieKolizji {
  rodzaj: RodzajRozstrzygniecia;
  notatka: string | null;
  at: string;
  przez: string;
}

/**
 * Biuro zamyka sprawę kodu. Ponowne wywołanie NADPISUJE poprzednią decyzję.
 *
 * Nadpisanie, a nie druga decyzja obok: pytanie brzmi „co z tym kodem jest
 * teraz", a nie „co kiedykolwiek o nim myślano". Historia zostaje w księdze
 * zdarzeń, gdzie zresztą jest jej miejsce — i tam widać, że `poprawione`
 * zamieniono później na `dopuszczone`, bo poprawka nie zadziałała.
 */
export function rozstrzygnijKolizje(
  ean: string,
  rodzaj: RodzajRozstrzygniecia,
  notatka: string | undefined,
  autor: { id: number; name: string },
): { ok: true } | { error: string } {
  const kod = ean.trim();
  if (!kod) return { error: "Podaj kod kreskowy" };
  if (!RODZAJE_ROZSTRZYGNIECIA.includes(rodzaj)) {
    return { error: "Rozstrzygnięcie to `poprawione` albo `dopuszczone`" };
  }
  const tresc = notatka?.trim() || null;
  if (tresc && tresc.length > 500) return { error: "Notatka może mieć najwyżej 500 znaków" };
  /* Kolizji, której nigdy nie było, nie ma co rozstrzygać — inaczej lista
     zapełniłaby się decyzjami o kodach, których hala nigdy nie spotkała. */
  const widziany = db().prepare("SELECT 1 FROM ean_conflict WHERE ean=? LIMIT 1").get(kod);
  if (!widziany) return { error: "Ten kod nie zatrzymał jeszcze nikogo w alejce" };

  /* Granicą jest OSTATNIE TRAFIENIE, nie chwila zapisu. Po samym znaczniku
     trafienie z tej samej milisekundy co decyzja wpadało po złej stronie —
     ta sama blizna co w raporcie skuteczności doboru (0.352.0). */
  const ostatnie = db().prepare(
    "SELECT COALESCE(MAX(id),0) AS id FROM ean_conflict WHERE ean=?").get(kod) as { id: number };
  db().prepare(
    `INSERT INTO ean_rozstrzygniecie(ean, rodzaj, notatka, at, przez, przez_user_id, po_trafieniu_id)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(ean) DO UPDATE SET
       rodzaj=excluded.rodzaj, notatka=excluded.notatka,
       at=excluded.at, przez=excluded.przez, przez_user_id=excluded.przez_user_id,
       po_trafieniu_id=excluded.po_trafieniu_id`
  ).run(kod, rodzaj, tresc, nowIso(), autor.name, autor.id, Number(ostatnie.id));
  logEvent("ean_kolizja_rozstrzygnieta", autor.name, null, { ean: kod, rodzaj });
  return { ok: true };
}

/** Zagregowany raport — ile razy który kod zatrzymał pracę. */
export function eanConflictReport(): Array<{
  ean: string;
  hits: number;
  autoResolved: number;
  twIds: number[];
  towary: KolizjaTowar[];
  lastSeen: string;
  /** Decyzja biura albo `null`, gdy nikt się jeszcze nie wypowiedział. */
  rozstrzygniecie: RozstrzygniecieKolizji | null;
  /**
   * Trafienia PO rozstrzygnięciu — 0, gdy decyzji nie ma.
   *
   * Liczone po `id` dziennika, nie po znaczniku: trafienie z tej samej
   * milisekundy co decyzja nie dałoby się rozstrzygnąć czasem (0.352.0).
   *
   * Przy `poprawione` liczba większa od zera jest DOWODEM, że poprawka nie
   * zadziałała, i nie wymaga niczyjej oceny: biuro obiecało, że kolizja
   * zniknie, a kod zatrzymał kogoś jeszcze raz. Przy `dopuszczone` ta sama
   * liczba nie znaczy nic złego — tam trafienia mają wracać.
   */
  trafienPoDecyzji: number;
}> {
  /* Decyzja i liczba trafień PO niej jednym złączeniem, nie zapytaniem na
     wiersz: lista kolizji bywa długa, a raport czyta ją i kolektor, i biuro. */
  const rows = db()
    .prepare(
      `SELECT c.ean, COUNT(*) AS hits, SUM(c.auto) AS autoResolved,
              MAX(c.seen_at) AS lastSeen, MAX(c.tw_ids) AS twIds,
              r.rodzaj AS rodzaj, r.notatka AS notatka, r.at AS decyzjaAt, r.przez AS przez,
              SUM(CASE WHEN r.ean IS NOT NULL AND c.id > r.po_trafieniu_id THEN 1 ELSE 0 END) AS poDecyzji
       FROM ean_conflict c LEFT JOIN ean_rozstrzygniecie r ON r.ean = c.ean
       GROUP BY c.ean ORDER BY hits DESC, c.ean`
    )
    .all() as Array<{ ean: string; hits: number; autoResolved: number; lastSeen: string; twIds: string;
      rodzaj: string | null; notatka: string | null; decyzjaAt: string | null; przez: string | null;
      poDecyzji: number }>;

  /* Symbole i nazwy jednym zapytaniem dla wszystkich kolizji naraz. Kartoteka
     skasowana po zapisaniu kolizji wraca z pustym symbolem — identyfikator
     zostaje w `twIds`, więc informacja nie znika, tylko traci wygodną formę. */
  const wszystkieIds = new Set<number>();
  const parsed = rows.map((r) => {
    const ids = JSON.parse(r.twIds || "[]") as number[];
    for (const id of ids) wszystkieIds.add(id);
    return { r, ids };
  });
  const znane = new Map<number, { sym: string; name: string }>();
  if (wszystkieIds.size > 0) {
    const dziury = [...wszystkieIds].map(() => "?").join(",");
    const towary = db()
      .prepare(`SELECT tw_id, symbol, nazwa FROM sgt_towar WHERE tw_id IN (${dziury})`)
      .all(...wszystkieIds) as unknown as Array<{ tw_id: number; symbol: string; nazwa: string }>;
    for (const t of towary) znane.set(t.tw_id, { sym: t.symbol, name: t.nazwa });
  }

  return parsed.map(({ r, ids }) => ({
    ean: r.ean,
    hits: r.hits,
    autoResolved: r.autoResolved ?? 0,
    twIds: ids,
    towary: ids.map((id) => ({
      twId: id,
      sym: znane.get(id)?.sym ?? "",
      name: znane.get(id)?.name ?? "",
    })),
    lastSeen: r.lastSeen,
    rozstrzygniecie: r.rodzaj
      ? {
          rodzaj: r.rodzaj as RodzajRozstrzygniecia,
          notatka: r.notatka ?? null,
          at: String(r.decyzjaAt),
          przez: String(r.przez ?? "biuro"),
        }
      : null,
    trafienPoDecyzji: Number(r.poDecyzji ?? 0),
  }));
}
