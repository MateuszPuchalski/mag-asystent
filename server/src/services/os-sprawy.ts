import { db, nowIso } from "../db/db.js";

/* ── Oś czasu sprawy — co się w niej działo (0.130.0) ────────────────────────
   Etap D2 z docs/architektura-spraw.md. Rejestry pamiętają OSTATNI stan:
   `wyslano_at` mówi o ostatniej odpowiedzi, `status` o dzisiejszym statusie.
   Historii nie pamiętał nikt, więc pytanie „co się w tej sprawie działo"
   nie miało odpowiedzi — a przy sprawie z trzech rejestrów jest to pierwsze
   pytanie agenta.

   Zdarzenie wisi przy ŹRÓDLE, nie przy sprawie: SCAL i ROZKLEJ przenoszą
   źródła między sprawami, więc oś czasu sprawy jest PROJEKCJĄ — sumą zdarzeń
   jej dzisiejszych źródeł. Scalenie nie przepisuje historii, rozklejenie nie
   zgaduje, komu ją oddać.

   ZERO TREŚCI ROZMÓW (zasada prywatności z CLAUDE.md): zapisujemy, ŻE klient
   napisał, nie CO napisał. Dlatego `szczegol` przyjmuje status, decyzję albo
   liczbę, a funkcje piszące nie biorą treści wiadomości — pilnuje tego test.

   Zapis NIE woła logEvent — ten sam świadomy wyjątek co przy `watek_meta`:
   zdarzenie osi powstaje OBOK mutacji, która już się zalogowała; drugi wpis
   podwajałby dziennik bez nowej informacji.

   SQL inline zamiast importu z sprawa.ts: tamten moduł pisze tutaj (SCAL,
   ROZKLEJ), więc odwrotny kierunek byłby cyklem.                            */

export type RodzajZrodlaOsi = "pytanie" | "zwrot" | "dyskusja" | "reklamacja";

/** Czyj to był ruch. Po tym panel koloruje wpis — login autora nie wystarcza,
    bo przy zdarzeniach z Allegro nie ma żadnego naszego konta. */
export type KtoZdarzenia = "klient" | "my" | "allegro";

/**
 * Słownik zdarzeń. ZAMKNIĘTY z premedytacją: dowolny tekst w `typ` zamieniłby
 * oś czasu w drugi dziennik `events` — a ona ma być czytelna dla człowieka
 * w pół sekundy. Opis stoi po stronie serwera, żeby trzy szczegóły panelu
 * nie rozjechały się w nazewnictwie.
 */
export const TYPY_ZDARZEN = {
  zalozona: "sprawa wpłynęła",
  klient_napisal: "klient napisał",
  /* Mediator Allegro to TRZECI głos w sprawie, nie klient — pod jednym
     opisem czytałoby się jak wiadomość od kupującego, a to zupełnie inna
     rozmowa (ten sam podział co w watek-meta.ts). */
  allegro_napisalo: "Allegro napisało",
  odpowiedzielismy: "odpowiedzieliśmy",
  szkic: "szkic modelu",
  przejeto: "wzięto sprawę",
  status: "zmiana statusu",
  notatka: "notatka biura",
  decyzja: "decyzja o pozycji",
  dokumenty: "dokumenty w Subiekcie",
  srodki: "zwrot środków",
  werdykt: "werdykt reklamacji",
  zamknieta: "sprawa zamknięta",
  scalona: "sprawy scalone ręką człowieka",
  rozklejona: "sprawa rozklejona ręką człowieka",
} as const;

export type TypZdarzenia = keyof typeof TYPY_ZDARZEN;

export interface NoweZdarzenie {
  rodzaj: RodzajZrodlaOsi;
  lokalnyId: number;
  typ: TypZdarzenia;
  kto: KtoZdarzenia;
  /** Konto pracownika; NULL, gdy ruch nie jest nasz. */
  autor?: string | null;
  /** Status, decyzja, liczba. NIGDY zdanie z rozmowy. */
  szczegol?: string | null;
  /** Kiedy fakt ZASZEDŁ; domyślnie teraz. Dosypka podaje datę z rejestru. */
  kiedy?: string | null;
  /**
   * Co odróżnia to zdarzenie od innych tego samego typu przy tym źródle.
   * Bez wariantu drugie takie zdarzenie jest CICHO pomijane — i tak ma być
   * przy faktach jednorazowych („sprawa wpłynęła"). Zdarzenie powtarzalne
   * (druga odpowiedź, kolejny status) MUSI podać wariant, inaczej zniknie.
   */
  wariant?: string | null;
}

