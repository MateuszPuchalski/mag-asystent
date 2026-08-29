import { db, nowIso, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { dopiszZdarzenie, type RodzajZrodlaOsi } from "./os-sprawy.js";

/* ── Encja sprawy — problem klienta ponad rejestrami (0.128.0) ───────────────
   `sprawa` i `sprawa_zrodlo` to NAKŁADKA (docs/architektura-spraw.md):
   rejestry per-typ zostają nośnikami mechaniki, sprawa skleja je w problem
   klienta. Sklejanie automatyczne WYŁĄCZNIE po order_id; pytanie nie ma
   zamówienia, więc jest zawsze osobną sprawą — dwa pytania jednego klienta
   to dwie sprawy z konstrukcji.

   Tabelę utrzymuje PEŁNA, idempotentna rekoncyliacja wołana z mutacji
   (sync, przyjęcie, decyzja, wysyłka…), nigdy z odczytu — zero zapisu przy
   patrzeniu. Pominięty punkt mutacji kosztuje najwyżej chwilową nieświeżość
   naprawianą następną mutacją, a kolejka i tak nie zgubi źródła: odczyt
   pokazuje źródło bez wiersza w sprawa_zrodlo jako pseudo-sprawę.

   SQL inline zamiast importów z serwisów rejestrów — one importują TEN
   moduł (hooki), więc odwrotny kierunek byłby cyklem.                        */

export type RodzajZrodla = "pytanie" | "zwrot" | "dyskusja" | "reklamacja";

/** Awaria pracy ze sprawą; `kod` niesie status HTTP dla trasy. */
export class BladSprawy extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladSprawy";
  }
}

/**
 * Liczba spod maski `client:44300444` to buyer.id (dowód: test
 * `normalizujRef` i adapter dev kluczujący wątki po id). Bliźniak SQL-owej
 * dosypki `dosypIdZMaski` w db.ts — obie strony muszą orzekać tak samo.
 */
export function kupujacyIdZMaski(login: string | null): string | null {
  const m = login?.match(/^client:(\d+)$/);
  return m ? m[1] : null;
}

/** Jedno źródło zebrane z rejestru — surowiec rekoncyliacji i przejęcia. */
interface Zrodlo {
  rodzaj: RodzajZrodla;
  lokalnyId: number;
  allegroId: string | null;
  /** Klucz grupy: order_id, klucz zastępczy `zwrot:<id>` albo singleton. */
  grupa: string;
  kupujacyId: string | null;
  kupujacyLogin: string | null;
  orderId: string | null;
  otwarte: boolean;
  prowadzi: string | null;
  prowadziAt: string | null;
  kiedy: string | null;
}

/**
 * Zbiera WSZYSTKIE źródła (także zamknięte — historia klienta też grupuje).
 * Predykaty otwartości przepisane z budowniczych kolejki (services/sprawy.ts)
 * — pilnuje ich test „suma źródeł równa się licznikom per-typ".
 */
