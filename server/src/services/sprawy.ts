import { db } from "../db/db.js";
import { licznikOtwartych, licznikiPytan, stanSynchronizacjiPytan } from "./pytania.js";
import { licznikDyskusji, stanSynchronizacjiDyskusji } from "./dyskusje.js";
import { listaReklamacji, terminReklamacji } from "./reklamacje.js";

/* ── Sprawy — cztery rejestry Allegro, jedna kolejka pracy ───────────────────
   Pytania, zwroty, dyskusje i reklamacje to w backendzie osobne obiekty
   Allegro i osobne tabele — i tak ma zostać. Ale biuro nie pracuje
   w czterech modułach: pyta „co mam teraz zrobić?", a odpowiedź na to
   pytanie musi widzieć wszystkie cztery naraz. Ten moduł składa je w jedną
   listę SPRAW: wspólny kształt wiersza, wspólny sort po pilności (ustawowy
   termin przed wiekiem), wspólny licznik na zakładkę.

   WYŁĄCZNIE ODCZYT. Mutacje zostają w serwisach per-typ — sprawa w kolejce
   to widok na cudzy rejestr, nie nowy byt z własnym stanem.

   Predykaty „otwartości" są PRZEPISANE z serwisów źródłowych (wskazanych
   przy każdym SELECT); test w sprawy.test.ts porównuje liczby z tamtymi
   serwisami, żeby dopisany komuś status nie schował spraw z głównej kolejki. */

export type RodzajSprawy = "pytanie" | "zwrot" | "dyskusja" | "reklamacja";

export const RODZAJE_SPRAW: RodzajSprawy[] = ["pytanie", "zwrot", "dyskusja", "reklamacja"];

export interface Sprawa {
  rodzaj: RodzajSprawy;
  /** Id w rejestrze źródłowym; dla reklamacji to id POZYCJI zwrotu. */
  id: number;
  klient: string | null;
  /** Co biuro widzi w wierszu: temat, tytuł oferty albo nazwa towaru. */
  tytul: string | null;
  /** Checkout-form id Allegro — klucz ciągu „to samo zamówienie". */
  orderId: string | null;
  status: string;
  /** Kiedy sprawa się zaczęła — po tym sortuje się ogon bez terminu. */
  kiedy: string | null;
  /** Ustawowy zegar (reklamacje i CLAIM-y); null = sprawa bez terminu. */
  dniDoTerminu: number | null;
  poTerminie: boolean;
  prowadzi: string | null;
  /** Dla reklamacji: zwrot, który UI ma otworzyć — reklamacja nie ma szczegółu. */
  zwrotId?: number;
  /** Sprawa zamknięta trafia tylko do historii klienta, nigdy do kolejki. */
  otwarta: boolean;
}

const wiersz = (r: Record<string, unknown>) => r as Record<string, unknown>;

/** Wspólny sort kolejki: po terminie najpierw, potem termin rosnąco, potem najstarsze. */
function poPilnosci(a: Sprawa, b: Sprawa): number {
  const aTermin = a.dniDoTerminu !== null;
  const bTermin = b.dniDoTerminu !== null;
  if (aTermin && bTermin && a.dniDoTerminu !== b.dniDoTerminu) {
    return a.dniDoTerminu! - b.dniDoTerminu!;
  }
  if (aTermin !== bTermin) return aTermin ? -1 : 1;
  const aOd = a.kiedy ? Date.parse(a.kiedy) : Infinity;
  const bOd = b.kiedy ? Date.parse(b.kiedy) : Infinity;
  return aOd - bOd;
}

