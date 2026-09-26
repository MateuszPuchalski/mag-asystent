import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { mediana } from "./raporty.js";
import { logEvent } from "./events.js";
import { dataLokalna } from "../czas.js";
import { wilson, type Udzial } from "./copilot-klasyfikacja.js";
import { KATEGORIE, TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";

/* ── Pomiar tarcia w skrzynce (0.500.0) ─────────────────────────────────────
   Zgłoszenie właściciela: „jak zrobić aplikację bardziej intuicyjną”. Zmiany
   w etykietach, cofnięcia i podpowiedzi klawiszy da się ocenić tylko liczbą,
   inaczej każde wydanie wygrywa spór o wygląd samym tym, że jest nowsze.
   Trzy liczby, każda z innego pytania:

   1. COFNIĘCIA — ile wysyłek i zakończeń agent zawrócił. Cofnięcie to
      pomyłka złapana w porę: rośnie, gdy przycisk stoi w złym miejscu albo
      kłamie napisem. Maleje po dobrej zmianie układu.
   2. CZAS OD OTWARCIA ROZMOWY DO WYSYŁKI — mediana w sekundach. Mierzy
      szukanie po ekranie, nie pisanie: agent, który od razu wie, gdzie
      patrzeć, odpisuje szybciej przy tej samej treści.
   3. UDZIAŁ SZKICÓW WYSŁANYCH BEZ ZMIAN — na osobę. Tu wysoki wynik NIE jest
      dobry sam z siebie. Badania nad nadmiernym zaufaniem do automatu
      (Buçinca i in., CSCW 2021) pokazują, że ludzie przepuszczają błąd
      maszyny tym częściej, im gładszy interfejs. Osoba z udziałem blisko
      stu procent albo ma świetne szkice, albo ich nie czyta — i to pytanie
      zadaje człowiek, nie ta liczba.

   CZYSTY ODCZYT. `events` i `outbox` już stoją w bazie; otwarcie Analizy
   niczego nie zapisuje. Rozbicie na osoby to monitoring pracowniczy, więc
   czyta je wyłącznie administrator (0.431.0) — pilnuje tego trasa.

   ── Pomiary pod decyzje (26 września 2026, 0.532.0) ─────────────────────
   Właściciel chce rozstrzygać politykę skrzynki danymi, nie przekonaniem.
   Cztery pytania, każde z własną sekcją odpowiedzi:

   a. OKNO COFNIĘCIA — czy dziesięć sekund to za długo. Odpowiada rozkład
      czasu od odłożenia wysyłki do „Cofnij". Gdy prawie wszystkie cofnięcia
      padają w pierwszych sekundach, reszta okna to czekanie klienta za nic.
   b. TARCIE PRZY SZKICU — czy „Wyślij bez zmian" (0.500.0) działa. Tarcie
      staje wyłącznie przy szkicu z twierdzeniami spoza faktów, więc udział
      „bez zmian" liczy się osobno dla szkiców z takimi twierdzeniami i bez.
   c. GOTOWOŚĆ DO AUTOWYSYŁKI — dowód per klasa, nie sama wysyłka. Spec
      z 20 września chce bramki per klasa i tygodnia dowodów, więc karta
      podaje przedział Wilsona i liczbę dni z danymi, nie goły procent.
   d. POMINIĘCIA — rozmowa otwarta i zostawiona bez ruchu. Tylko licznik
      dnia i kategorii, bez człowieka i bez rozmowy (`zapiszPominiecie`).

   Żadna z tych czterech nie idzie na osobę. Wszystkie stoją w `razem`
   i czyta je biuro; `osoby` zostaje takie, jak było. */

export interface LiczbyTarcia {
  wyslanych: number;
  /** Wysyłki, przy których stał szkic Copilota na tę samą wiadomość klienta. */
  zeSzkicem: number;
  bezZmian: number;
  /** `bezZmian / zeSzkicem`; `null` bez próbki. */
  udzialBezZmian: number | null;
  cofnietychWysylek: number;
  cofnietychZakonczen: number;
  /** Mediana w sekundach od otwarcia rozmowy do wysyłki; `null` bez próbki. */
  medianaSekDoWysylki: number | null;
  probekCzasu: number;
}

/** Szkice wysłane: ile ich było i ile poszło nietkniętych. */
export interface LosSzkicow { zeSzkicem: number; bezZmian: number; udzialBezZmian: number | null }

/** (a) Okno cofnięcia — rozkład czasu od odłożenia wysyłki do „Cofnij". */
export interface OknoCofniecia {
  /** Wysyłki odłożone w oknie: wysłane plus cofnięte. */
  odlozonych: number;
  cofnietych: number;
  /** `cofnietych / odlozonych`; `null` bez próbki. */
  udzial: number | null;
  /** Kubełki po dwie sekundy, od 0 do 10 s. Górna granica ostatniego włącznie. */
  kubelki: Array<{ odSek: number; doSek: number; ile: number }>;
  /** Cofnięcia później niż 10 s — dziś niemożliwe; niezerowe znaczy zmienione okno. */
  poOknie: number;
  /** Cofnięcia sprzed pomiaru czasu (bez `msOdKolejki`) — w udziale, nie w rozkładzie. */
  bezCzasu: number;
  /**
   * Odczyt jednym zdaniem: najkrótsza granica kubełka, przed którą padło co
   * najmniej 90% zmierzonych cofnięć — albo 10 s z prawdziwym udziałem, gdy
   * tylu nie padło przed żadną. `null` bez próbki.
   */
  odczyt: { przedSek: number; udzial: number } | null;
}

/** (b) Tarcie przy szkicu — udział „bez zmian" wg twierdzeń do sprawdzenia. */
export interface TarcieSzkicu {
  /** Szkic z co najmniej jednym twierdzeniem spoza faktów — tu stoi tarcie. */
  zTwierdzeniami: LosSzkicow;
  bezTwierdzen: LosSzkicow;
  /** Szkice wysłane przed zapisem tego faktu przy wysyłce — nie wiemy, które to. */
  bezDanych: number;
  /**
   * Przed i po 0.500.0, z całej historii, nie z okna. Granica to pierwsza
   * wysyłka z pomiarem czasu od otwarcia — ten pomiar wszedł razem z tarciem.
   * `null`, gdy po którejś stronie granicy nie ma ani jednego szkicu.
   */
  przedPo: { granica: string; przed: LosSzkicow; po: LosSzkicow } | null;
}

/** (c) Dowód per klasa: udział bez zmian z przedziałem i dniami z danymi. */
export interface GotowoscKlasy {
  kategoria: string;
  zeSzkicem: number;
  bezZmian: number;
  udzial: Udzial | null;
  /** Dni lokalne, w których ta klasa miała choć jedną wysyłkę ze szkicem. */
  dni: number;
}

/** (d) Pominięcia — sam licznik, obok wysyłek z tego samego dnia i klasy. */
export interface Pominiecia {
  /**
   * Pierwsza doba z jakimkolwiek zgłoszeniem, z całej historii; `null` —
   * skrzynka nie zgłosiła jeszcze ani jednego. Zero pominięć w oknie znaczy
   * co innego, gdy licznik nigdy nie ruszył, i karta ma to powiedzieć.
   */
  odKiedy: string | null;
  pominiec: number;
  wyslanych: number;
  wgDnia: Array<{ dzien: string; pominiec: number; wyslanych: number }>;
  wgKategorii: Array<{ kategoria: string; pominiec: number; wyslanych: number }>;
}

export interface PomiarTarcia {
  dni: number;
  razem: LiczbyTarcia;
  /** `null`, gdy czytający nie jest administratorem. */
  osoby: Array<LiczbyTarcia & { osoba: string }> | null;
  oknoCofniecia: OknoCofniecia;
  tarcieSzkicu: TarcieSzkicu;
  gotowosc: GotowoscKlasy[];
  pominiecia: Pominiecia;
}

const pusty = (): LiczbyTarcia => ({
  wyslanych: 0, zeSzkicem: 0, bezZmian: 0, udzialBezZmian: null,
  cofnietychWysylek: 0, cofnietychZakonczen: 0, medianaSekDoWysylki: null, probekCzasu: 0,
});

const udzial = (k: number, n: number) => (n > 0 ? Number((k / n).toFixed(2)) : null);
const los = (zeSzkicem: number, bezZmian: number): LosSzkicow =>
  ({ zeSzkicem, bezZmian, udzialBezZmian: udzial(bezZmian, zeSzkicem) });

/** Klasa bez decyzji klasyfikatora — ta sama etykieta co w czasie odpowiedzi. */
export const BEZ_ROZPOZNANIA = "bez rozpoznania";
/** Decyzja klasyfikatora ze statusem FAILED — też etykieta z czasu odpowiedzi. */
export const NIEROZPOZNANE = "nierozpoznane";

/** Granice kubełków okna cofnięcia w sekundach; okno panelu ma 10 s (`OKNO_COFNIECIA_MS`). */
const GRANICE_OKNA = [2, 4, 6, 8, 10] as const;

/**
 * Rozkład czasu cofnięć i odczyt jednym zdaniem. Czysta funkcja.
 *
 * PRÓG 90%, nie mediana. Mediana mówi o typowym cofnięciu, a decyzja
 * o skróceniu okna dotyczy OGONA: ile pomyłek przepadłoby przy krótszym.
 * Przy progu dziewięciu na dziesięć z dziesięciu cofnięć przepada najwyżej
 * jedno — a ekran podaje prawdziwy udział obok granicy.
 */
export function rozkladCofniec(czasyMs: number[]): Pick<OknoCofniecia, "kubelki" | "poOknie" | "odczyt"> {
  const kubelki = GRANICE_OKNA.map((doSek, i) => ({ odSek: i === 0 ? 0 : GRANICE_OKNA[i - 1]!, doSek, ile: 0 }));
  let poOknie = 0;
  for (const ms of czasyMs) {
    if (ms > 10_000) { poOknie++; continue; }
    /* Dokładnie 2000 ms idzie do „2–4 s": granica należy do kubełka wyżej,
       jak w każdym „przed 2 s". Tylko ostatni domyka 10 s włącznie. */
    const i = Math.min(GRANICE_OKNA.length - 1, Math.floor(ms / 2000));
    kubelki[i]!.ile++;
  }
  const n = czasyMs.length;
  let odczyt: OknoCofniecia["odczyt"] = null;
  if (n > 0) {
    for (const g of GRANICE_OKNA) {
      const przed = czasyMs.filter((ms) => (g === 10 ? ms <= 10_000 : ms < g * 1000)).length;
      odczyt = { przedSek: g, udzial: Number((przed / n).toFixed(2)) };
      /* Bez progu przy żadnej granicy zostaje ostatnia, 10 s, z prawdziwym
         udziałem. Tak bywa po wydłużeniu okna: zdanie „60% cofnięć przed
         10 s" jest wtedy prawdą, a „brak pomiarów" byłoby kłamstwem. */
      if (przed / n >= 0.9) break;
    }
  }
  return { kubelki, poOknie, odczyt };
}

/**
 * Klasa każdej wysyłki: ostatnia aktywna decyzja klasyfikatora na wiadomość
 * klienta nie późniejszą niż ta, na którą szła odpowiedź.
 *
 * Z DECYZJI, NIE Z PAYLOADU. `decyzja_klasyfikacji` trzyma historię wersji
 * i nie jest nadpisywana jak szkic, więc klasę da się odtworzyć po fakcie —
 * także dla wysyłek sprzed tego pomiaru. Kolejność po czasie wiadomości,
 * przy remisie po `id`, jak w `wysylka.ts` (blizna z 23 września 2026).
 */
function klasyWysylek(
  database: DatabaseSync, od: string,
  wysylki: Array<{ id: number; conversation_id: number; expected_last_message_id: number | null;
    pytanie_at: string | null }>,
): Map<number, string> {
  const wynik = new Map<number, string>();
  if (wysylki.length === 0) return wynik;
  /* Decyzje TYLKO rozmów z wysyłką w oknie. Cała historia decyzji przy
     każdym otwarciu Analizy blokowałaby synchroniczny wątek bazy za nic. */
  const decyzje = new Map<number, Array<{ at: string; id: number; kat: string }>>();
  for (const d of database.prepare(`SELECT d.conversation_id, d.message_id, d.kategoria, d.status, m.sent_at
      FROM decyzja_klasyfikacji d JOIN message m ON m.id = d.message_id
      WHERE d.aktywna=1 AND d.taksonomia_wersja=? AND d.conversation_id IN
        (SELECT conversation_id FROM outbox WHERE status='sent' AND finished_at >= ?)`)
      .all(TAKSONOMIA_WERSJA, od) as
      Array<{ conversation_id: number; message_id: number; kategoria: string; status: string; sent_at: string }>) {
    const lista = decyzje.get(d.conversation_id) ?? [];
    lista.push({ at: d.sent_at, id: d.message_id, kat: d.status === "FAILED" ? NIEROZPOZNANE : d.kategoria });
    decyzje.set(d.conversation_id, lista);
  }
  for (const w of wysylki) {
    const lista = decyzje.get(w.conversation_id);
    const ostatnia = w.expected_last_message_id;
    if (!lista || ostatnia === null) { wynik.set(w.id, BEZ_ROZPOZNANIA); continue; }
    const at = w.pytanie_at;
    const pasujace = lista.filter((d) => (at === null
      ? d.id <= ostatnia : d.at < at || (d.at === at && d.id <= ostatnia)))
      .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    wynik.set(w.id, pasujace.at(-1)?.kat ?? BEZ_ROZPOZNANIA);
  }
  return wynik;
}

export function pomiarTarcia(
  dni: number, zLudzmi: boolean, database: DatabaseSync = defaultDb(), teraz = Date.now(),
): PomiarTarcia {
  const od = new Date(teraz - dni * 86_400_000).toISOString();
  const osoby = new Map<string, LiczbyTarcia>();
  const czasy = new Map<string, number[]>();
  const dla = (kto: string) => {
    if (!osoby.has(kto)) osoby.set(kto, pusty());
    return osoby.get(kto)!;
  };

  /* Wysyłki i los szkicu z `outbox` — tam stoi prawda o tym, co poszło do
     klienta. Dziennik zdarzeń zna tylko próbę i wynik, nie treść szkicu. */
  const wys = database.prepare(`SELECT COALESCE(u.name, '—') AS osoba, COUNT(*) AS n,
      SUM(o.szkic_los IS NOT NULL) AS zeSzkicem, SUM(o.szkic_los='bez_zmian') AS bez
    FROM outbox o LEFT JOIN app_user u ON u.user_id=o.created_by
    WHERE o.status='sent' AND o.finished_at >= ? GROUP BY osoba`).all(od) as
    Array<{ osoba: string; n: number; zeSzkicem: number | null; bez: number | null }>;
  for (const w of wys) {
    const o = dla(w.osoba);
    o.wyslanych = Number(w.n);
    o.zeSzkicem = Number(w.zeSzkicem ?? 0);
    o.bezZmian = Number(w.bez ?? 0);
  }

  /* Cofnięcia i czas do wysyłki z dziennika. Zakończenie cofnięte to
     otwarcie rozmowy z paska „Cofnij", nie każde „Otwórz ponownie" — tamto
     bywa decyzją po dniach, nie pomyłką sprzed sekund. */
  const zd = database.prepare(`SELECT type, user_id AS osoba, payload FROM events
    WHERE created_at >= ? AND type IN ('rozmowa_wysylka_cofnieta','rozmowa_zakonczenie_cofniete','rozmowa_wyslana')`)
    .all(od) as Array<{ type: string; osoba: string | null; payload: string | null }>;
  const czasyCofniec: number[] = [];
  let cofnietychBezCzasu = 0;
  /* Twierdzenia do sprawdzenia przy wysyłce, po numerze wiersza `outbox`. */
  const twierdzenia = new Map<number, number>();
  for (const z of zd) {
    const kto = z.osoba ?? "—";
    const p = JSON.parse(z.payload ?? "null") as Record<string, unknown> | null;
    if (z.type === "rozmowa_wysylka_cofnieta") {
      dla(kto).cofnietychWysylek++;
      if (typeof p?.msOdKolejki === "number") czasyCofniec.push(p.msOdKolejki);
      else cofnietychBezCzasu++;
    } else if (z.type === "rozmowa_zakonczenie_cofniete") dla(kto).cofnietychZakonczen++;
    else {
      const ms = p?.msOdOtwarcia;
      if (typeof ms === "number") czasy.set(kto, [...(czasy.get(kto) ?? []), ms / 1000]);
      if (typeof p?.outboxId === "number" && typeof p.szkicDoSprawdzenia === "number") {
        twierdzenia.set(p.outboxId, p.szkicDoSprawdzenia);
      }
    }
  }

  const domknij = (l: LiczbyTarcia, sek: number[]): LiczbyTarcia => {
    const m = mediana(sek);
    return { ...l, probekCzasu: sek.length, medianaSekDoWysylki: m === null ? null : Math.round(m),
      udzialBezZmian: udzial(l.bezZmian, l.zeSzkicem) };
  };
  const razem = [...osoby.values()].reduce((a, b) => ({
    ...a, wyslanych: a.wyslanych + b.wyslanych, zeSzkicem: a.zeSzkicem + b.zeSzkicem,
    bezZmian: a.bezZmian + b.bezZmian, cofnietychWysylek: a.cofnietychWysylek + b.cofnietychWysylek,
    cofnietychZakonczen: a.cofnietychZakonczen + b.cofnietychZakonczen,
  }), pusty());

  /* ── (a) Okno cofnięcia ───────────────────────────────────────────────────
     Mianownik to wysyłki ODŁOŻONE: wysłane plus cofnięte. Próba nieudana
     w Allegro nie wchodzi — jest rzadka, a jej los nie mówi nic o oknie. */
  const odlozonych = razem.wyslanych + razem.cofnietychWysylek;
  const oknoCofniecia: OknoCofniecia = {
    odlozonych, cofnietych: razem.cofnietychWysylek, udzial: udzial(razem.cofnietychWysylek, odlozonych),
    bezCzasu: cofnietychBezCzasu, ...rozkladCofniec(czasyCofniec),
  };

  /* ── (b), (c), (d): wysyłki pojedynczo, z klasą i dniem ─────────────────── */
  const wiersze = database.prepare(`SELECT o.id, o.conversation_id, o.expected_last_message_id, o.szkic_los,
      o.finished_at, m.sent_at AS pytanie_at
    FROM outbox o LEFT JOIN message m ON m.id = o.expected_last_message_id
    WHERE o.status='sent' AND o.finished_at >= ?`).all(od) as
    Array<{ id: number; conversation_id: number; expected_last_message_id: number | null;
      szkic_los: string | null; finished_at: string; pytanie_at: string | null }>;
  const klasy = klasyWysylek(database, od, wiersze);

  const zT = { n: 0, bez: 0 };
  const bezT = { n: 0, bez: 0 };
  let bezDanych = 0;
  const wgKlasy = new Map<string, { n: number; bez: number; dni: Set<string> }>();
  const wyslanychDnia = new Map<string, number>();
  const wyslanychKlasy = new Map<string, number>();
  for (const w of wiersze) {
    const dzien = dataLokalna(w.finished_at);
    const kat = klasy.get(w.id) ?? BEZ_ROZPOZNANIA;
    wyslanychDnia.set(dzien, (wyslanychDnia.get(dzien) ?? 0) + 1);
    wyslanychKlasy.set(kat, (wyslanychKlasy.get(kat) ?? 0) + 1);
    if (w.szkic_los === null) continue;
    const bez = w.szkic_los === "bez_zmian";
    const t = twierdzenia.get(w.id);
    if (t === undefined) bezDanych++;
    else {
      const g = t > 0 ? zT : bezT;
      g.n++;
      if (bez) g.bez++;
    }
    const k = wgKlasy.get(kat) ?? { n: 0, bez: 0, dni: new Set<string>() };
    k.n++;
    if (bez) k.bez++;
    k.dni.add(dzien);
    wgKlasy.set(kat, k);
  }

  const tarcieSzkicu: TarcieSzkicu = {
    zTwierdzeniami: los(zT.n, zT.bez), bezTwierdzen: los(bezT.n, bezT.bez), bezDanych,
    przedPo: przedIPo(database),
  };

  /* Najmocniejszy dowód pierwszy: po DOLNEJ granicy przedziału, nie po
     procencie. Trzy z trzech to 100%, ale dolna granica 44% — i właśnie
     tyle ta klasa wtedy udowodniła. */
  const gotowosc: GotowoscKlasy[] = [...wgKlasy.entries()].map(([kategoria, k]) => ({
    kategoria, zeSzkicem: k.n, bezZmian: k.bez, udzial: wilson(k.bez, k.n), dni: k.dni.size,
  })).sort((a, b) => (b.udzial?.dolna ?? 0) - (a.udzial?.dolna ?? 0) || b.zeSzkicem - a.zeSzkicem
    || a.kategoria.localeCompare(b.kategoria));

  /* ── (d) Pominięcia ──────────────────────────────────────────────────────
     Doba lokalna magazynu, bo licznik zapisuje się po niej (`zapiszPominiecie`). */
  const pom = database.prepare("SELECT dzien, kategoria, ile FROM pominiecia_dzien WHERE dzien >= ?")
    .all(dataLokalna(od)) as Array<{ dzien: string; kategoria: string; ile: number }>;
  const pomDnia = new Map<string, number>();
  const pomKlasy = new Map<string, number>();
  for (const p of pom) {
    pomDnia.set(p.dzien, (pomDnia.get(p.dzien) ?? 0) + Number(p.ile));
    pomKlasy.set(p.kategoria, (pomKlasy.get(p.kategoria) ?? 0) + Number(p.ile));
  }
  const pierwsza = database.prepare("SELECT MIN(dzien) AS d FROM pominiecia_dzien").get() as { d: string | null };
  const pominiecia: Pominiecia = {
    odKiedy: pierwsza.d,
    pominiec: [...pomDnia.values()].reduce((a, b) => a + b, 0),
    wyslanych: wiersze.length,
    wgDnia: [...new Set([...pomDnia.keys(), ...wyslanychDnia.keys()])].sort()
      .map((dzien) => ({ dzien, pominiec: pomDnia.get(dzien) ?? 0, wyslanych: wyslanychDnia.get(dzien) ?? 0 })),
    wgKategorii: [...new Set([...pomKlasy.keys(), ...wyslanychKlasy.keys()])]
      .map((kategoria) => ({ kategoria, pominiec: pomKlasy.get(kategoria) ?? 0,
        wyslanych: wyslanychKlasy.get(kategoria) ?? 0 }))
      .sort((a, b) => b.pominiec - a.pominiec || b.wyslanych - a.wyslanych
        || a.kategoria.localeCompare(b.kategoria)),
  };

  return {
    dni,
    razem: domknij(razem, [...czasy.values()].flat()),
    osoby: zLudzmi
      ? [...osoby.entries()].map(([osoba, l]) => ({ osoba, ...domknij(l, czasy.get(osoba) ?? []) }))
        .sort((a, b) => b.wyslanych - a.wyslanych || a.osoba.localeCompare(b.osoba))
      : null,
    oknoCofniecia, tarcieSzkicu, gotowosc, pominiecia,
  };
}

/**
 * Udział szkiców bez zmian przed i po 0.500.0 — z całej historii.
 *
 * GRANICĄ JEST DANA, NIE DATA W KODZIE. Serwer biura aktualizuje się, kiedy
 * chce właściciel, więc 25 września 2026 nie musi być dniem wejścia tarcia.
 * Pomiar czasu od otwarcia (`msOdOtwarcia`) wszedł tym samym wydaniem co
 * tarcie, więc pierwsza wysyłka, która go niesie, wyznacza granicę tutaj.
 *
 * Porównanie mierzy CAŁE wydanie 0.500.0, nie samo tarcie: to samo wydanie
 * zmieniło napisy przycisków, a 0.499.0 dzień wcześniej wstawiło szkic do
 * pola. Karta mówi to przy liczbie. Twierdzeń sprzed 0.532.0 nie znamy,
 * więc rozbicia „z twierdzeniami" przed granicą nie ma i być nie może.
 */
function przedIPo(database: DatabaseSync): TarcieSzkicu["przedPo"] {
  /* Dolna data to tylko skrót skanu: 0.500.0 wyszło 25 września 2026,
     więc wcześniej żadna wysyłka nie mogła nieść pomiaru czasu. */
  const pierwsze = database.prepare(`SELECT created_at, payload FROM events
    WHERE type='rozmowa_wyslana' AND created_at >= '2026-09-25' AND payload LIKE '%"msOdOtwarcia":%'
    ORDER BY created_at, id LIMIT 1`).get() as { created_at: string; payload: string } | undefined;
  if (!pierwsze) return null;
  /* Granica z `outbox.finished_at` tej samej wysyłki, nie z chwili zdarzenia.
     Zdarzenie zapisuje się PO wierszu `outbox`, więc porównanie z nim
     wrzucałoby pierwszą wysyłkę z tarciem do „przed". */
  const outboxId = (JSON.parse(pierwsze.payload) as { outboxId?: unknown }).outboxId;
  const wiersz = typeof outboxId === "number"
    ? database.prepare("SELECT finished_at FROM outbox WHERE id=?").get(outboxId) as { finished_at: string | null } | undefined
    : undefined;
  const g = { at: wiersz?.finished_at ?? pierwsze.created_at };
  const r = database.prepare(`SELECT
      SUM(finished_at < ?) AS przedN, SUM(finished_at < ? AND szkic_los='bez_zmian') AS przedBez,
      SUM(finished_at >= ?) AS poN, SUM(finished_at >= ? AND szkic_los='bez_zmian') AS poBez
    FROM outbox WHERE status='sent' AND szkic_los IS NOT NULL`).get(g.at, g.at, g.at, g.at) as
    Record<string, number | null>;
  const przed = los(Number(r.przedN ?? 0), Number(r.przedBez ?? 0));
  const po = los(Number(r.poN ?? 0), Number(r.poBez ?? 0));
  if (przed.zeSzkicem === 0 || po.zeSzkicem === 0) return null;
  return { granica: g.at, przed, po };
}

/**
 * Czas od otwarcia rozmowy do wysyłki, jak podał panel — przycięty.
 * Liczba z przeglądarki jest niezaufana: ujemna, nieskończona albo dłuższa
 * niż dzień pracy znaczy kartę zostawioną na noc, nie szukanie po ekranie.
 */
export function czasDoWysylki(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 8 * 3_600_000) return null;
  return Math.round(v);
}