function zbierzZrodla(): Zrodlo[] {
  const d = db();
  const zrodla: Zrodlo[] = [];

  for (const w of d
    .prepare(
      `SELECT id, thread_id, kupujacy_id, kupujacy_login, status, prowadzi, prowadzi_at,
              otrzymano_at FROM pytanie`
    )
    .all() as Array<Record<string, unknown>>) {
    zrodla.push({
      rodzaj: "pytanie",
      lokalnyId: w.id as number,
      allegroId: (w.thread_id as string | null) ?? null,
      /* Pytanie wisi przy ofercie, nie przy zamówieniu — zawsze singleton. */
      grupa: `pytanie:${w.id}`,
      kupujacyId: (w.kupujacy_id as string | null) ?? null,
      kupujacyLogin: (w.kupujacy_login as string | null) ?? null,
      orderId: null,
      otwarte: w.status === "nowe" || w.status === "szkic",
      prowadzi: (w.prowadzi as string | null) ?? null,
      prowadziAt: (w.prowadzi_at as string | null) ?? null,
      kiedy: (w.otrzymano_at as string | null) ?? null,
    });
  }

  for (const w of d
    .prepare(
      `SELECT id, allegro_return_id, allegro_order_id, kupujacy_id, kupujacy_login,
              status, prowadzi, prowadzi_at, utworzono_allegro, utworzono_at FROM zwrot`
    )
    .all() as Array<Record<string, unknown>>) {
    zrodla.push({
      rodzaj: "zwrot",
      lokalnyId: w.id as number,
      allegroId: (w.allegro_return_id as string | null) ?? null,
      /* Zwrot ręczny bez zamówienia dostaje klucz zastępczy — jego
         reklamacje muszą trafić do TEJ SAMEJ sprawy. */
      grupa: (w.allegro_order_id as string | null) ?? `zwrot:${w.id}`,
      kupujacyId: (w.kupujacy_id as string | null) ?? null,
      kupujacyLogin: (w.kupujacy_login as string | null) ?? null,
      orderId: (w.allegro_order_id as string | null) ?? null,
      otwarte: w.status === "nowy" || w.status === "oceniony",
      prowadzi: (w.prowadzi as string | null) ?? null,
      prowadziAt: (w.prowadzi_at as string | null) ?? null,
      kiedy:
        (w.utworzono_allegro as string | null) ?? (w.utworzono_at as string | null) ?? null,
    });
  }

  for (const w of d
    .prepare(
      `SELECT id, allegro_id, order_id, kupujacy_login, status, prowadzi, prowadzi_at,
              utworzono_allegro, utworzono_at FROM dyskusja`
    )
    .all() as Array<Record<string, unknown>>) {
    zrodla.push({
      rodzaj: "dyskusja",
      lokalnyId: w.id as number,
      allegroId: (w.allegro_id as string | null) ?? null,
      grupa: (w.order_id as string | null) ?? `dyskusja:${w.id}`,
      kupujacyId: null,
      kupujacyLogin: (w.kupujacy_login as string | null) ?? null,
      orderId: (w.order_id as string | null) ?? null,
      otwarte: w.status === "nowa" || w.status === "w_toku",
      prowadzi: (w.prowadzi as string | null) ?? null,
      prowadziAt: (w.prowadzi_at as string | null) ?? null,
      kiedy:
        (w.utworzono_allegro as string | null) ?? (w.utworzono_at as string | null) ?? null,
    });
  }

  for (const w of d
    .prepare(
      `SELECT p.id, p.zwrot_id, p.rekl_wynik, p.rekl_prowadzi, p.rekl_prowadzi_at,
              z.allegro_order_id, z.kupujacy_id, z.kupujacy_login,
              z.utworzono_allegro, z.utworzono_at
         FROM zwrot_pozycja p JOIN zwrot z ON z.id = p.zwrot_id
        WHERE p.decyzja = 'reklamacja'`
    )
    .all() as Array<Record<string, unknown>>) {
    zrodla.push({
      rodzaj: "reklamacja",
      lokalnyId: w.id as number,
      allegroId: null,
      /* Reklamacja dziedziczy grupę SWOJEGO zwrotu: pozycja tej samej paczki
         to ten sam problem klienta (zasada 1). */
      grupa: (w.allegro_order_id as string | null) ?? `zwrot:${w.zwrot_id}`,
      kupujacyId: (w.kupujacy_id as string | null) ?? null,
      kupujacyLogin: (w.kupujacy_login as string | null) ?? null,
      orderId: (w.allegro_order_id as string | null) ?? null,
      otwarte: w.rekl_wynik === null,
      prowadzi: (w.rekl_prowadzi as string | null) ?? null,
      prowadziAt: (w.rekl_prowadzi_at as string | null) ?? null,
      kiedy:
        (w.utworzono_allegro as string | null) ?? (w.utworzono_at as string | null) ?? null,
    });
  }

  return zrodla;
}

/**
 * Pełna rekoncyliacja tabel sprawa/sprawa_zrodlo. Idempotentna i
 * deterministyczna — dwa procesy (API + worker) mogą wejść tu naraz:
 * BEGIN IMMEDIATE serializuje, a drugi przebieg zastaje stan gotowy.
 *
 * NIE woła logEvent — ten sam świadomy wyjątek co przy watek_meta:
 * rekoncyliacja to projekcja operacji już zalogowanych (sync, decyzja,
 * wysyłka), osobne zdarzenie podwajałoby dziennik bez nowej informacji.
 */
