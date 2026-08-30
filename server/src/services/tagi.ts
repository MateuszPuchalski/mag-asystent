import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import { listaSpraw, otwarteZrodlaSpraw, type RodzajSprawy, type Sprawa } from "./sprawy.js";

/* ── Tagi spraw i reguły ich nadawania (0.136.0) ─────────────────────────────
   Etap E5 z docs/architektura-spraw.md. Zasada 6 wyznacza granicę: tagowanie
   i przydział mogą być regułami, ale do klienta mówi wyłącznie człowiek. Tag
   i przydział niczego nie wysyłają, więc mieszczą się w niej z zapasem.

   Tag wisi przy ŹRÓDLE (jak zdarzenie osi czasu): SCAL i ROZKLEJ przenoszą
   źródła między sprawami, a rekoncyliacja kasuje sprawę bez źródeł. Tag na
   sprawie zniknąłby wtedy po cichu.

   Reguły dopasowują się do WIERSZA KOLEJKI, nie do surowych tabel — dzięki
   temu jedna implementacja obsługuje pięć rejestrów i widzi dokładnie to, co
   człowiek na ekranie. Cena: pełny odczyt kolejki na przebieg, ale reguły
   chodzą po synchronizacji, nie w pętli.                                     */

export class BladTagu extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladTagu";
  }
}

export interface Tag {
  rodzaj: RodzajSprawy;
  lokalnyId: number;
  tag: string;
  autor: string;
  dodanoAt: string;
}

/** Tagi kompletu źródeł — sprawa pokazuje sumę tagów swoich dzisiejszych źródeł. */
export function tagiZrodel(
  zrodla: Array<{ rodzaj: RodzajSprawy; lokalnyId: number }>
): Tag[] {
  if (zrodla.length === 0) return [];
  const klucze = zrodla.map((z) => `${z.rodzaj}:${z.lokalnyId}`);
  const wiersze = db()
    .prepare(
      `SELECT rodzaj, lokalny_id, tag, autor, dodano_at FROM sprawa_tag
        WHERE rodzaj || ':' || lokalny_id IN (${klucze.map(() => "?").join(",")})
        ORDER BY tag`
    )
    .all(...klucze) as Array<Record<string, unknown>>;
  return wiersze.map((w) => ({
    rodzaj: w.rodzaj as RodzajSprawy,
    lokalnyId: w.lokalny_id as number,
    tag: w.tag as string,
    autor: w.autor as string,
    dodanoAt: w.dodano_at as string,
  }));
}

/** Tagi CAŁEJ sprawy, do której należy źródło — wejście jak przy osi czasu. */
export function tagiSprawy(rodzaj: RodzajSprawy, lokalnyId: number): Tag[] {
  const d = db();
  const wiazanie = d
    .prepare("SELECT sprawa_id FROM sprawa_zrodlo WHERE rodzaj = ? AND lokalny_id = ?")
    .get(rodzaj, lokalnyId) as { sprawa_id: number } | undefined;
  if (!wiazanie) return tagiZrodel([{ rodzaj, lokalnyId }]);
  const zrodla = (
    d
      .prepare("SELECT rodzaj, lokalny_id FROM sprawa_zrodlo WHERE sprawa_id = ?")
      .all(wiazanie.sprawa_id) as Array<Record<string, unknown>>
  ).map((w) => ({ rodzaj: w.rodzaj as RodzajSprawy, lokalnyId: w.lokalny_id as number }));
  return tagiZrodel(zrodla);
}

/** Wszystkie tagi używane w bazie — podpowiedź przy dopisywaniu. */
export function slownikTagow(): Array<{ tag: string; ile: number }> {
  return db()
    .prepare("SELECT tag, COUNT(*) AS ile FROM sprawa_tag GROUP BY tag ORDER BY ile DESC, tag")
    .all() as Array<{ tag: string; ile: number }>;
}