export interface WpisOsi {
  rodzaj: RodzajZrodlaOsi;
  lokalnyId: number;
  typ: TypZdarzenia;
  /** Gotowe zdanie ze słownika — panel nie tłumaczy typów samodzielnie. */
  opis: string;
  kto: KtoZdarzenia;
  autor: string | null;
  szczegol: string | null;
  kiedy: string;
}

const kluczZdarzenia = (z: NoweZdarzenie): string =>
  [z.rodzaj, z.lokalnyId, z.typ, z.wariant ?? ""].join(":");

/**
 * Dopisuje zdarzenie. Idempotentnie: ten sam fakt zapisany drugi raz
 * (powtórzony sync, dosypka przy starcie po tym, jak wpis już powstał na
 * żywo) daje jeden wiersz. To jest warunek pollingu bez duplikatów.
 */
export function dopiszZdarzenie(z: NoweZdarzenie): void {
  const kiedy = z.kiedy ?? nowIso();
  db()
    .prepare(
      `INSERT INTO sprawa_zdarzenie
         (rodzaj, lokalny_id, typ, kto, autor, szczegol, kiedy_at, zapisano_at, klucz)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(klucz) DO NOTHING`
    )
    .run(
      z.rodzaj,
      z.lokalnyId,
      z.typ,
      z.kto,
      z.autor ?? null,
      z.szczegol ?? null,
      kiedy,
      nowIso(),
      kluczZdarzenia(z)
    );
}

/** Zdarzenia kompletu źródeł, najstarsze pierwsze. Pusta lista = pusta oś. */
export function osCzasuZrodel(
  zrodla: Array<{ rodzaj: RodzajZrodlaOsi; lokalnyId: number }>
): WpisOsi[] {
  if (zrodla.length === 0) return [];
  /* Para (rodzaj, id) w jednym IN-ie: `rodzaj || ':' || lokalny_id` po obu
     stronach. Filtrowanie w SQL, nie w pamięci — sprawa z czterema źródłami
     ciągnęłaby inaczej całą tabelę zdarzeń. */
  const klucze = zrodla.map((z) => `${z.rodzaj}:${z.lokalnyId}`);
  const pytajniki = klucze.map(() => "?").join(",");
  const wiersze = db()
    .prepare(
      `SELECT rodzaj, lokalny_id, typ, kto, autor, szczegol, kiedy_at
         FROM sprawa_zdarzenie
        WHERE rodzaj || ':' || lokalny_id IN (${pytajniki})
        ORDER BY kiedy_at, id`
    )
    .all(...klucze) as Array<Record<string, unknown>>;
  return wiersze.map((w) => {
    const typ = w.typ as TypZdarzenia;
    return {
      rodzaj: w.rodzaj as RodzajZrodlaOsi,
      lokalnyId: w.lokalny_id as number,
      typ,
      /* Nieznany typ nie ma prawa wywrócić ekranu: gdy słownik urośnie
         w nowszej wersji, a baza niesie starszy wpis, zostaje surowa nazwa. */
      opis: TYPY_ZDARZEN[typ] ?? typ,
      kto: w.kto as KtoZdarzenia,
      autor: (w.autor as string | null) ?? null,
      szczegol: (w.szczegol as string | null) ?? null,
      kiedy: w.kiedy_at as string,
    };
  });
}

export interface OsCzasuSprawy {
  /** Encja sprawy; null = pseudo-sprawa (rekoncyliacja jeszcze jej nie widziała). */
  sprawaId: number | null;
  zrodla: Array<{ rodzaj: RodzajZrodlaOsi; lokalnyId: number }>;
  wpisy: WpisOsi[];
}

/**
 * Oś czasu CAŁEJ sprawy, o którą pyta panel — wejściem jest źródło, bo tyle
 * wie każdy z trzech szczegółów. Źródło bez wiązania (pseudo-sprawa) dostaje
 * własną oś: brak rekoncyliacji nie ma prawa ukryć historii.
 */
