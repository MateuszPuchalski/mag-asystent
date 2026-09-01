import { useEffect, useState } from "react";
import { token } from "../api/klient";

/* ── Zdjęcia kartotek w panelu obsługi (0.152.0) ─────────────────────────────
   Pierwszy obraz w tym froncie. Panel magazynu (`biuro.html`) pokazuje je od
   dawna i zapłacił po drodze za trzy rzeczy, których nie ma sensu kupować
   drugi raz — więc ten moduł przenosi je razem z uzasadnieniami.

   1. TRASA STOI ZA SESJĄ. `/api/products/:twId/zdjecie` żąda nagłówka
      `x-session`, więc `<img src>` wprost dostanie 401. Obraz trzeba pobrać
      `fetch`em i podać jako `blob:`.
   2. PAMIĘĆ NEGATYWU. Mapa trzyma też `null` — „ten towar NA PEWNO nie ma
      zdjęcia". Bez tego lista pytałaby serwer o brak przy każdym przerysowaniu,
      a większość kartotek zdjęcia nie ma.
   3. NAJWYŻEJ TRZY POBRANIA NARAZ. Przy pierwszym trafieniu serwer ciągnie
      plik z bazy firmy; czterdzieści równoległych żądań zagłodziłoby
      kolektory stojące przy regale. Ta liczba jest w `biuro.html` od
      0.60.0 i ma tam ten sam komentarz.

   Miniatur nie ma i nie będzie: serwer nie skaluje obrazów (zero modułów
   natywnych). Kafel dostaje pełny obraz i `object-fit: cover`.             */

const ROWNOLEGLE = 3;

/** `undefined` = jeszcze nie wiemy, `null` = na pewno brak, string = blob. */
const pamiec = new Map<number, string | null>();
const wToku = new Map<number, Promise<string | null>>();
const kolejka: Array<() => Promise<void>> = [];
let biegnie = 0;

/* Nasłuchy komponentów: jeden `twId` bywa w wierszu kolejki i w kolumnie
   dowodów naraz, a oba mają się odświeżyć po jednym pobraniu. */
const nasluchy = new Map<number, Set<() => void>>();

function ogloś(twId: number) {
  for (const f of nasluchy.get(twId) ?? []) f();
}

function pchnij() {
  while (biegnie < ROWNOLEGLE && kolejka.length) {
    const zadanie = kolejka.shift()!;
    biegnie++;
    void zadanie().finally(() => { biegnie--; pchnij(); });
  }
}

async function pobierz(twId: number): Promise<string | null> {
  const odp = await fetch(`/api/products/${twId}/zdjecie`, {
    headers: { "x-session": token() },
  });
  /* 404 znaczy „potwierdzony brak" i jest ODPOWIEDZIĄ, nie awarią — serwer
     nie zapisuje go nawet w audycie. Każdy inny kod też kończy się `null`:
     ekran zwrotu nie ma prawa zatrzymać się na zdjęciu. */
  if (!odp.ok) return null;
  return URL.createObjectURL(await odp.blob());
}

function zamow(twId: number): Promise<string | null> {
  const juz = wToku.get(twId);
  if (juz) return juz;
  const p = new Promise<string | null>((resolve) => {
    kolejka.push(async () => {
      let wynik: string | null = null;
      try { wynik = await pobierz(twId); } catch { wynik = null; }
      pamiec.set(twId, wynik);
      wToku.delete(twId);
      ogloś(twId);
      resolve(wynik);
    });
    pchnij();
  });
  wToku.set(twId, p);
  return p;
}

/**
 * Adres `blob:` zdjęcia kartoteki albo `null`, gdy zdjęcia nie ma.
 *
 * `undefined` znaczy „jeszcze nie wiadomo" i tylko wtedy wolno pokazać stan
 * ładowania — inaczej kafel migałby przy każdym przerysowaniu listy.
 *
 * Adresów `blob:` nie zwalniamy: żyją do przeładowania panelu, dokładnie jak
 * w `biuro.html`. Zwolnienie przy odmontowaniu komponentu unieważniłoby je
 * drugiemu miejscu, które pokazuje ten sam towar.
 */
export function useZdjecie(twId: number | null | undefined): string | null | undefined {
  const [, odswiez] = useState(0);

  useEffect(() => {
    if (twId == null) return;
    const f = () => odswiez((n) => n + 1);
    const zbior = nasluchy.get(twId) ?? new Set<() => void>();
    zbior.add(f);
    nasluchy.set(twId, zbior);
    if (!pamiec.has(twId)) void zamow(twId);
    return () => {
      zbior.delete(f);
      if (!zbior.size) nasluchy.delete(twId);
    };
  }, [twId]);

  if (twId == null) return null;
  return pamiec.get(twId);
}

/** Tylko do testów — mapa i kolejka są modułowe, więc żyją między nimi. */
export function _wyczyscPamiecZdjec() {
  pamiec.clear();
  wToku.clear();
  kolejka.length = 0;
  biegnie = 0;
  nasluchy.clear();
}