/* ── Tagi w kolejce (0.137.0) ────────────────────────────────────────────────
   Tag nadany w sprawie był do 0.136.0 widoczny dopiero PO wejściu w sprawę,
   więc reguła tagowała w próżnię: kolejka wyglądała tak samo przed regułą
   i po niej. Te dwie funkcje domykają E5 — etykieta ma sterować kolejnością
   patrzenia, inaczej jest ozdobą.

   Kierunek zależności wymusza reguła importów: `sprawy.ts` NIE MOŻE wiedzieć
   o tagach (ten moduł już wie o kolejce, więc odwrotny import zawiązałby
   cykl). Dlatego dekoracja mieszka tutaj, a nie przy kolejce.                */

/** Mapa `rodzaj:id` → posortowane tagi źródła. Jeden SELECT po CAŁEJ tabeli:
    tagów jest tyle, ile ktoś nadał, a kolejka bierze ich setki naraz —
    zapytanie z klauzulą IN po każdym źródle byłoby dłuższe od tabeli. */
function mapaTagow(): Map<string, string[]> {
  const wiersze = db()
    .prepare("SELECT rodzaj, lokalny_id, tag FROM sprawa_tag ORDER BY tag")
    .all() as Array<Record<string, unknown>>;
  const mapa = new Map<string, string[]>();
  for (const w of wiersze) {
    const klucz = `${w.rodzaj as string}:${w.lokalny_id as number}`;
    const dotad = mapa.get(klucz);
    if (dotad) dotad.push(w.tag as string);
    else mapa.set(klucz, [w.tag as string]);
  }
  return mapa;
}

/**
 * Kolejka spraw z tagami w wierszu. Sprawa pokazuje SUMĘ tagów swoich
 * dzisiejszych źródeł — ta sama reguła, co w szczegółach sprawy, żeby wiersz
 * i ekran nie mówiły dwóch różnych rzeczy o tej samej sprawie.
 *
 * Filtrowania po tagu tu NIE MA celowo: panel ma całą kolejkę w pamięci
 * i tnie ją czipami na miejscu (tak samo jak po rodzaju i po MOJE), więc
 * parametr w trasie byłby drugą drogą do tego samego wyniku.
 */
export function sprawyZTagami(rodzaj?: RodzajSprawy): Sprawa[] {
  const mapa = mapaTagow();
  if (mapa.size === 0) return listaSpraw(rodzaj).map((s) => ({ ...s, tagi: [] }));
  return listaSpraw(rodzaj).map((s) => {
    const zrodla = s.zrodla ?? [{ rodzaj: s.rodzaj, id: s.id, otwarte: s.otwarta }];
    const tagi = new Set<string>();
    for (const z of zrodla) for (const t of mapa.get(`${z.rodzaj}:${z.id}`) ?? []) tagi.add(t);
    return { ...s, tagi: [...tagi].sort() };
  });
}

/** Tag jest ETYKIETĄ, nie zdaniem: krótki, bez klamr i bez przecinków. */
function czysty(tag: string): string {
  const t = tag.trim().replace(/\s+/g, " ").toLowerCase();
  if (t === "") throw new BladTagu("Pusty tag nie oznacza niczego");
  if (t.length > 32) throw new BladTagu("Tag ma być etykietą, nie zdaniem — najwyżej 32 znaki");
  if (t.includes(",")) throw new BladTagu("Przecinek dzieli tagi — wpisz je po kolei");
  return t;
}

export function dodajTag(
  rodzaj: RodzajSprawy,
  lokalnyId: number,
  tag: string,
  autor: string
): Tag[] {
  const t = czysty(tag);
  db()
    .prepare(
      `INSERT INTO sprawa_tag (rodzaj, lokalny_id, tag, autor, dodano_at)
       VALUES (?,?,?,?,?) ON CONFLICT(rodzaj, lokalny_id, tag) DO NOTHING`
    )
    .run(rodzaj, lokalnyId, t, autor, nowIso());
  logEvent("sprawa_tag_dodany", autor, null, { rodzaj, lokalnyId, tag: t });
  return tagiSprawy(rodzaj, lokalnyId);
}