export function osCzasuSprawy(rodzaj: RodzajZrodlaOsi, lokalnyId: number): OsCzasuSprawy {
  const d = db();
  const wiazanie = d
    .prepare("SELECT sprawa_id FROM sprawa_zrodlo WHERE rodzaj = ? AND lokalny_id = ?")
    .get(rodzaj, lokalnyId) as { sprawa_id: number } | undefined;
  if (!wiazanie) {
    const same = [{ rodzaj, lokalnyId }];
    return { sprawaId: null, zrodla: same, wpisy: osCzasuZrodel(same) };
  }
  const zrodla = (
    d
      .prepare("SELECT rodzaj, lokalny_id FROM sprawa_zrodlo WHERE sprawa_id = ?")
      .all(wiazanie.sprawa_id) as Array<Record<string, unknown>>
  ).map((w) => ({
    rodzaj: w.rodzaj as RodzajZrodlaOsi,
    lokalnyId: w.lokalny_id as number,
  }));
  return { sprawaId: wiazanie.sprawa_id, zrodla, wpisy: osCzasuZrodel(zrodla) };
}

/* ── Dosypka zastanego stanu ─────────────────────────────────────────────────
   Oś czasu wchodzi do systemu, który pracuje od miesięcy. Bez dosypki każda
   sprawa sprzed aktualizacji miałaby pustą historię — a to wygląda jak
   awaria, nie jak brak danych. Rejestry pamiętają tyle, ile pamiętają:
   pojedyncze stemple czasu (wpłynęło, ostatnia odpowiedź, przejęcie,
   zamknięcie). Tyle właśnie przepisujemy — nie zgadując niczego ponadto.

   Idempotentna z konstrukcji (klucze jak przy zapisie na żywo), więc może
   chodzić przy każdym starcie: drugi przebieg nie dopisuje nic.            */