export function przebudujSprawy(): void {
  const d = db();
  transaction(d, () => {
    const zrodla = zbierzZrodla();
    const teraz = nowIso();

    /* Stan zastany: gdzie źródła mieszkają dziś. Wiązanie ręczne (SCAL
       z etapu D) jest nierozkładalne — takie źródło zostaje w swojej
       sprawie i nie wchodzi do przeliczenia grupy. */
    const zastane = new Map<
      string,
      { sprawaId: number; wiazanie: string }
    >();
    for (const w of d
      .prepare("SELECT rodzaj, lokalny_id, sprawa_id, wiazanie FROM sprawa_zrodlo")
      .all() as Array<Record<string, unknown>>) {
      zastane.set(`${w.rodzaj}:${w.lokalny_id}`, {
        sprawaId: w.sprawa_id as number,
        wiazanie: w.wiazanie as string,
      });
    }
    const sprawyZastane = new Map<number, Record<string, unknown>>();
    for (const w of d
      .prepare("SELECT id, prowadzi, prowadzi_at, utworzono_at FROM sprawa")
      .all() as Array<Record<string, unknown>>) {
      sprawyZastane.set(w.id as number, w);
    }

    /* ── FAZA A: grupowanie automatyczne ──────────────────────────────────
       Członkowie ręczni (SCAL) wypadają z grup — ich dom wybrała ręka
       człowieka i automat nie ma prawa go rozkleić. Wracają w fazie B,
       bo denormalizacja sprawy MUSI ich widzieć: sprawa złożona z samych
       wiązań ręcznych inaczej nie dostałaby ani kupującego, ani zamknięcia. */
    const grupy = new Map<string, Zrodlo[]>();
    for (const z of zrodla) {
      const stan = zastane.get(`${z.rodzaj}:${z.lokalnyId}`);
      if (stan?.wiazanie === "reczne") continue;
      const lista = grupy.get(z.grupa) ?? [];
      lista.push(z);
      grupy.set(z.grupa, lista);
    }

    const wstawSprawe = d.prepare("INSERT INTO sprawa (utworzono_at) VALUES (?)");
    const wstawZrodlo = d.prepare(
      `INSERT INTO sprawa_zrodlo (sprawa_id, rodzaj, lokalny_id, allegro_id, wiazanie, dodano_at)
       VALUES (?,?,?,?, 'auto', ?)
       ON CONFLICT(rodzaj, lokalny_id) DO UPDATE SET
         sprawa_id = excluded.sprawa_id,
         allegro_id = excluded.allegro_id`
    );

    const zyweZrodla = new Set<string>();
    /* Komplet członków KAŻDEJ żywej sprawy — na tym liczy się denormalizacja
       w fazie C, dokładnie RAZ na sprawę. Dwa UPDATE-y na tę samą sprawę
       (grupa automatyczna + osobno ręczni) nadpisałyby ją połową danych. */
    const czlonkowiePoSprawie = new Map<number, Zrodlo[]>();
    const domyPoSprawie = new Map<number, Set<number>>();
    const dopisz = (sprawaId: number, z: Zrodlo, domy: number[]) => {
      const lista = czlonkowiePoSprawie.get(sprawaId) ?? [];
      lista.push(z);
      czlonkowiePoSprawie.set(sprawaId, lista);
      const zbior = domyPoSprawie.get(sprawaId) ?? new Set<number>();
      for (const dom of domy) zbior.add(dom);
      domyPoSprawie.set(sprawaId, zbior);
      zyweZrodla.add(`${z.rodzaj}:${z.lokalnyId}`);
    };

    for (const czlonkowie of grupy.values()) {
      /* Grupa przejmuje sprawę o NAJMNIEJSZYM id spośród zastanych domów
         członków — stabilność id jest fundamentem pod zdarzenia etapu D. */
      const domy: number[] = [];
      for (const z of czlonkowie) {
        const stan = zastane.get(`${z.rodzaj}:${z.lokalnyId}`);
        if (stan) domy.push(stan.sprawaId);
      }
      const sprawaId =
        domy.length > 0 ? Math.min(...domy) : Number(wstawSprawe.run(teraz).lastInsertRowid);

      for (const z of czlonkowie) {
        wstawZrodlo.run(sprawaId, z.rodzaj, z.lokalnyId, z.allegroId, teraz);
        dopisz(sprawaId, z, domy);
      }
    }

    /* ── FAZA B: członkowie ręczni pod swoim zastanym domem ────────────────
       Bez `wstawZrodlo` — wiersz już wskazuje właściwą sprawę, a przepisanie
       go z `wiazanie` z powrotem na `auto` skasowałoby decyzję człowieka. */
    for (const z of zrodla) {
      const stan = zastane.get(`${z.rodzaj}:${z.lokalnyId}`);
      if (stan?.wiazanie !== "reczne") continue;
      dopisz(stan.sprawaId, z, [stan.sprawaId]);
    }

    /* ── FAZA C: denormalizacja RAZ na sprawę, nad kompletem członków ──── */
    for (const [sprawaId, czlonkowie] of czlonkowiePoSprawie) {
      /* Login: prawdziwy przed maską (maska ma dwukropek). Przy scaleniu
         `prowadzi` ocala się z wchłanianych spraw — najwcześniejszy stempel
         wygrywa, bo to on mówi, kto wziął problem pierwszy. */
      const kupujacyId = czlonkowie.map((z) => z.kupujacyId).find((v) => v) ?? null;
      const loginy = czlonkowie.map((z) => z.kupujacyLogin).filter((v): v is string => !!v);
      const login = loginy.find((l) => !l.includes(":")) ?? loginy[0] ?? null;
      const orderId = czlonkowie.map((z) => z.orderId).find((v) => v) ?? null;
      const otwarta = czlonkowie.some((z) => z.otwarte);

      let prowadzi: string | null = null;
      let prowadziAt: string | null = null;
      for (const domId of domyPoSprawie.get(sprawaId) ?? []) {
        const s = sprawyZastane.get(domId);
        const p = (s?.prowadzi as string | null) ?? null;
        const pAt = (s?.prowadzi_at as string | null) ?? null;
        if (p && (!prowadziAt || (pAt && pAt < prowadziAt))) {
          prowadzi = p;
          prowadziAt = pAt;
        }
      }

      d.prepare(
        `UPDATE sprawa
            SET kupujacy_id = ?, kupujacy_login = ?, order_id = ?,
                prowadzi = COALESCE(prowadzi, ?),
                prowadzi_at = COALESCE(prowadzi_at, ?),
                zamknieto_at = CASE WHEN ? THEN NULL ELSE COALESCE(zamknieto_at, ?) END
          WHERE id = ?`
      ).run(kupujacyId, login, orderId, prowadzi, prowadziAt, otwarta ? 1 : 0, teraz, sprawaId);
    }

    /* Sprzątanie: wiązania do skasowanych źródeł i sprawy-sieroty. */
    for (const klucz of zastane.keys()) {
      if (!zyweZrodla.has(klucz)) {
        const [rodzaj, lokalny] = klucz.split(":");
        d.prepare("DELETE FROM sprawa_zrodlo WHERE rodzaj = ? AND lokalny_id = ?").run(
          rodzaj,
          Number(lokalny)
        );
      }
    }
    d.prepare(
      "DELETE FROM sprawa WHERE id NOT IN (SELECT DISTINCT sprawa_id FROM sprawa_zrodlo)"
    ).run();
  })();
}

