import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { mediana } from "./raporty.js";
import { TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";

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
 * Próbki czekania z listy wiadomości JEDNEJ rozmowy, w kolejności `id`.
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
     ORDER BY conversation_id, id`).all(start, zapas) as unknown as Wiadomosc[];

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
  const decyzje = new Map<number, Array<{ message_id: number; kategoria: string; status: string }>>();
  for (const d of database.prepare(`SELECT conversation_id, message_id, kategoria, status
      FROM decyzja_klasyfikacji WHERE aktywna=1 AND taksonomia_wersja=?
      ORDER BY conversation_id, message_id`).all(TAKSONOMIA_WERSJA) as
      Array<{ conversation_id: number; message_id: number; kategoria: string; status: string }>) {
    const lista = decyzje.get(d.conversation_id) ?? [];
    lista.push(d);
    decyzje.set(d.conversation_id, lista);
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
  for (const p of probki) {
    const d = (decyzje.get(p.rozmowa) ?? [])
      .filter((x) => x.message_id >= p.odId && x.message_id < p.doId).at(-1);
    const kat = !d ? "bez rozpoznania" : d.status === "FAILED" ? "nierozpoznane" : d.kategoria;
    wgKategorii.set(kat, [...(wgKategorii.get(kat) ?? []), p.minuty]);
    if (zLudzmi) {
      const kto = autorzy.get(`${p.rozmowa}|${p.zewnetrzny}`) ?? "z Allegro";
      wgOsoby.set(kto, [...(wgOsoby.get(kto) ?? []), p.minuty]);
    }
  }

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
  };
}