export function dosypOsCzasu(): number {
  const d = db();
  const przed = (d.prepare("SELECT COUNT(*) AS ile FROM sprawa_zdarzenie").get() as {
    ile: number;
  }).ile;

  for (const w of d
    .prepare(
      `SELECT id, otrzymano_at, utworzono_at, nowa_wiadomosc_at, wyslano_at, odpowiedzial,
              prowadzi, prowadzi_at, status, szkic_at, utworzono_przez
         FROM pytanie`
    )
    .all() as Array<Record<string, unknown>>) {
    const id = w.id as number;
    dopiszZdarzenie({
      rodzaj: "pytanie",
      lokalnyId: id,
      typ: "zalozona",
      kto: "klient",
      kiedy: (w.otrzymano_at as string | null) ?? (w.utworzono_at as string),
    });
    if (w.nowa_wiadomosc_at) {
      dopiszZdarzenie({
        rodzaj: "pytanie",
        lokalnyId: id,
        typ: "klient_napisal",
        kto: "klient",
        kiedy: w.nowa_wiadomosc_at as string,
        wariant: w.nowa_wiadomosc_at as string,
      });
    }
    if (w.szkic_at) {
      dopiszZdarzenie({
        rodzaj: "pytanie",
        lokalnyId: id,
        typ: "szkic",
        kto: "my",
        kiedy: w.szkic_at as string,
        wariant: w.szkic_at as string,
      });
    }
    if (w.prowadzi_at) {
      dopiszZdarzenie({
        rodzaj: "pytanie",
        lokalnyId: id,
        typ: "przejeto",
        kto: "my",
        autor: (w.prowadzi as string | null) ?? null,
        kiedy: w.prowadzi_at as string,
        wariant: w.prowadzi_at as string,
      });
    }
    if (w.wyslano_at) {
      dopiszZdarzenie({
        rodzaj: "pytanie",
        lokalnyId: id,
        typ: "odpowiedzielismy",
        kto: "my",
        autor: (w.odpowiedzial as string | null) ?? null,
        kiedy: w.wyslano_at as string,
        wariant: w.wyslano_at as string,
      });
    }
  }

  for (const w of d
    .prepare(
      `SELECT id, utworzono_allegro, utworzono_at, status, status_allegro, prowadzi, prowadzi_at,
              wyslano_at, odpowiedzial, szkic_at, zamknieto_at, zamknieto_przez
         FROM dyskusja`
    )
    .all() as Array<Record<string, unknown>>) {
    const id = w.id as number;
    dopiszZdarzenie({
      rodzaj: "dyskusja",
      lokalnyId: id,
      typ: "zalozona",
      kto: "klient",
      kiedy: (w.utworzono_allegro as string | null) ?? (w.utworzono_at as string),
    });
    if (w.szkic_at) {
      dopiszZdarzenie({
        rodzaj: "dyskusja",
        lokalnyId: id,
        typ: "szkic",
        kto: "my",
        kiedy: w.szkic_at as string,
        wariant: w.szkic_at as string,
      });
    }
    if (w.prowadzi_at) {
      dopiszZdarzenie({
        rodzaj: "dyskusja",
        lokalnyId: id,
        typ: "przejeto",
        kto: "my",
        autor: (w.prowadzi as string | null) ?? null,
        kiedy: w.prowadzi_at as string,
        wariant: w.prowadzi_at as string,
      });
    }
    if (w.wyslano_at) {
      dopiszZdarzenie({
        rodzaj: "dyskusja",
        lokalnyId: id,
        typ: "odpowiedzielismy",
        kto: "my",
        autor: (w.odpowiedzial as string | null) ?? null,
        kiedy: w.wyslano_at as string,
        wariant: w.wyslano_at as string,
      });
    }
    if (w.zamknieto_at) {
      /* Zamknięcie z Allegro (auto po statusie) nie jest naszym ruchem —
         a to właśnie rozróżnienie oś czasu ma pokazywać. */
      const przez = (w.zamknieto_przez as string | null) ?? null;
      dopiszZdarzenie({
        rodzaj: "dyskusja",
        lokalnyId: id,
        typ: "zamknieta",
        kto: przez === "allegro" ? "allegro" : "my",
        autor: przez === "allegro" ? null : przez,
        szczegol: (w.status_allegro as string | null) ?? null,
        kiedy: w.zamknieto_at as string,
        wariant: w.zamknieto_at as string,
      });
    }
  }

  for (const w of d
    .prepare(
      `SELECT id, utworzono_allegro, utworzono_at, prowadzi, prowadzi_at, status,
              zwrot_srodkow_at, zwrot_srodkow_przez
         FROM zwrot`
    )
    .all() as Array<Record<string, unknown>>) {
    const id = w.id as number;
    dopiszZdarzenie({
      rodzaj: "zwrot",
      lokalnyId: id,
      typ: "zalozona",
      kto: "klient",
      kiedy: (w.utworzono_allegro as string | null) ?? (w.utworzono_at as string),
    });
    if (w.prowadzi_at) {
      dopiszZdarzenie({
        rodzaj: "zwrot",
        lokalnyId: id,
        typ: "przejeto",
        kto: "my",
        autor: (w.prowadzi as string | null) ?? null,
        kiedy: w.prowadzi_at as string,
        wariant: w.prowadzi_at as string,
      });
    }
    if (w.zwrot_srodkow_at) {
      dopiszZdarzenie({
        rodzaj: "zwrot",
        lokalnyId: id,
        typ: "srodki",
        kto: "my",
        autor: (w.zwrot_srodkow_przez as string | null) ?? null,
        kiedy: w.zwrot_srodkow_at as string,
        wariant: w.zwrot_srodkow_at as string,
      });
    }
  }

  for (const w of d
    .prepare(
      /* Reklamacją jest POZYCJA zwrotu z taką decyzją — ten sam predykat co
         w listaReklamacji(); inny wybrałby inne sprawy niż kolejka. */
      `SELECT id, rekl_prowadzi, rekl_prowadzi_at, rekl_wynik, rekl_at, rekl_przez
         FROM zwrot_pozycja
        WHERE decyzja = 'reklamacja'`
    )
    .all() as Array<Record<string, unknown>>) {
    const id = w.id as number;
    if (w.rekl_prowadzi_at) {
      dopiszZdarzenie({
        rodzaj: "reklamacja",
        lokalnyId: id,
        typ: "przejeto",
        kto: "my",
        autor: (w.rekl_prowadzi as string | null) ?? null,
        kiedy: w.rekl_prowadzi_at as string,
        wariant: w.rekl_prowadzi_at as string,
      });
    }
    if (w.rekl_at) {
      dopiszZdarzenie({
        rodzaj: "reklamacja",
        lokalnyId: id,
        typ: "werdykt",
        kto: "my",
        autor: (w.rekl_przez as string | null) ?? null,
        szczegol: (w.rekl_wynik as string | null) ?? null,
        kiedy: w.rekl_at as string,
        wariant: w.rekl_at as string,
      });
    }
  }

  const po = (d.prepare("SELECT COUNT(*) AS ile FROM sprawa_zdarzenie").get() as { ile: number })
    .ile;
  return po - przed;
}
