import type { DatabaseSync } from "node:sqlite";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";
import type { Tokeny } from "./copilot-koszt.js";
import type { WynikWywolania } from "./copilot-narzedzia.js";

/* ── Księga Copilota: jeden pisarz ───────────────────────────────────────────
   Każde wywołanie modelu zostawia wiersz w `copilot_wywolanie`, także nieudane,
   bo za nieudane też się płaci. Pisarz jest jeden, bo każda nowa kolumna
   pomiaru dopisana do jednego z kilku zdublowanych pisarzy znikałaby w drugim.

   Pisarz NIE ZMIENIA wartości, które wołający podaje, i nie zgaduje braków.
   Nowe liczby bez wartości idą jako NULL, czyli „nie wiemy”. Wyjątek zostaje
   z dawnego zapisu: błąd dopytania podaje czas 0, a szkic NULL. Ujednolicenie
   zmieniłoby medianę czasu w pomiarze, więc to osobna decyzja, nie skutek
   uboczny tego pisarza.

   W księdze nie ma treści: ani tekstu klienta, ani szkicu, ani zdania błędu
   dla agenta. Kod błędu i ślad dostawcy wystarczą, żeby znaleźć przyczynę. */

/**
 * Skąd przyszło wywołanie. Pomiar kosztu i trafności dzieli się po nim, bo
 * szkic na kliknięcie i szkic z taktu to dwie różne decyzje o pieniądzach.
 * `eval` to zestaw testowy na żywym modelu, który nie ma liczyć się do biura.
 */
export type ZrodloWywolania =
  | "klik" | "takt" | "po_rozpoznaniu" | "przed_praca" | "dopytanie" | "eval";

/** Minimum twierdzenia, z którego liczą się liczniki. Treść tezy tu nie wchodzi. */
interface TwierdzenieDoLiczenia {
  zrodlo: string;
  obnizona: boolean;
}

export interface WpisKsiegi {
  zadanie: string;
  conversationId?: number | null;
  reklamacjaId?: number | null;
  /** Pusty, gdy nic nie zostało zapłacone. Pomiar pomija wtedy wiersz w kosztach. */
  model: string;
  /** Brak = zera, bo wywołanie bez odpowiedzi nie oddało rachunku. */
  zuzycie?: Tokeny | null;
  ms?: number | null;
  wynik: "ok" | "blad";
  /** Ślad dla człowieka, ucięty do 300 znaków. Nigdy treść rozmowy. */
  blad?: string | null;
  przezUserId: number | null;
  at: Date;
  kodBledu?: string | null;
  wersjaInstrukcji?: string | null;
  zrodlo?: ZrodloWywolania | null;
  rund?: number | null;
  narzedzi?: number | null;
  /** Twierdzenia po ocenie serwera. Brak = NULL we wszystkich trzech licznikach. */
  twierdzenia?: readonly TwierdzenieDoLiczenia[] | null;
  /** Kategoria decyzji klasyfikacji, na której stało wywołanie. */
  kategoria?: string | null;
}

/** Zapis wiersza księgi. Oddaje jego `id`, żeby wołający mógł do niego wrócić. */
export function zapiszWKsiedze(database: DatabaseSync, w: WpisKsiegi): number {
  const t = w.zuzycie;
  const tw = w.twierdzenia;
  return Number(database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,reklamacja_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at,kod_bledu,wersja_instrukcji,zrodlo,
     rund,narzedzi,twierdzen,twierdzen_obnizonych,twierdzen_spoza_faktow,kategoria)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(w.zadanie, w.conversationId ?? null, w.reklamacjaId ?? null, w.model,
      t?.wej ?? 0, t?.wyj ?? 0, t?.cacheZapis ?? 0, t?.cacheOdczyt ?? 0,
      w.ms ?? null, w.wynik, w.blad ? w.blad.slice(0, 300) : null, w.przezUserId,
      w.at.toISOString(), w.kodBledu ?? null, w.wersjaInstrukcji ?? null, w.zrodlo ?? null,
      w.rund ?? null, w.narzedzi ?? null,
      tw ? tw.length : null,
      tw ? tw.filter((x) => x.obnizona).length : null,
      /* Spoza faktów to wszystko, czego nie dźwiga nasza baza: oferta,
         zdjęcie i wiedza modelu. Tę liczbę agent musi sprawdzić sam. */
      tw ? tw.filter((x) => x.zrodlo !== "fakty").length : null,
      w.kategoria ?? null).lastInsertRowid);
}

/**
 * Kod błędu z klasy wyjątku. Klasy dostawcy mapują się na stałe słowa, a
 * odmowa niesie kod nadany tam, gdzie powstała: w adapterze albo w sitach.
 * Obcy wyjątek to `inny`, bo nie wiemy o nim nic więcej.
 */
export function kodBledu(e: unknown): string {
  if (e instanceof BladLimituCopilota) return "limit";
  if (e instanceof BladKluczaCopilota) return "klucz";
  if (e instanceof BladPrzeciazeniaCopilota) return "przeciazenie";
  if (e instanceof BladLacznosciCopilota) return "lacznosc";
  if (e instanceof BladOdpowiedziCopilota) return e.kod;
  return "inny";
}

/**
 * Co adapter dopiął do błędu po zapłaconych rundach. Pola są opcjonalne, bo
 * atrapa w teście i błąd sprzed pierwszego żądania nie niosą żadnego.
 */
export function sladPorazki(e: unknown): {
  zuzycie?: Tokeny; rund?: number; narzedzi?: number; wersjaInstrukcji?: string;
  wynikiNarzedzi?: WynikWywolania[];
} {
  const z = (e ?? {}) as Record<string, unknown>;
  return {
    zuzycie: z.zuzycie as Tokeny | undefined,
    rund: typeof z.rund === "number" ? z.rund : undefined,
    narzedzi: typeof z.narzedzi === "number" ? z.narzedzi : undefined,
    wersjaInstrukcji: typeof z.wersjaInstrukcji === "string" ? z.wersjaInstrukcji : undefined,
    wynikiNarzedzi: Array.isArray(z.wynikiNarzedzi) ? z.wynikiNarzedzi as WynikWywolania[] : undefined,
  };
}
