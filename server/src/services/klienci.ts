import { db } from "../db/db.js";

/* ── Kontekst klienta — co ten kupujący już u nas załatwiał ──────────────────
   Ten sam login pojawia się w trzech rejestrach naraz: pyta o część, zwraca
   paczkę i otwiera dyskusję w Allegro — a odpowiedź w każdej z tych spraw
   wygląda inaczej, gdy widać dwie pozostałe. Do tej pory każdy moduł składał
   ten podgląd osobno (`historiaKlienta` przy pytaniach, `statystykiKupujacego`
   przy zwrotach); dyskusje byłyby trzecim takim zapytaniem pisanym od nowa.
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

export interface KontekstKlienta {
  login: string | null;
  pytania: PytanieKlienta[];
  zwroty: ZwrotKlienta[];
  dyskusje: DyskusjaKlienta[];
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
  if (!login) return { login: null, pytania: [], zwroty: [], dyskusje: [] };

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
  };
}
