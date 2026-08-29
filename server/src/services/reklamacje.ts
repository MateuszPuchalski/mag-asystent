import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { BladZwrotu } from "./zwroty.js";
import { liczbyZapowiedzi } from "./zapowiedzi.js";
import { przebudujSprawy } from "./sprawa.js";

/* ── Ścieżka reklamacyjna z priorytetem wg terminu (Etap 3) ──────────────────
   Pozycja z decyzją `reklamacja` staje się sprawą z TERMINEM: ustawowe 14 dni
   liczy się od zgłoszenia, a po nich reklamację uznaje się milcząco. Lista
   sortuje się rosnąco po dniach do terminu — nie po dacie wpływu — bo pytanie
   biura brzmi „co się dziś przeterminuje", nie „co przyszło pierwsze".

   Zegar startuje od `utworzono_allegro` (moment zgłoszenia zwrotu przez
   klienta), nie od decyzji pracownika: termin ustawowy nie czeka, aż ktoś
   u nas obejrzy paczkę. Zwrot ręczny bez tej daty liczy od przyjęcia skanem —
   wcześniejszej daty po prostu nie znamy.                                    */

export const WYNIKI_REKLAMACJI = ["uznana", "odrzucona"] as const;

export interface WierszReklamacji {
  pozycjaId: number;
  zwrotId: number;
  referencja: string | null;
  waybill: string;
  kupujacyLogin: string | null;
  nazwa: string;
  symbol: string | null;
  /** Kartoteka — po niej biuro dociąga zdjęcie towaru; NULL = towar spoza katalogu. */
  twId: number | null;
  ilosc: number;
  powod: string | null;
  powodOpis: string | null;
  notatka: string | null;
  zgloszono: string;
  termin: string;
  /** Ujemne = po terminie. Priorytet listy — rosnąco. */
  dniDoTerminu: number;
  poTerminie: boolean;
  wynik: string | null;
  rozpatrzonoAt: string | null;
  rozpatrzonoPrzez: string | null;
  reklNotatka: string | null;
  /** Półka, na której fizycznie leży reklamowany towar; null = nie odłożono. */
  polka: string | null;
  /** Kto wziął sprawę — znacznik dla reszty biura, nie blokada (wzorzec pytań). */
  prowadzi: string | null;
  prowadziAt: string | null;
}

const DZIEN_MS = 86_400_000;

/** Termin i dni do niego — czysta arytmetyka, eksport dla testów. */
export function terminReklamacji(
  zgloszono: string,
  teraz: number = Date.now(),
  dni: number = config.zwroty.reklamacjaDni
): { termin: string; dniDoTerminu: number } {
  const start = Date.parse(zgloszono);
  const t = (Number.isFinite(start) ? start : teraz) + dni * DZIEN_MS;
  return {
    termin: new Date(t).toISOString(),
    dniDoTerminu: Math.floor((t - teraz) / DZIEN_MS),
  };
}

