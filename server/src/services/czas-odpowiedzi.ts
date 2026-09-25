import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { mediana } from "./raporty.js";
import { TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";
import { klientPodziekowal } from "./conversations.js";

/* ── Czas odpowiedzi klientowi (23 września 2026) ────────────────────────────
   Zgłoszenie właściciela: „how we can improve the ui/ux even further". Dwa
   wydania z rzędu przebudowały skrzynkę bez jednej liczby, która powie, czy
   agent odpisuje szybciej. Zakres „Obsługa klienta" w Analizie stał pusty,
   bo — jak pisze `ekrany/Analiza.tsx` — nie było dla niego źródła danych.

   ŹRÓDŁEM SĄ WIADOMOŚCI, KTÓRE I TAK STOJĄ W BAZIE. Nic tu nie zapisuje
   zdarzeń ani znaczników czasu: odczyt liczy się z `message`, `outbox`
   i `decyzja_klasyfikacji`. Otwarcie Analizy dalej niczego nie mutuje.

   CO JEST PRÓBKĄ. Czekanie klienta zaczyna PIERWSZA jego wiadomość po naszej
   ostatniej odpowiedzi, a kończy NASZA następna prawdziwa odpowiedź.
   Autoodpowiedź „Dziękujemy za kontakt" nie kończy czekania (blizna 0.227.0):
   liczona jako odpowiedź dawałaby medianę kilku sekund i fałszywy spokój.
   Klient, który pisze trzy razy przed odpowiedzią, czeka od pierwszej
   wiadomości, nie od trzeciej — tak to czuje po swojej stronie.

   KATEGORIA to aktywna decyzja klasyfikatora dla wiadomości z tego okna
   czekania, najnowsza. Rozpoznanie nieudane i brak rozpoznania mają własne
   wiersze: sklejone z „Inne" udawałyby, że model coś orzekł.

   OSOBA to autor wysyłki z `outbox`. Odpowiedź wysłana z panelu Allegro nie
   ma go wcale i dostaje wiersz „z Allegro" — ukrycie jej zaniżyłoby czas
   tych, którzy odpisują poza WERTIS. Rozbicie na osoby czyta WYŁĄCZNIE
   administrator (0.431.0, decyzja właściciela) — pilnuje tego trasa. */

export interface WierszCzasu {
  klucz: string;
  n: number;
  /** Mediana w minutach; `null` bez próbki. */
  medianaMin: number | null;
}

/* ── BEZ PONOWNEGO PYTANIA (24 września 2026) ────────────────────────────────
   Zgłoszenie właściciela po rozmowie o metodzie Feynmana: „build it”. Czas
   odpowiedzi mierzy SZYBKOŚĆ i nagradza szybką złą odpowiedź tak samo jak
   szybką dobrą. Ta liczba mierzy SKUTEK: czy klient po naszej odpowiedzi
   musiał pisać jeszcze raz.

   REGUŁA, jedna i sprawdzalna. Po każdej naszej prawdziwej odpowiedzi
   patrzymy siedem dni naprzód w TEJ rozmowie. Wiadomość klienta inna niż
   podziękowanie znaczy „wrócił”. Podziękowanie rozpoznaje ta sama reguła,
   która zdejmuje je z kolejki (`klientPodziekowal`), a nie nowy filtr.

   CZEGO NIE UDAJEMY. Wiadomość bez rozpoznania liczy się jako powrót, bo
   nie wiemy, że to podziękowanie. Ile takich było, mówi osobna liczba, żeby
   nikt nie czytał wyniku jako czystszego, niż jest. Odpowiedź młodsza niż
   siedem dni bez powrotu klienta jeszcze nie ma wyniku i do udziału nie
   wchodzi. Powrót przez dyskusję albo reklamację liczy osobno miara
   eskalacji (S5), nie ta. */

/** Ile dni po odpowiedzi czekamy na powrót klienta. */
export const OKNO_POWROTU_DNI = 7;

export type LosOdpowiedzi = "bez_powrotu" | "wrocil" | "czeka";

export interface WierszPowrotu {
  klucz: string;
  /** Odpowiedzi z wynikiem (bez tych, które jeszcze czekają). */
  n: number;
  bezPowrotu: number;
}

export interface Powroty {
  oknoDni: number;
  /** Odpowiedzi z wynikiem. */
  n: number;
  bezPowrotu: number;
  wrocilo: number;
  /** Z tego: powrót, którego nikt nie rozpoznał — mógł być podziękowaniem. */
  wrociloBezRozpoznania: number;
  /** Odpowiedzi młodsze niż okno, po których klient jeszcze nie wrócił. */
  czeka: number;
  wgKategorii: WierszPowrotu[];
  wgOsoby: WierszPowrotu[] | null;
}

export interface CzasOdpowiedzi {
  dni: number;
  /** Najświeższa odpowiedź w oknie — „dane do", nie zegar serwera. */
  daneDo: string | null;
  ogolem: { n: number; medianaMin: number | null; p90Min: number | null };
  wgKategorii: WierszCzasu[];
  /** `null`, gdy czytający nie jest administratorem. */
  wgOsoby: WierszCzasu[] | null;
  /** Rozmowy, w których klient czeka TERAZ, i najdłuższe z tych czekań. */
  czekaTeraz: { n: number; najdluzejMin: number | null };
  powroty: Powroty;
}

interface Wiadomosc {
  id: number; conversation_id: number; direction: string;
  auto_odpowiedz: number; sent_at: string; external_message_id: string;
}

interface Probka {
  rozmowa: number; odId: number; doId: number; minuty: number; at: string; zewnetrzny: string;
}

const minuty = (od: string, doChwili: string) =>
  Math.max(0, (Date.parse(doChwili) - Date.parse(od)) / 60_000);

/** Dziewięćdziesiąty percentyl metodą najbliższej rangi; `null` bez próbki. */
export function p90(liczby: number[]): number | null {
  if (liczby.length === 0) return null;
  const s = [...liczby].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

const zaokragl = (x: number | null) => (x === null ? null : Math.round(x));

/**
 * Próbki czekania z listy wiadomości JEDNEJ rozmowy, w kolejności czasu (`sent_at`, remis po `id`).
 * Czysta funkcja — reguła próbki ma jeden zapis i jeden test.
 */
export function probkiRozmowy(wiadomosci: Wiadomosc[]): { probki: Probka[]; czekaOd: string | null } {
  const probki: Probka[] = [];
  let od: { at: string; id: number } | null = null;
  for (const w of wiadomosci) {
    if (w.direction === "incoming") {
      if (!od) od = { at: w.sent_at, id: w.id };
    } else if (!Number(w.auto_odpowiedz) && od) {
      probki.push({ rozmowa: w.conversation_id, odId: od.id, doId: w.id,
        minuty: minuty(od.at, w.sent_at), at: w.sent_at, zewnetrzny: w.external_message_id });
      od = null;
    }
  }
  return { probki, czekaOd: od?.at ?? null };
}

/** Decyzja klasyfikatora o JEDNEJ wiadomości, w polach reguły podziękowania. */
export interface DecyzjaWiadomosci {
  kategoria: string; akcja: string; status: string;
  pewnosc: string | null; wymagaCzlowieka: boolean;
}

/**
 * Los jednej odpowiedzi: czy klient wrócił w ciągu okna.
 *
 * Czysta funkcja, jak `probkiRozmowy`. Przechodzi WSZYSTKIE wiadomości
 * klienta w oknie, nie tylko pierwszą: „dziękuję”, a godzinę później
 * „a jeszcze jedno” to powrót.
 */
export function losOdpowiedzi(
  wiadomosci: Wiadomosc[], odpowiedz: { doId: number; at: string },
  decyzja: (messageId: number) => DecyzjaWiadomosci | null, teraz: number,
  oknoDni = OKNO_POWROTU_DNI,
): { los: LosOdpowiedzi; bezRozpoznania: boolean } {
  const koniec = Date.parse(odpowiedz.at) + oknoDni * 86_400_000;
  let po = false;
  for (const w of wiadomosci) {
    if (w.id === odpowiedz.doId) { po = true; continue; }
    if (!po || w.direction !== "incoming") continue;
    if (Date.parse(w.sent_at) > koniec) break;
    const d = decyzja(w.id);
    if (d && klientPodziekowal({ ...d, nieaktualna: false }, true)) continue;
    return { los: "wrocil", bezRozpoznania: d === null };
  }
  return { los: teraz >= koniec ? "bez_powrotu" : "czeka", bezRozpoznania: false };
}

function wierszePowrotu(grupy: Map<string, { n: number; bez: number }>): WierszPowrotu[] {
  return [...grupy.entries()]
    .map(([klucz, g]) => ({ klucz, n: g.n, bezPowrotu: g.bez }))
    .sort((a, b) => b.n - a.n || a.klucz.localeCompare(b.klucz));
}

function wiersze(grupy: Map<string, number[]>): WierszCzasu[] {
  return [...grupy.entries()]
    .map(([klucz, m]) => ({ klucz, n: m.length, medianaMin: zaokragl(mediana(m)) }))
    .sort((a, b) => b.n - a.n || a.klucz.localeCompare(b.klucz));
}

export function czasOdpowiedzi(
  dni: number, zLudzmi: boolean, database: DatabaseSync = defaultDb(), teraz = Date.now(),
): CzasOdpowiedzi {
  const start = new Date(teraz - dni * 86_400_000).toISOString();
  /* Tydzień zapasu wstecz: czekanie zaczęte przed oknem, a zakończone w nim,
     jest próbką TEGO okna. Bez zapasu takie czekanie byłoby liczone od
     pierwszej wiadomości w oknie, czyli krócej, niż trwało naprawdę. */
  const zapas = new Date(teraz - (dni + 7) * 86_400_000).toISOString();
  const wiadomosci = database.prepare(`SELECT id, conversation_id, direction, auto_odpowiedz,
      sent_at, external_message_id FROM message
     WHERE conversation_id IN (SELECT DISTINCT conversation_id FROM message WHERE sent_at >= ?)
       AND sent_at >= ?
     ORDER BY conversation_id, sent_at, id`).all(start, zapas) as unknown as Wiadomosc[];

  const wgRozmowy = new Map<number, Wiadomosc[]>();
  for (const w of wiadomosci) {
    const lista = wgRozmowy.get(w.conversation_id) ?? [];
    lista.push(w);
    wgRozmowy.set(w.conversation_id, lista);
  }

  const probki: Probka[] = [];
  const czekajace: number[] = [];
  for (const lista of wgRozmowy.values()) {
    const r = probkiRozmowy(lista);
    probki.push(...r.probki.filter((p) => p.at >= start));
    if (r.czekaOd) czekajace.push(minuty(r.czekaOd, new Date(teraz).toISOString()));
  }

  /* Decyzje aktywne w bieżącym słowniku, po rozmowie, rosnąco po wiadomości. */
  type Decyzja = { message_id: number; kategoria: string; status: string; akcja: string;
    pewnosc: string | null; wymaga: number };
  const decyzje = new Map<number, Decyzja[]>();
  const poWiadomosci = new Map<number, DecyzjaWiadomosci>();
  for (const d of database.prepare(`SELECT conversation_id, message_id, kategoria, status,
      akcja, pewnosc, wymaga_czlowieka AS wymaga
      FROM decyzja_klasyfikacji WHERE aktywna=1 AND taksonomia_wersja=?
      ORDER BY conversation_id, message_id`).all(TAKSONOMIA_WERSJA) as
      Array<Decyzja & { conversation_id: number }>) {
    const lista = decyzje.get(d.conversation_id) ?? [];
    lista.push(d);
    decyzje.set(d.conversation_id, lista);
    poWiadomosci.set(d.message_id, { kategoria: d.kategoria, akcja: d.akcja, status: d.status,
      pewnosc: d.pewnosc ?? null, wymagaCzlowieka: Boolean(Number(d.wymaga)) });
  }

  const autorzy = new Map<string, string>();
  if (zLudzmi) {
    for (const a of database.prepare(`SELECT o.conversation_id, o.external_message_id, u.name
        FROM outbox o JOIN app_user u ON u.user_id = o.created_by
       WHERE o.status='sent' AND o.external_message_id IS NOT NULL AND o.created_at >= ?`)
      .all(zapas) as Array<{ conversation_id: number; external_message_id: string; name: string }>) {
      autorzy.set(`${a.conversation_id}|${a.external_message_id}`, a.name);
    }
  }

  const wgKategorii = new Map<string, number[]>();
  const wgOsoby = new Map<string, number[]>();
  const powroty: Powroty = { oknoDni: OKNO_POWROTU_DNI, n: 0, bezPowrotu: 0, wrocilo: 0,
    wrociloBezRozpoznania: 0, czeka: 0, wgKategorii: [], wgOsoby: null };
  const powrotyKat = new Map<string, { n: number; bez: number }>();
  const powrotyOsoby = new Map<string, { n: number; bez: number }>();
  const dolicz = (m: Map<string, { n: number; bez: number }>, k: string, bez: boolean) => {
    const g = m.get(k) ?? { n: 0, bez: 0 };
    g.n += 1;
    if (bez) g.bez += 1;
    m.set(k, g);
  };
  for (const p of probki) {
    const d = (decyzje.get(p.rozmowa) ?? [])
      .filter((x) => x.message_id >= p.odId && x.message_id < p.doId).at(-1);
    const kat = !d ? "bez rozpoznania" : d.status === "FAILED" ? "nierozpoznane" : d.kategoria;
    wgKategorii.set(kat, [...(wgKategorii.get(kat) ?? []), p.minuty]);
    const kto = zLudzmi ? autorzy.get(`${p.rozmowa}|${p.zewnetrzny}`) ?? "z Allegro" : null;
    if (kto !== null) wgOsoby.set(kto, [...(wgOsoby.get(kto) ?? []), p.minuty]);

    const l = losOdpowiedzi(wgRozmowy.get(p.rozmowa) ?? [], p,
      (id) => poWiadomosci.get(id) ?? null, teraz);
    if (l.los === "czeka") { powroty.czeka += 1; continue; }
    const bez = l.los === "bez_powrotu";
    powroty.n += 1;
    if (bez) powroty.bezPowrotu += 1;
    else {
      powroty.wrocilo += 1;
      if (l.bezRozpoznania) powroty.wrociloBezRozpoznania += 1;
    }
    dolicz(powrotyKat, kat, bez);
    if (kto !== null) dolicz(powrotyOsoby, kto, bez);
  }
  powroty.wgKategorii = wierszePowrotu(powrotyKat);
  powroty.wgOsoby = zLudzmi ? wierszePowrotu(powrotyOsoby) : null;

  const wszystkie = probki.map((p) => p.minuty);
  return {
    dni,
    daneDo: probki.length ? probki.map((p) => p.at).sort().at(-1)! : null,
    ogolem: { n: wszystkie.length, medianaMin: zaokragl(mediana(wszystkie)), p90Min: zaokragl(p90(wszystkie)) },
    wgKategorii: wiersze(wgKategorii),
    wgOsoby: zLudzmi ? wiersze(wgOsoby) : null,
    czekaTeraz: {
      n: czekajace.length,
      najdluzejMin: czekajace.length ? Math.round(Math.max(...czekajace)) : null,
    },
    powroty,
  };
}
