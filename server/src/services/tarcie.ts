import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { mediana } from "./raporty.js";
import { logEvent } from "./events.js";

/* ── Pomiar tarcia w skrzynce (@wydanie) ─────────────────────────────────────
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
   czyta je wyłącznie administrator (0.431.0) — pilnuje tego trasa. */

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

export interface PomiarTarcia {
  dni: number;
  razem: LiczbyTarcia;
  /** `null`, gdy czytający nie jest administratorem. */
  osoby: Array<LiczbyTarcia & { osoba: string }> | null;
}

const pusty = (): LiczbyTarcia => ({
  wyslanych: 0, zeSzkicem: 0, bezZmian: 0, udzialBezZmian: null,
  cofnietychWysylek: 0, cofnietychZakonczen: 0, medianaSekDoWysylki: null, probekCzasu: 0,
});

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
  for (const z of zd) {
    const kto = z.osoba ?? "—";
    if (z.type === "rozmowa_wysylka_cofnieta") dla(kto).cofnietychWysylek++;
    else if (z.type === "rozmowa_zakonczenie_cofniete") dla(kto).cofnietychZakonczen++;
    else {
      const ms = (JSON.parse(z.payload ?? "null") as { msOdOtwarcia?: unknown } | null)?.msOdOtwarcia;
      if (typeof ms === "number") czasy.set(kto, [...(czasy.get(kto) ?? []), ms / 1000]);
    }
  }

  const domknij = (l: LiczbyTarcia, sek: number[]): LiczbyTarcia => {
    const m = mediana(sek);
    return { ...l, probekCzasu: sek.length, medianaSekDoWysylki: m === null ? null : Math.round(m),
      udzialBezZmian: l.zeSzkicem > 0 ? Number((l.bezZmian / l.zeSzkicem).toFixed(2)) : null };
  };
  const razem = [...osoby.values()].reduce((a, b) => ({
    ...a, wyslanych: a.wyslanych + b.wyslanych, zeSzkicem: a.zeSzkicem + b.zeSzkicem,
    bezZmian: a.bezZmian + b.bezZmian, cofnietychWysylek: a.cofnietychWysylek + b.cofnietychWysylek,
    cofnietychZakonczen: a.cofnietychZakonczen + b.cofnietychZakonczen,
  }), pusty());

  return {
    dni,
    razem: domknij(razem, [...czasy.values()].flat()),
    osoby: zLudzmi
      ? [...osoby.entries()].map(([osoba, l]) => ({ osoba, ...domknij(l, czasy.get(osoba) ?? []) }))
        .sort((a, b) => b.wyslanych - a.wyslanych || a.osoba.localeCompare(b.osoba))
      : null,
  };
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
 * Agent zawrócił odpowiedź w oknie „Cofnij" (@wydanie). Czekanie mieszka
 * w przeglądarce (`skrzynka/Odlozone.tsx`), więc bez tego wpisu serwer
 * nigdy by się o cofnięciu nie dowiedział. To jedyny zapis tej ścieżki.
 */
export function zapiszCofniecieWysylki(
  database: DatabaseSync, conversationId: number, autor: { id: number; name: string },
): boolean {
  const jest = database.prepare("SELECT 1 FROM conversation WHERE id=?").get(conversationId);
  if (!jest) return false;
  logEvent("rozmowa_wysylka_cofnieta", autor.name, null, { conversationId }, autor.id, database);
  return true;
}
