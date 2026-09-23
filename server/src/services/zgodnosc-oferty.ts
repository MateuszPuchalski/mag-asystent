import type { DatabaseSync } from "node:sqlite";
import { zloz, zwin } from "../tekst.js";

/* ── Maszyna klienta na liście „Pasuje do" oferty (23 września 2026) ─────────
   Zgłoszenie właściciela ze zrzutem sekcji „Pasuje do kosiarek" z Allegro.
   Listę mamy od 0.253.0 (`offer_snapshot.pasuje_do_json`), ale czytał ją
   wyłącznie model — przyciętą do trzydziestu pozycji — a panel nie pokazywał
   jej wcale. Na zrzucie klient miał HECHT 1803S i ten model stał na liście;
   nikt tego nie powiedział wprost ani agentowi, ani szkicowi.

   JEDNA FUNKCJA DLA SZKICU I EKRANU. Fakt Copilota i podświetlenie w panelu
   muszą mówić o tych samych pozycjach. Dwie kopie dopasowania rozjechałyby
   się przy pierwszej poprawce — tę bliznę kupiła już kontrola świeżości.

   DOPASOWANIE PO SŁOWACH, NIE PO NAPISIE ZWINIĘTYM. `zwin` zlepia „Stiga 460"
   w „stiga460", a wtedy model „46" trafiałby w cudzą kosiarkę. Model musi
   stać w pozycji jako ciąg CAŁYCH słów. Zwinięte porównanie zostaje wyłącznie
   dla całej pozycji naraz — „1803 S" to ten sam model co „1803S".

   MARKA WYMAGANA, chyba że pozycja jest samym modelem. Allegro grupuje listę
   po marce, a nie wiemy na pewno, czy `items[].text` niesie ją w tekście
   [WERYFIKUJ]. Pozycja bez marki trafia więc tylko wtedy, gdy nie ma w niej
   nic poza modelem. „46" przy innej marce nie jest trafieniem.

   Lista to DEKLARACJA SPRZEDAWCY, nie pomiar. Fakt i ekran mówią to wprost,
   a brak na liście nie jest dowodem, że część nie pasuje. */

export interface MaszynaKlienta { marka: string | null; model: string | null; wariant: string | null }

export interface ZgodnoscOferty {
  /** Cała lista z oferty, w kolejności Allegro. */
  lista: string[];
  /** „HECHT 1803S DYM1182c" — gdy agent wpisał markę i model; inaczej `null`. */
  maszyna: string | null;
  /** Pozycje listy, w których stoi maszyna klienta. */
  trafienia: string[];
  /** Czy któreś trafienie wymienia wariant. Bez wariantu w danych — `true`. */
  wariantSprawdzony: boolean;
}

const slowa = (s: string): string[] => zloz(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Czy `igla` stoi w `stog` jako ciąg kolejnych słów. */
function ciag(stog: string[], igla: string[]): boolean {
  if (igla.length === 0 || igla.length > stog.length) return false;
  for (let i = 0; i + igla.length <= stog.length; i++) {
    if (igla.every((s, j) => stog[i + j] === s)) return true;
  }
  return false;
}

/** Czy ta pozycja listy opisuje maszynę klienta (bez oceny wariantu). */
export function pozycjaMaszyny(pozycja: string, marka: string, model: string): boolean {
  const p = slowa(pozycja);
  const m = slowa(model);
  const b = slowa(marka);
  if (ciag(p, m)) return ciag(p, b) || p.length === m.length;
  /* Zapis modelu inaczej podzielony: „1803 S" i „1803S". Tylko CAŁA pozycja
     naraz — patrz nagłówek, dlaczego nie fragment. */
  const cala = zwin(pozycja);
  return cala === zwin(`${marka} ${model}`) || cala === zwin(model);
}

/** Dopasowanie listy do maszyny. Czysta funkcja — szkic i ekran wołają tę samą. */
export function naLiscieZgodnosci(
  lista: string[], m: MaszynaKlienta,
): Omit<ZgodnoscOferty, "lista"> {
  if (!m.marka || !m.model) return { maszyna: null, trafienia: [], wariantSprawdzony: true };
  const maszyna = [m.marka, m.model, m.wariant].filter(Boolean).join(" ");
  const trafienia = lista.filter((p) => pozycjaMaszyny(p, m.marka!, m.model!));
  const w = m.wariant ? slowa(m.wariant) : [];
  const wariantSprawdzony = w.length === 0
    || trafienia.some((p) => ciag(slowa(p), w) || zwin(p).includes(zwin(m.wariant!)));
  return { maszyna, trafienia, wariantSprawdzony };
}

/**
 * Lista zgodności oferty z dopasowaniem — CZYSTY ODCZYT snapshotu.
 *
 * `null`, gdy treści oferty nigdy nie pobrano albo lista jest pusta. Treść
 * dociąga wyłącznie układanie szkicu (`dociagnijTresc`), nie otwarcie
 * rozmowy — zero zapisu przy patrzeniu.
 */
export function zgodnoscOferty(
  database: DatabaseSync, konto: number, ofertaId: string, m: MaszynaKlienta,
): ZgodnoscOferty | null {
  const w = database.prepare(`SELECT pasuje_do_json FROM offer_snapshot
      WHERE channel_account_id=? AND external_id=?`).get(konto, ofertaId) as
    { pasuje_do_json: string | null } | undefined;
  let lista: string[] = [];
  try { lista = JSON.parse(w?.pasuje_do_json ?? "[]") as string[]; } catch { lista = []; }
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return { lista, ...naLiscieZgodnosci(lista, m) };
}

/**
 * Zdanie faktu dla szkicu. `null`, gdy agent nie wpisał maszyny — wtedy
 * model dostaje samą listę, jak do tej wersji.
 *
 * „NIE MA" niesie zastrzeżenie w SAMYM fakcie, nie w instrukcji: model czyta
 * fakt dosłownie, a zdanie „nie ma na liście" bez zastrzeżenia zamienia się
 * w szkicu w „nie pasuje". To byłaby odpowiedź, której nic nie popiera.
 */
export function zdanieZgodnosci(z: ZgodnoscOferty, wariant: string | null): string | null {
  if (!z.maszyna) return null;
  if (z.trafienia.length === 0) {
    return `Maszyny klienta ${z.maszyna} NIE MA na liście zgodności tej oferty (lista ma ${z.lista.length} pozycji). `
      + "Brak na liście NIE znaczy, że część nie pasuje — lista bywa niepełna; "
      + "nie pisz klientowi „nie pasuje” wyłącznie na tej podstawie";
  }
  return `Maszyna klienta ${z.maszyna} JEST na liście zgodności tej oferty `
    + `(pozycja: „${z.trafienia.join("”, „")}”)`
    + (z.wariantSprawdzony ? "" : `; wariantu ${wariant} lista nie wymienia — wariant niesprawdzony`)
    + "; to deklaracja z oferty, nie pomiar";
}