/** Skrót treści do wiersza kolejki — pytanie bywa trzema akapitami. */
function skrot(tekst: string | null): string | null {
  if (!tekst) return null;
  const t = tekst.replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

function sprawyPytan(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT id, kupujacy_login, oferta_tytul, tresc, status, otrzymano_at, prowadzi
       FROM pytanie WHERE ${gdzie} ORDER BY id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  return rows.map((r0) => {
    const r = wiersz(r0);
    const status = (r.status as string) ?? "nowe";
    return {
      rodzaj: "pytanie" as const,
      id: Number(r.id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.oferta_tytul as string) ?? skrot((r.tresc as string) ?? null),
      orderId: null, // pytanie wisi przy ofercie, nie przy zamówieniu
      status,
      kiedy: (r.otrzymano_at as string) ?? null,
      dniDoTerminu: null,
      poTerminie: false,
      prowadzi: (r.prowadzi as string) ?? null,
      /* Ta sama para co worklista pytań (services/pytania.ts, listaPytan). */
      otwarta: status === "nowe" || status === "szkic",
    };
  });
}

function sprawyZwrotow(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT id, kupujacy_login, referencja, waybill, allegro_order_id, status,
              utworzono_allegro, utworzono_at
       FROM zwrot WHERE ${gdzie} ORDER BY id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  return rows.map((r0) => {
    const r = wiersz(r0);
    const status = (r.status as string) ?? "nowy";
    return {
      rodzaj: "zwrot" as const,
      id: Number(r.id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.referencja as string) ?? (r.waybill as string) ?? null,
      orderId: (r.allegro_order_id as string) ?? null,
      status,
      kiedy: (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null,
      dniDoTerminu: null,
      poTerminie: false,
      prowadzi: null, // zwrot nie ma znacznika prowadzenia — celowo (schema)
      /* Jedynym terminalnym statusem zwrotu jest `rozliczony` (przeliczStatus,
         services/zwroty.ts): `nowy` czeka na ocenę, `oceniony` na zwrot
         środków. Oba są pracą biura, więc oba stoją w kolejce. */
      otwarta: status === "nowy" || status === "oceniony",
    };
  });
}

function sprawyDyskusji(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT id, kupujacy_login, temat, typ, status, order_id, utworzono_allegro,
              utworzono_at, prowadzi
       FROM dyskusja WHERE ${gdzie} ORDER BY id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  const teraz = Date.now();
  return rows.map((r0) => {
    const r = wiersz(r0);
    const status = (r.status as string) ?? "nowa";
    const typ = (r.typ as string) ?? null;
    const kiedy = (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null;
    /* Zegar mają tylko CLAIM-y — ta sama arytmetyka i ten sam powód liczenia
       w JS co w licznikDyskusji (services/dyskusje.ts): drugie wydanie
       terminu w SQL rozjechałoby się z listą reklamacji. */
    const zegar =
      typ === "CLAIM" && (r.utworzono_allegro as string)
        ? terminReklamacji(r.utworzono_allegro as string, teraz)
        : null;
    const otwarta = status === "nowa" || status === "w_toku";
    return {
      rodzaj: "dyskusja" as const,
      id: Number(r.id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.temat as string) ?? (typ === "CLAIM" ? "Reklamacja Allegro" : "Dyskusja"),
      orderId: (r.order_id as string) ?? null,
      status,
      kiedy,
      dniDoTerminu: zegar ? zegar.dniDoTerminu : null,
      poTerminie: otwarta && zegar !== null && zegar.dniDoTerminu < 0,
      prowadzi: (r.prowadzi as string) ?? null,
      /* Ta sama para co worklista dyskusji (services/dyskusje.ts). */
      otwarta,
    };
  });
}

function sprawyReklamacji(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT p.id AS pozycja_id, p.zwrot_id, p.nazwa, p.rekl_wynik, p.rekl_prowadzi,
              z.kupujacy_login, z.allegro_order_id, z.utworzono_allegro, z.utworzono_at
       FROM zwrot_pozycja p JOIN zwrot z ON z.id = p.zwrot_id
       WHERE p.decyzja = 'reklamacja' AND ${gdzie}
       ORDER BY p.id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  const teraz = Date.now();
  return rows.map((r0) => {
    const r = wiersz(r0);
    const wynik = (r.rekl_wynik as string) ?? null;
    const kiedy = (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null;
    const zegar = kiedy ? terminReklamacji(kiedy, teraz) : null;
    const otwarta = wynik === null;
    return {
      rodzaj: "reklamacja" as const,
      id: Number(r.pozycja_id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.nazwa as string) ?? null,
      orderId: (r.allegro_order_id as string) ?? null,
      /* Status reklamacji to jej wynik; otwarta nie ma wyniku. Ten sam
         predykat co listaReklamacji (services/reklamacje.ts). */
      status: wynik ?? "otwarta",
      kiedy,
      dniDoTerminu: otwarta && zegar ? zegar.dniDoTerminu : null,
      poTerminie: otwarta && zegar !== null && zegar.dniDoTerminu < 0,
      prowadzi: (r.rekl_prowadzi as string) ?? null,
      zwrotId: Number(r.zwrot_id),
      otwarta,
    };
  });
}

/**
 * Kolejka spraw: wszystkie OTWARTE sprawy czterech rejestrów, po pilności.
 * `rodzaj` zawęża do jednego typu (chipy filtra w kolejce).
 */
export function listaSpraw(rodzaj?: RodzajSprawy): Sprawa[] {
  const chce = (r: RodzajSprawy) => !rodzaj || rodzaj === r;
  const sprawy: Sprawa[] = [
    ...(chce("pytanie") ? sprawyPytan("status IN ('nowe','szkic')", []) : []),
    ...(chce("zwrot") ? sprawyZwrotow("status IN ('nowy','oceniony')", []) : []),
    ...(chce("dyskusja") ? sprawyDyskusji("status IN ('nowa','w_toku')", []) : []),
    ...(chce("reklamacja") ? sprawyReklamacji("p.rekl_wynik IS NULL", []) : []),
  ];
  return sprawy.sort(poPilnosci);
}

/**
 * Klient 360 — drugi poziom, otwierany klikiem w login z dowolnej sprawy.
 * `login === null` to kubełek spraw bez klienta (wklejki, zwroty ręczne):
 * jeden wspólny, żeby nic nie ginęło poza kolejką.
 */
export function sprawyKlienta(login: string | null): { aktywne: Sprawa[]; historia: Sprawa[] } {
  const [gdzie, gdzieZ, gdzieR, param] = login
    ? ["kupujacy_login = ?", "kupujacy_login = ?", "z.kupujacy_login = ?", [login]]
    : ["kupujacy_login IS NULL", "kupujacy_login IS NULL", "z.kupujacy_login IS NULL", []];
  const wszystkie = [
    ...sprawyPytan(gdzie, param),
    ...sprawyZwrotow(gdzieZ, param),
    ...sprawyDyskusji(gdzie, param),
    ...sprawyReklamacji(gdzieR, param),
  ];
  const aktywne = wszystkie.filter((s) => s.otwarta).sort(poPilnosci);
  /* Historia od najnowszej — czytana jak kartoteka, nie jak kolejka. */
  const historia = wszystkie
    .filter((s) => !s.otwarta)
    .sort((a, b) => (b.kiedy ? Date.parse(b.kiedy) : 0) - (a.kiedy ? Date.parse(a.kiedy) : 0))
    .slice(0, 30);
  return { aktywne, historia };
}

/**
 * Powiązane sprawy — ciąg „pytanie → zwrot → dyskusja" jednego problemu.
 * Allegro reprezentuje te obiekty osobno; łączymy je z kluczy, które już są.
 * Najpierw to samo zamówienie (`order_id` — najmocniejszy dowód), potem ten
 * sam login (podpisany słabiej, bo stały klient miewa wiele niezwiązanych
 * spraw). Pytania nie mają zamówienia — dołączają wyłącznie po loginie.
 */
export function powiazaneSprawy(rodzaj: RodzajSprawy, id: number): {
  zamowienie: Sprawa[];
  klient: Sprawa[];
} {
  const zrodlo = sprawaZrodlowa(rodzaj, id);
  if (!zrodlo) return { zamowienie: [], klient: [] };

  const nieJa = (s: Sprawa) => !(s.rodzaj === rodzaj && s.id === id);
  /* Reklamacja jest pozycją swojego zwrotu — nie pokazujemy zwrotu-rodzica
     jako „powiązania", bo UI i tak otwiera reklamację przez ten zwrot. */
  const nieRodzic = (s: Sprawa) =>
    !(rodzaj === "reklamacja" && s.rodzaj === "zwrot" && s.id === zrodlo.zwrotId);

  let zamowienie: Sprawa[] = [];
  if (zrodlo.orderId) {
    zamowienie = [
      ...sprawyZwrotow("allegro_order_id = ?", [zrodlo.orderId]),
      ...sprawyDyskusji("order_id = ?", [zrodlo.orderId]),
      ...sprawyReklamacji("z.allegro_order_id = ?", [zrodlo.orderId]),
    ]
      .filter(nieJa)
      .filter(nieRodzic)
      .sort(poPilnosci)
      .slice(0, 10);
  }

  let klient: Sprawa[] = [];
  if (zrodlo.klient) {
    const zZamowienia = new Set(zamowienie.map((s) => `${s.rodzaj}:${s.id}`));
    const { aktywne } = sprawyKlienta(zrodlo.klient);
    klient = aktywne
      .filter(nieJa)
      .filter(nieRodzic)
      .filter((s) => !zZamowienia.has(`${s.rodzaj}:${s.id}`))
      .slice(0, 10);
  }
  return { zamowienie, klient };
}

/** Jedna sprawa po (rodzaj, id) — punkt zaczepienia dla powiązań. */
function sprawaZrodlowa(rodzaj: RodzajSprawy, id: number): Sprawa | null {
  const jedna = (lista: Sprawa[]) => lista.find((s) => s.id === id) ?? null;
  switch (rodzaj) {
    case "pytanie":
      return jedna(sprawyPytan("id = ?", [id]));
    case "zwrot":
      return jedna(sprawyZwrotow("id = ?", [id]));
    case "dyskusja":
      return jedna(sprawyDyskusji("id = ?", [id]));
    case "reklamacja":
      return jedna(sprawyReklamacji("p.id = ?", [id]));
  }
}

export interface LicznikSpraw {
  /** Suma otwartych spraw — pigułka na zakładce. */
  otwartych: number;
  pytaniaOtwarte: number;
  pytaniaNowe: number;
  szkice: number;
  zwrotyOtwarte: number;
  dyskusjeNowe: number;
  dyskusjeWToku: number;
  poTerminie: number;
  reklamacjeOtwarte: number;
  synchronizacjaPytan: ReturnType<typeof stanSynchronizacjiPytan>;
  synchronizacjaDyskusji: ReturnType<typeof stanSynchronizacjiDyskusji>;
}

/**
 * Licznik na zakładkę SPRAWY — SKŁADANY z liczników per-typ, nie liczony
 * czwarty raz: pigułka i karty muszą pokazywać te same liczby, a dwie
 * implementacje tego samego COUNT-a zawsze w końcu się rozjeżdżają.
 */
export function licznikSpraw(): LicznikSpraw {
  const pyt = licznikiPytan();
  const dysk = licznikDyskusji();
  const reklamacje = listaReklamacji();
  const zwroty = db()
    .prepare(`SELECT COUNT(*) AS n FROM zwrot WHERE status IN ('nowy','oceniony')`)
    .get() as { n: number };
  const poTerminie =
    dysk.claimyPoTerminie + reklamacje.filter((r) => r.poTerminie).length;
  return {
    otwartych:
      licznikOtwartych() + zwroty.n + dysk.nowe + dysk.wToku + reklamacje.length,
    pytaniaOtwarte: licznikOtwartych(),
    pytaniaNowe: pyt.nowe,
    szkice: pyt.szkice,
    zwrotyOtwarte: zwroty.n,
    dyskusjeNowe: dysk.nowe,
    dyskusjeWToku: dysk.wToku,
    poTerminie,
    reklamacjeOtwarte: reklamacje.length,
    synchronizacjaPytan: stanSynchronizacjiPytan(),
    synchronizacjaDyskusji: stanSynchronizacjiDyskusji(),
  };
}