export interface WpisMapyZrodel {
  sprawaId: number;
  prowadzi: string | null;
  prowadziAt: string | null;
  kupujacyId: string | null;
  zrodla: Array<{ rodzaj: RodzajZrodla; lokalnyId: number; wiazanie: string }>;
}

/** Mapa „rodzaj:id" → sprawa — dla grupowania w kolejce (services/sprawy.ts). */
export function mapaZrodel(): Map<string, WpisMapyZrodel> {
  const d = db();
  const sprawy = new Map<number, WpisMapyZrodel>();
  for (const w of d
    .prepare("SELECT id, prowadzi, prowadzi_at, kupujacy_id FROM sprawa")
    .all() as Array<Record<string, unknown>>) {
    sprawy.set(w.id as number, {
      sprawaId: w.id as number,
      prowadzi: (w.prowadzi as string | null) ?? null,
      prowadziAt: (w.prowadzi_at as string | null) ?? null,
      kupujacyId: (w.kupujacy_id as string | null) ?? null,
      zrodla: [],
    });
  }
  const mapa = new Map<string, WpisMapyZrodel>();
  for (const w of d
    .prepare("SELECT sprawa_id, rodzaj, lokalny_id, wiazanie FROM sprawa_zrodlo")
    .all() as Array<Record<string, unknown>>) {
    const wpis = sprawy.get(w.sprawa_id as number);
    if (!wpis) continue;
    wpis.zrodla.push({
      rodzaj: w.rodzaj as RodzajZrodla,
      lokalnyId: w.lokalny_id as number,
      /* Panel rysuje ROZKLEJ tylko przy wiązaniach ręcznych — automatu nie
         ma po co rozklejać, wróciłby w tej samej sekundzie. */
      wiazanie: w.wiazanie as string,
    });
    mapa.set(`${w.rodzaj}:${w.lokalny_id}`, wpis);
  }
  return mapa;
}

