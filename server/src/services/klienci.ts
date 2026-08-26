import { db } from "../db/db.js";
import { terminReklamacji } from "./reklamacje.js";

/* ── Kontekst klienta — co ten kupujący już u nas załatwiał ──────────────────
   Ten sam login pojawia się w czterech rejestrach naraz: pyta o część, zwraca
   paczkę, otwiera dyskusję w Allegro, a pozycja jego zwrotu bywa reklamacją —
   a odpowiedź w każdej z tych spraw wygląda inaczej, gdy widać pozostałe.
   Do tej pory każdy moduł składał ten podgląd osobno (`historiaKlienta` przy
   pytaniach, `statystykiKupujacego` przy zwrotach); dyskusje byłyby trzecim
   takim zapytaniem pisanym od nowa.
   Tu jest jedno miejsce, z którego wszystkie karty czytają to samo.

   Czytane NA KLIK, nie przy liście: otwarcie sprawy ma być tanie, a te
   zapytania są potrzebne dopiero przy wątpliwości.                           */

export interface PytanieKlienta {
  id: number;
  otrzymanoAt: string | null;
  tresc: string;
  odpowiedz: string | null;
  status: string;
  ofertaTytul: string | null;
}

export interface ZwrotKlienta {
  id: number;
  referencja: string | null;
  status: string;
  utworzonoAt: string | null;
  pozycji: number;
}

export interface DyskusjaKlienta {
  id: number;
  typ: string | null;
  status: string;
  statusAllegro: string | null;
  temat: string | null;
  utworzonoAllegro: string | null;
}

export interface ReklamacjaKlienta {
  /** Id POZYCJI zwrotu — reklamacja nie ma własnej tabeli (zob. reklamacje.ts). */
  pozycjaId: number;
  zwrotId: number;
  nazwa: string;
  wynik: string | null;
  /** Ujemne = po terminie; liczy się tylko dla otwartej (wynik NULL). */
  dniDoTerminu: number;
  poTerminie: boolean;
  zgloszono: string | null;
}

export interface KontekstKlienta {
  login: string | null;
  pytania: PytanieKlienta[];
  zwroty: ZwrotKlienta[];
  dyskusje: DyskusjaKlienta[];
  reklamacje: ReklamacjaKlienta[];
}

/** Ile wstecz pokazujemy — tyle, ile mieści się w karcie bez przewijania. */
const HISTORII_KLIENTA = 10;

/**
 * Sprawa bez loginu (wklejka ze screenshota) dostaje poprawny wynik PUSTY,
 * nie błąd. `pomijaj` wycina sprawę, z której patrzymy — własny wiersz
 * w historii to szum, nie kontekst.
 */
export function kontekstKlienta(
  login: string | null,
  pomijaj: { pytanieId?: number; dyskusjaId?: number } = {}
): KontekstKlienta {
  if (!login) return { login: null, pytania: [], zwroty: [], dyskusje: [], reklamacje: [] };

  const pytania = db()
    .prepare(
      `SELECT id, otrzymano_at, tresc, odpowiedz, status, oferta_tytul
       FROM pytanie
       WHERE kupujacy_login = ? AND id <> ?
       ORDER BY otrzymano_at DESC, id DESC LIMIT ?`
    )
    .all(login, pomijaj.pytanieId ?? -1, HISTORII_KLIENTA) as Array<Record<string, unknown>>;

  /* Zwroty tego samego loginu — z licznikiem pozycji, bo „zwrot" bez liczby
     rzeczy nie mówi, czy wróciła jedna uszczelka, czy cała paczka. */
  const zwroty = db()
    .prepare(
      `SELECT z.id, z.referencja, z.status, z.utworzono_at,
              (SELECT COUNT(*) FROM zwrot_pozycja p WHERE p.zwrot_id = z.id) AS pozycji
       FROM zwrot z
       WHERE z.kupujacy_login = ?
       ORDER BY z.utworzono_at DESC LIMIT ?`
    )
    .all(login, HISTORII_KLIENTA) as Array<Record<string, unknown>>;

  const dyskusje = db()
    .prepare(
      `SELECT id, typ, status, status_allegro, temat, utworzono_allegro
       FROM dyskusja
       WHERE kupujacy_login = ? AND id <> ?
       ORDER BY utworzono_allegro DESC, id DESC LIMIT ?`
    )
    .all(login, pomijaj.dyskusjaId ?? -1, HISTORII_KLIENTA) as Array<Record<string, unknown>>;

  /* Reklamacje — czwarty rejestr tego samego loginu, dotąd jedyny niewidoczny
     przy odpowiadaniu klientowi. Nie ma własnej tabeli: to pozycja zwrotu
     z decyzją `reklamacja`. Termin liczymy tą samą arytmetyką co lista
     reklamacji (terminReklamacji) — drugi zegar zawsze zaczyna się spóźniać. */
  const reklamacje = db()
    .prepare(
      `SELECT p.id AS pozycja_id, p.zwrot_id, p.nazwa, p.rekl_wynik,
              z.utworzono_allegro, z.utworzono_at
       FROM zwrot_pozycja p JOIN zwrot z ON z.id = p.zwrot_id
       WHERE z.kupujacy_login = ? AND p.decyzja = 'reklamacja'
       ORDER BY p.id DESC LIMIT ?`
    )
    .all(login, HISTORII_KLIENTA) as Array<Record<string, unknown>>;
  const teraz = Date.now();

  return {
    login,
    pytania: pytania.map((r) => ({
      id: Number(r.id),
      otrzymanoAt: (r.otrzymano_at as string) ?? null,
      tresc: (r.tresc as string) ?? "",
      odpowiedz: (r.odpowiedz as string) ?? null,
      status: (r.status as string) ?? "nowe",
      ofertaTytul: (r.oferta_tytul as string) ?? null,
    })),
    zwroty: zwroty.map((r) => ({
      id: Number(r.id),
      referencja: (r.referencja as string) ?? null,
      status: (r.status as string) ?? "",
      utworzonoAt: (r.utworzono_at as string) ?? null,
      pozycji: Number(r.pozycji ?? 0),
    })),
    dyskusje: dyskusje.map((r) => ({
      id: Number(r.id),
      typ: (r.typ as string) ?? null,
      status: (r.status as string) ?? "nowa",
      statusAllegro: (r.status_allegro as string) ?? null,
      temat: (r.temat as string) ?? null,
      utworzonoAllegro: (r.utworzono_allegro as string) ?? null,
    })),
    reklamacje: reklamacje.map((r) => {
      const zgloszono = (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null;
      const { dniDoTerminu } = terminReklamacji(zgloszono ?? "", teraz);
      const wynik = (r.rekl_wynik as string) ?? null;
      return {
        pozycjaId: Number(r.pozycja_id),
        zwrotId: Number(r.zwrot_id),
        nazwa: (r.nazwa as string) ?? "",
        wynik,
        dniDoTerminu,
        /* Rozpatrzona reklamacja nie bywa „po terminie" — zegar ją minął. */
        poTerminie: wynik === null && dniDoTerminu < 0,
        zgloszono,
      };
    }),
  };
}