export function listaReklamacji(
  opts: { rozpatrzone?: boolean; limit?: number } = {}
): WierszReklamacji[] {
  const filtr = opts.rozpatrzone ? "p.rekl_wynik IS NOT NULL" : "p.rekl_wynik IS NULL";
  /* Domyślne 200 zostaje (tyle mieści ekran z zapasem), ale sufit jest teraz
     opcją — raport i eksport nie mają powodu ucinać ogona listy. */
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const wiersze = db()
    .prepare(
      `SELECT p.id AS pozycja_id, p.zwrot_id, p.nazwa, p.external_id, p.tw_id, p.ilosc,
              p.powod, p.powod_opis, p.notatka,
              p.rekl_wynik, p.rekl_at, p.rekl_przez, p.rekl_notatka, p.rekl_polka,
              p.rekl_prowadzi, p.rekl_prowadzi_at,
              z.referencja, z.waybill, z.kupujacy_login, z.utworzono_allegro, z.utworzono_at
       FROM zwrot_pozycja p JOIN zwrot z ON z.id = p.zwrot_id
       WHERE p.decyzja = 'reklamacja' AND ${filtr}
       ORDER BY p.id DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;

  const teraz = Date.now();
  const lista = wiersze.map((w) => {
    const zgloszono = (w.utworzono_allegro as string) ?? (w.utworzono_at as string);
    const { termin, dniDoTerminu } = terminReklamacji(zgloszono, teraz);
    return {
      pozycjaId: w.pozycja_id as number,
      zwrotId: w.zwrot_id as number,
      referencja: (w.referencja as string) ?? null,
      waybill: w.waybill as string,
      kupujacyLogin: (w.kupujacy_login as string) ?? null,
      nazwa: w.nazwa as string,
      symbol: (w.external_id as string) ?? null,
      twId: (w.tw_id as number) ?? null,
      ilosc: w.ilosc as number,
      powod: (w.powod as string) ?? null,
      powodOpis: (w.powod_opis as string) ?? null,
      notatka: (w.notatka as string) ?? null,
      zgloszono,
      termin,
      dniDoTerminu,
      poTerminie: dniDoTerminu < 0,
      wynik: (w.rekl_wynik as string) ?? null,
      rozpatrzonoAt: (w.rekl_at as string) ?? null,
      rozpatrzonoPrzez: (w.rekl_przez as string) ?? null,
      reklNotatka: (w.rekl_notatka as string) ?? null,
      polka: (w.rekl_polka as string) ?? null,
      prowadzi: (w.rekl_prowadzi as string) ?? null,
      prowadziAt: (w.rekl_prowadzi_at as string) ?? null,
    };
  });
  // otwarte: najpilniejsze na górze; rozpatrzone: najświeższe na górze
  if (!opts.rozpatrzone) lista.sort((a, b) => a.dniDoTerminu - b.dniDoTerminu);
  return lista;
}

export function rozpatrzReklamacje(
  pozycjaId: number,
  wynik: string,
  notatka: string | null,
  autor: string
): void {
  if (!(WYNIKI_REKLAMACJI as readonly string[]).includes(wynik)) {
    throw new BladZwrotu(400, `Nieznany wynik „${wynik}” — dozwolone: ${WYNIKI_REKLAMACJI.join(", ")}`);
  }
  const p = db()
    .prepare("SELECT id, tw_id, decyzja, rekl_wynik FROM zwrot_pozycja WHERE id = ?")
    .get(pozycjaId) as { id: number; tw_id: number | null; decyzja: string | null; rekl_wynik: string | null } | undefined;
  if (!p) throw new BladZwrotu(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.decyzja !== "reklamacja") throw new BladZwrotu(400, "Ta pozycja nie jest reklamacją");
  /* Rozpatrzenie jest JEDNORAZOWE — klient dostał odpowiedź i zmiana werdyktu
     w aplikacji niczego by już nie cofnęła. Pomyłkę prostuje się z klientem,
     a jej ślad zostaje w audycie. */
  if (p.rekl_wynik) throw new BladZwrotu(400, `Reklamacja jest już rozpatrzona (${p.rekl_wynik})`);

  /* Rozpatrzenie ZWALNIA prowadzącego (jak wysłanie odpowiedzi przy
     pytaniach): sprawa zamknięta nie jest niczyją robotą, a kto rozstrzygnął,
     mówi `rekl_przez`. */
  db()
    .prepare(
      `UPDATE zwrot_pozycja
          SET rekl_wynik=?, rekl_at=?, rekl_przez=?, rekl_notatka=?,
              rekl_prowadzi=NULL, rekl_prowadzi_at=NULL
        WHERE id=?`
    )
    .run(wynik, nowIso(), autor, notatka, pozycjaId);
  logEvent("reklamacja_rozpatrzona", autor, p.tw_id, { pozycjaId, wynik, notatka });
  przebudujSprawy();
}

/**
 * Kto prowadzi reklamację — ZNACZNIK, nie zamek (doktryna `stempelProwadzi`
 * z pytań). Reklamacja, inaczej niż pytanie, nie ma przed werdyktem żadnego
 * zapisu treści, przy którym nazwisko pojawiłoby się samo — dlatego obok
 * stempli przy okazji (półka) istnieje jawny przycisk PROWADZĘ. Rozpatrzenie
 * czyści znacznik.
 */
export function stempelProwadziReklamacji(pozycjaId: number, autor: string): void {
  const p = db()
    .prepare("SELECT id, tw_id, decyzja, rekl_wynik FROM zwrot_pozycja WHERE id = ?")
    .get(pozycjaId) as
    | { id: number; tw_id: number | null; decyzja: string | null; rekl_wynik: string | null }
    | undefined;
  if (!p) throw new BladZwrotu(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.decyzja !== "reklamacja") throw new BladZwrotu(400, "Ta pozycja nie jest reklamacją");
  if (p.rekl_wynik) throw new BladZwrotu(400, `Reklamacja jest już rozpatrzona (${p.rekl_wynik})`);
  db()
    .prepare(
      "UPDATE zwrot_pozycja SET rekl_prowadzi=?, rekl_prowadzi_at=datetime('now') WHERE id=?"
    )
    .run(autor, pozycjaId);
  logEvent("reklamacja_prowadzi", autor, p.tw_id, { pozycjaId });
  przebudujSprawy();
}

/**
 * Półka reklamacyjna (Etap 6) — GDZIE leży towar, dopóki sprawa trwa.
 *
 * Ewidencja w aplikacji, nie ruch w Subiekcie: reklamowany towar nie jest na
 * stanie (korekta go nie objęła), więc MM nie miałoby czego przesuwać. Pusta
 * wartość zdejmuje z półki. Rozpatrzenie NIE czyści pola — historia ma mówić,
 * skąd towar zszedł.
 */
export function ustawPolke(pozycjaId: number, polka: string | null, autor: string): void {
  const p = db()
    .prepare("SELECT id, tw_id, decyzja FROM zwrot_pozycja WHERE id = ?")
    .get(pozycjaId) as { id: number; tw_id: number | null; decyzja: string | null } | undefined;
  if (!p) throw new BladZwrotu(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.decyzja !== "reklamacja") throw new BladZwrotu(400, "Ta pozycja nie jest reklamacją");
  const wartosc = polka?.trim().toUpperCase() || null;
  /* Odkładanie na półkę JEST prowadzeniem sprawy — nazwisko pojawia się przy
     zapisie, który i tak następuje (zasada „bez zapisu przy samym patrzeniu"). */
  db()
    .prepare(
      `UPDATE zwrot_pozycja
          SET rekl_polka=?, rekl_prowadzi=?, rekl_prowadzi_at=datetime('now')
        WHERE id=?`
    )
    .run(wartosc, autor, pozycjaId);
  logEvent("reklamacja_polka", autor, p.tw_id, { pozycjaId, polka: wartosc });
}

// ── Raport procesu zwrotów ──────────────────────────────────────────────────

export interface RaportZwrotow {
  zwroty: { nowe: number; ocenione: number; rozliczone: number; razem30dni: number };
  dokumenty: { wKolejce: number; wystawione: number; bledy: number };
  kosze: { otwarte: number; zamkniete: number; rozlozone30dni: number };
  reklamacje: { otwarte: number; poTerminie: number; rozpatrzone30dni: number };
  /** Zgłoszenia z Allegro czekające na paczkę; `brakujace` = dłużej niż próg (Etap 4). */
  zapowiedzi: { oczekujace: number; brakujace: number; doreczoneNieprzyjete: number };
  /** Mediana godzin od przyjęcia skanem do rozliczenia (30 dni); null = brak danych. */
  medianaGodzinDoRozliczenia: number | null;
  /**
   * Najświeższy zwrot, który raport obejmuje. Pasek ANALIZY pisze z tego
   * „Dane do…" — zegar serwera powiedziałby tylko, że zapytanie właśnie
   * poszło, a to zdanie ma mówić, czy zwroty w ogóle dochodzą.
   */
  daneDo: string | null;
}

/**
 * Liczby, którymi proces się rozlicza — jedna odpowiedź zamiast czterech
 * zapytań SQL zadawanych ręcznie. Mediana zamiast średniej świadomie: jeden
 * zwrot czekający miesiąc na klienta nie ma prawa zamazać typowego tempa.
 */
export function raportZwrotow(): RaportZwrotow {
  const d = db();
  const jeden = (sql: string): number =>
    (d.prepare(sql).get() as { n: number }).n;

  const czasy = d
    .prepare(
      `SELECT (julianday(zwrot_srodkow_at) - julianday(utworzono_at)) * 24.0 AS h
       FROM zwrot
       WHERE zwrot_srodkow_at IS NOT NULL AND utworzono_at >= datetime('now', '-30 days')
       ORDER BY h`
    )
    .all() as Array<{ h: number }>;
  const mediana = czasy.length
    ? Math.round(czasy[Math.floor((czasy.length - 1) / 2)].h * 10) / 10
    : null;

  const otwarteReklamacje = listaReklamacji();
  return {
    zwroty: {
      nowe: jeden("SELECT COUNT(*) AS n FROM zwrot WHERE status='nowy'"),
      ocenione: jeden("SELECT COUNT(*) AS n FROM zwrot WHERE status='oceniony'"),
      rozliczone: jeden("SELECT COUNT(*) AS n FROM zwrot WHERE status='rozliczony'"),
      razem30dni: jeden("SELECT COUNT(*) AS n FROM zwrot WHERE utworzono_at >= datetime('now', '-30 days')"),
    },
    dokumenty: {
      wKolejce: jeden(
        "SELECT COUNT(*) AS n FROM sfera_queue WHERE type='korekta_zwrot' AND status IN ('pending','processing','waiting_for_doc')"
      ),
      wystawione: jeden("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='korekta_zwrot' AND status='done'"),
      bledy: jeden("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='korekta_zwrot' AND status='error'"),
    },
    kosze: {
      otwarte: jeden("SELECT COUNT(*) AS n FROM kosz WHERE status='otwarty'"),
      zamkniete: jeden("SELECT COUNT(*) AS n FROM kosz WHERE status='zamkniety'"),
      rozlozone30dni: jeden(
        "SELECT COUNT(*) AS n FROM kosz WHERE status='rozlozony' AND rozlozono_at >= datetime('now', '-30 days')"
      ),
    },
    reklamacje: {
      otwarte: otwarteReklamacje.length,
      poTerminie: otwarteReklamacje.filter((r) => r.poTerminie).length,
      rozpatrzone30dni: jeden(
        "SELECT COUNT(*) AS n FROM zwrot_pozycja WHERE rekl_at >= datetime('now', '-30 days')"
      ),
    },
    zapowiedzi: liczbyZapowiedzi(),
    medianaGodzinDoRozliczenia: mediana,
    daneDo:
      (d.prepare("SELECT MAX(utworzono_at) AS ost FROM zwrot").get() as { ost: string | null })
        .ost ?? null,
  };
}