/**
 * Czas od odłożenia wysyłki do „Cofnij", jak podał panel — przycięty.
 * Sufit minuty, nie dziesięciu sekund: okno może się zmienić decyzją
 * właściciela, a pomiar ma przeżyć tę zmianę. Dłużej niż minuta to zegar
 * karty uśpionej w tle, nie czas człowieka — taka liczba odpada.
 */
export function czasCofniecia(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 60_000) return null;
  return Math.round(v);
}

/**
 * Agent zawrócił odpowiedź w oknie „Cofnij" (0.500.0). Czekanie mieszka
 * w przeglądarce (`skrzynka/Odlozone.tsx`), więc bez tego wpisu serwer
 * nigdy by się o cofnięciu nie dowiedział. To jedyny zapis tej ścieżki.
 * Od 0.532.0 wpis niesie też czas cofnięcia — pytanie (a) w nagłówku.
 */
export function zapiszCofniecieWysylki(
  database: DatabaseSync, conversationId: number, autor: { id: number; name: string },
  msOdKolejki: number | null = null,
): boolean {
  const jest = database.prepare("SELECT 1 FROM conversation WHERE id=?").get(conversationId);
  if (!jest) return false;
  logEvent("rozmowa_wysylka_cofnieta", autor.name, null,
    { conversationId, ...(msOdKolejki !== null ? { msOdKolejki } : {}) }, autor.id, database);
  return true;
}