export function usunTag(
  rodzaj: RodzajSprawy,
  lokalnyId: number,
  tag: string,
  autor: string
): Tag[] {
  const t = czysty(tag);
  /* Kasujemy z KOMPLETU źródeł sprawy: tag pokazuje się jako tag sprawy, więc
     zdjęcie go z jednego źródła zostawiałoby go na ekranie i wyglądało na
     usterkę. */
  for (const z of tagiSprawy(rodzaj, lokalnyId).filter((x) => x.tag === t)) {
    db()
      .prepare("DELETE FROM sprawa_tag WHERE rodzaj = ? AND lokalny_id = ? AND tag = ?")
      .run(z.rodzaj, z.lokalnyId, t);
  }
  logEvent("sprawa_tag_zdjety", autor, null, { rodzaj, lokalnyId, tag: t });
  return tagiSprawy(rodzaj, lokalnyId);
}

/* ── Reguły ──────────────────────────────────────────────────────────────── */

export interface Regula {
  id: number;
  nazwa: string;
  rodzaj: RodzajSprawy | null;
  wzorzec: string;
  tag: string | null;
  przydziel: string | null;
  aktywna: boolean;
  autor: string;
}

const regulaZWiersza = (w: Record<string, unknown>): Regula => ({
  id: w.id as number,
  nazwa: w.nazwa as string,
  rodzaj: (w.rodzaj as RodzajSprawy | null) ?? null,
  wzorzec: w.wzorzec as string,
  tag: (w.tag as string | null) ?? null,
  przydziel: (w.przydziel as string | null) ?? null,
  aktywna: (w.aktywna as number) === 1,
  autor: w.autor as string,
});

export function listaRegul(): Regula[] {
  return (db().prepare("SELECT * FROM regula ORDER BY id").all() as Array<Record<string, unknown>>)
    .map(regulaZWiersza);
}

function sprawdzRegule(nazwa: string, wzorzec: string, tag: string | null, przydziel: string | null): void {
  if (nazwa.trim() === "") throw new BladTagu("Reguła bez nazwy nie da się znaleźć na liście");
  if (wzorzec.trim().length < 3) {
    throw new BladTagu("Wzorzec krótszy niż trzy znaki złapałby prawie każdą sprawę");
  }
  if (!tag && !przydziel) throw new BladTagu("Reguła bez tagu i bez przydziału nic nie robi");
}