/** Otwarte źródła sprawy — trasa przejęcia stempluje każde z nich. */
export function zrodlaSprawy(
  sprawaId: number
): Array<{ rodzaj: RodzajZrodla; lokalnyId: number; otwarte: boolean }> {
  const wiazania = db()
    .prepare("SELECT rodzaj, lokalny_id FROM sprawa_zrodlo WHERE sprawa_id = ?")
    .all(sprawaId) as Array<{ rodzaj: RodzajZrodla; lokalny_id: number }>;
  const otwartosc = new Map(
    zbierzZrodla().map((z) => [`${z.rodzaj}:${z.lokalnyId}`, z.otwarte])
  );
  return wiazania.map((w) => ({
    rodzaj: w.rodzaj,
    lokalnyId: w.lokalny_id,
    otwarte: otwartosc.get(`${w.rodzaj}:${w.lokalny_id}`) ?? false,
  }));
}

/**
 * Stempel przejęcia NA SPRAWIE (WEZMĘ TO z kolejki). Stemple per-typ na
 * źródłach kładzie trasa istniejącymi funkcjami rejestrów — wołanie ich
 * stąd zawiązałoby cykl importów (rejestry importują ten moduł).
 */
export function stempelProwadziSprawy(sprawaId: number, autor: string): void {
  const zmiana = db()
    .prepare("UPDATE sprawa SET prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?")
    .run(autor, sprawaId);
  if (zmiana.changes === 0) throw new Error("Nie ma takiej sprawy");
  logEvent("sprawa_prowadzi", autor, null, { sprawaId });
}

/* ── Sklejanie ręką człowieka: SCAL i ROZKLEJ (0.129.0) ──────────────────────
   Automat skleja WYŁĄCZNIE po numerze zamówienia, a pytanie zamówienia nie
   ma — więc podpowiedź „ten sam kupujący" z 0.128.0 wisiała jako sam odczyt,
   bez sposobu, żeby ją potwierdzić. Te dwie operacje są tym potwierdzeniem
   i jego cofnięciem. Obie to decyzje człowieka, więc obie logują zdarzenie
   (inaczej niż sama rekoncyliacja, która jest projekcją).                    */

/**
 * Scala dwie sprawy w jedną. Docelowa to ZAWSZE mniejsze id — niezależnie od
 * tego, co przysłał panel: stabilność id sprawy jest fundamentem pod oś czasu
 * (etap D2), więc scalenie nigdy nie tworzy nowego identyfikatora.
 *
 * Źródła dawcy dostają `wiazanie='reczne'`, żeby następna rekoncyliacja ich
 * nie rozkleiła po własnym kluczu grupy. Docelowa zachowuje swoje wiązania
 * automatyczne — grupowanie po `order_id` ma u niej działać dalej.
 */