/**
 * Pominięcie: agent otworzył rozmowę i wyszedł bez wysyłki, zakończenia,
 * odłożenia i notatki (pytanie (d) w nagłówku). Sam licznik doby i klasy.
 *
 * BEZ `logEvent` — ŚWIADOMY WYJĄTEK OD „KAŻDA MUTACJA WOŁA logEvent".
 * Wiersz `events` niesie autora i chwilę co do milisekundy. Pominięcie
 * z autorem to lista „kto ile razy odpuścił", czyli monitoring pracowniczy
 * (art. 22² Kodeksu pracy), którego to pytanie nie potrzebuje. Nawet wpis
 * bez autora zdradza człowieka: jego chwila zestawiona z otwarciem rozmowy
 * w dzienniku wskazuje go wprost. Prawo pracownika bije tu regułę audytu.
 *
 * Z tego samego powodu nie ma tu rozmowy: po jej numerze i dobie da się
 * odtworzyć, kto ją miał otwartą. Klasa spoza słownika to „bez
 * rozpoznania" — tekst z przeglądarki nie staje się kluczem w bazie.
 */
export function zapiszPominiecie(database: DatabaseSync, kategoria: unknown, teraz = new Date()): void {
  /* „nierozpoznane" wchodzi obok słownika, bo tak liczą się wysyłki do
     rozmów z nieudaną klasyfikacją — inaczej wiersz kategorii porównywałby
     pominięcia jednej grupy z wysyłkami drugiej. */
  const kat = typeof kategoria === "string"
    && ([...KATEGORIE, NIEROZPOZNANE] as readonly string[]).includes(kategoria) ? kategoria : BEZ_ROZPOZNANIA;
  database.prepare(`INSERT INTO pominiecia_dzien(dzien, kategoria, ile) VALUES (?,?,1)
    ON CONFLICT(dzien, kategoria) DO UPDATE SET ile = ile + 1`).run(dataLokalna(teraz.toISOString()), kat);
}