export function dodajRegule(
  dane: { nazwa: string; rodzaj?: string | null; wzorzec: string; tag?: string | null; przydziel?: string | null },
  autor: string
): Regula {
  const tag = dane.tag?.trim() ? czysty(dane.tag) : null;
  const przydziel = dane.przydziel?.trim() || null;
  sprawdzRegule(dane.nazwa, dane.wzorzec, tag, przydziel);
  const wynik = db()
    .prepare(
      `INSERT INTO regula (nazwa, rodzaj, wzorzec, tag, przydziel, autor, utworzono_at)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(dane.nazwa.trim(), dane.rodzaj || null, dane.wzorzec.trim(), tag, przydziel, autor, nowIso());
  const id = Number(wynik.lastInsertRowid);
  logEvent("regula_dodana", autor, null, { id, nazwa: dane.nazwa.trim(), tag, przydziel });
  return listaRegul().find((r) => r.id === id)!;
}

export function zapiszRegule(
  id: number,
  dane: { nazwa: string; rodzaj?: string | null; wzorzec: string; tag?: string | null; przydziel?: string | null; aktywna?: boolean },
  autor: string
): Regula {
  const tag = dane.tag?.trim() ? czysty(dane.tag) : null;
  const przydziel = dane.przydziel?.trim() || null;
  sprawdzRegule(dane.nazwa, dane.wzorzec, tag, przydziel);
  const zmiana = db()
    .prepare(
      `UPDATE regula SET nazwa = ?, rodzaj = ?, wzorzec = ?, tag = ?, przydziel = ?, aktywna = ?
        WHERE id = ?`
    )
    .run(
      dane.nazwa.trim(),
      dane.rodzaj || null,
      dane.wzorzec.trim(),
      tag,
      przydziel,
      dane.aktywna === false ? 0 : 1,
      id
    );
  if (zmiana.changes === 0) throw new BladTagu("Nie ma takiej reguły", 404);
  logEvent("regula_zapisana", autor, null, { id, nazwa: dane.nazwa.trim() });
  return listaRegul().find((r) => r.id === id)!;
}

export function skasujRegule(id: number, autor: string): void {
  const zmiana = db().prepare("DELETE FROM regula WHERE id = ?").run(id);
  if (zmiana.changes === 0) throw new BladTagu("Nie ma takiej reguły", 404);
  logEvent("regula_skasowana", autor, null, { id });
}

export interface WynikRegul {
  sprawdzonych: number;
  tagow: number;
  przydzialow: number;
}

/**
 * Przebiega reguły po OTWARTYCH sprawach. Idempotentny: tag już nadany nie
 * dokłada się drugi raz (UNIQUE), a przydział NIE ODBIERA sprawy komuś, kto
 * już ją prowadzi — reguła podpowiada pierwszemu właścicielowi, nie rządzi
 * cudzą robotą.
 *
 * Dopasowanie idzie po TYTULE wiersza kolejki i loginie klienta, bez
 * rozróżniania wielkości liter. To jest dokładnie to, co widzi człowiek —
 * i dlatego reguła daje się sprawdzić okiem, zanim ktoś ją zapisze.
 */
export function zastosujReguly(autor: string): WynikRegul {
  const reguly = listaRegul().filter((r) => r.aktywna);
  const sprawy = listaSpraw();
  if (reguly.length === 0) return { sprawdzonych: sprawy.length, tagow: 0, przydzialow: 0 };
  /* Tekst POJEDYNCZEGO źródła, nie wiersza sprawy: sprawa pokazuje tytuł
     źródła wiodącego, więc fraza z tematu dyskusji nie znalazłaby się
     w sprawie, której czoło stanowi zwrot. */
  const tekstZrodla = new Map(
    otwarteZrodlaSpraw().map((z) => [
      `${z.rodzaj}:${z.id}`,
      `${z.tytul ?? ""} ${z.klient ?? ""}`.toLowerCase(),
    ])
  );

  const d = db();
  const wstawTag = d.prepare(
    `INSERT INTO sprawa_tag (rodzaj, lokalny_id, tag, autor, dodano_at)
     VALUES (?,?,?,?,?) ON CONFLICT(rodzaj, lokalny_id, tag) DO NOTHING`
  );
  const teraz = nowIso();
  let tagow = 0;
  let przydzialow = 0;

  for (const s of sprawy) {
    const zrodla = s.zrodla ?? [{ rodzaj: s.rodzaj, id: s.id, otwarte: s.otwarta }];
    for (const r of reguly) {
      const wzorzec = r.wzorzec.toLowerCase();
      const pasujace = zrodla
        .filter((z) => !r.rodzaj || z.rodzaj === r.rodzaj)
        .filter((z) => (tekstZrodla.get(`${z.rodzaj}:${z.id}`) ?? "").includes(wzorzec));
      if (pasujace.length === 0) continue;
      if (r.tag) {
        for (const z of pasujace) {
          const zmiana = wstawTag.run(z.rodzaj, z.id, r.tag, `regula:${r.id}`, teraz);
          if (zmiana.changes > 0) tagow++;
        }
      }
      /* Przydział stempluje ENCJĘ sprawy — stemple per-rejestr zostawiamy
         przejęciu ręką człowieka, żeby reguła nie zajmowała cudzej roboty
         w czterech tabelach naraz. */
      if (r.przydziel && !s.prowadzi && s.sprawaId) {
        const zmiana = d
          .prepare(
            "UPDATE sprawa SET prowadzi = ?, prowadzi_at = ? WHERE id = ? AND prowadzi IS NULL"
          )
          .run(r.przydziel, teraz, s.sprawaId);
        if (zmiana.changes > 0) przydzialow++;
      }
    }
  }
  if (tagow > 0 || przydzialow > 0) {
    logEvent("reguly_zastosowane", autor, null, { tagow, przydzialow, regul: reguly.length });
  }
  return { sprawdzonych: sprawy.length, tagow, przydzialow };
}