export function scalSprawy(a: number, b: number, autor: string): number {
  if (a === b) throw new BladSprawy("To jest jedna i ta sama sprawa", 409);
  const d = db();
  const istnieje = (id: number) =>
    d.prepare("SELECT 1 AS jest FROM sprawa WHERE id = ?").get(id) !== undefined;
  if (!istnieje(a) || !istnieje(b)) throw new BladSprawy("Nie ma takiej sprawy", 404);

  const docelowa = Math.min(a, b);
  const dawca = Math.max(a, b);
  /* Kogo przenosimy — czytamy PRZED zapisem, bo po nim dawca nie ma już
     źródeł. Zdarzenie osi czasu wisi przy źródle, więc trafia dokładnie na
     te wiersze, które zmieniły dom. */
  const przenoszone = d
    .prepare("SELECT rodzaj, lokalny_id FROM sprawa_zrodlo WHERE sprawa_id = ?")
    .all(dawca) as Array<{ rodzaj: string; lokalny_id: number }>;
  let zrodel = 0;
  transaction(d, () => {
    zrodel = Number(
      d
        .prepare(
          "UPDATE sprawa_zrodlo SET sprawa_id = ?, wiazanie = 'reczne' WHERE sprawa_id = ?"
        )
        .run(docelowa, dawca).changes
    );
  })();
  /* Sprawa-dawca zostaje bez źródeł i znika w sprzątaniu rekoncyliacji;
     denormalizacja docelowej przelicza się nad kompletem członków. */
  przebudujSprawy();
  logEvent("sprawa_scalona", autor, null, { docelowa, dawca, zrodel });
  const kiedy = nowIso();
  for (const z of przenoszone) {
    dopiszZdarzenie({
      rodzaj: z.rodzaj as RodzajZrodlaOsi,
      lokalnyId: z.lokalny_id,
      typ: "scalona",
      kto: "my",
      autor,
      szczegol: `sprawa ${docelowa}`,
      wariant: kiedy,
    });
  }
  return docelowa;
}

/**
 * Cofa scalenie: wszystkie ręcznie spięte źródła sprawy wracają pod automat.
 *
 * Jednostką jest SPRAWA, nie pojedyncze źródło — bo jednostką SCAL-u też jest
 * sprawa. Rozklejanie po jednym źródle dawało stany, których nikt nie chciał
 * (zwrot osobno, a dyskusja tego samego zamówienia dalej przy cudzym
 * pytaniu) i bywało nieodwracalne, gdy rodzeństwo dzieliło klucz grupy.
 *
 * Źródła WYPISUJEMY ze sprawy, zamiast tylko przestawiać `wiazanie` na
 * `auto`: rekoncyliacja trzyma źródło w jego zastanym domu (reguła
 * „najmniejsze id" chroni stabilność przy sklejaniu), więc sam powrót na
 * automat nie rozdzieliłby niczego. Skasowane wiersze odtwarza następna
 * przebudowa — każde źródło trafia tam, gdzie należy wg numeru zamówienia.
 */
export function rozklejSprawe(sprawaId: number, autor: string): number {
  const d = db();
  const reczne = d
    .prepare("SELECT rodzaj, lokalny_id FROM sprawa_zrodlo WHERE sprawa_id = ? AND wiazanie = 'reczne'")
    .all(sprawaId) as Array<{ rodzaj: string; lokalny_id: number }>;
  if (reczne.length === 0) {
    const istnieje = d.prepare("SELECT 1 AS jest FROM sprawa WHERE id = ?").get(sprawaId);
    if (!istnieje) throw new BladSprawy("Nie ma takiej sprawy", 404);
    throw new BladSprawy(
      "W tej sprawie nic nie zostało spięte ręką — automat sklei ją tak samo po rozklejeniu",
      409
    );
  }
  transaction(d, () => {
    for (const r of reczne) {
      d.prepare("DELETE FROM sprawa_zrodlo WHERE rodzaj = ? AND lokalny_id = ?").run(
        r.rodzaj,
        r.lokalny_id
      );
    }
  })();
  przebudujSprawy();
  logEvent("sprawa_rozklejona", autor, null, { sprawaId, zrodel: reczne.length });
  const kiedyRozklejenia = nowIso();
  for (const r of reczne) {
    dopiszZdarzenie({
      rodzaj: r.rodzaj as RodzajZrodlaOsi,
      lokalnyId: r.lokalny_id,
      typ: "rozklejona",
      kto: "my",
      autor,
      szczegol: `ze sprawy ${sprawaId}`,
      wariant: kiedyRozklejenia,
    });
  }
  return sprawaId;
}
