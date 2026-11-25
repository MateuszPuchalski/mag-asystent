import type { DatabaseSync } from "node:sqlite";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";
import { kodBledu, sladPorazki, zapiszWKsiedze } from "./copilot-ksiega.js";
import { kosztUsd, type Tokeny } from "./copilot-koszt.js";
import { narzedziaZZapisu, type ZestawNarzedzi } from "./copilot-narzedzia.js";
import { zostalyDaneOsobowe } from "./copilot-maskowanie.js";
import {
  bezZnacznikow, faktyZTekstu, ocenTwierdzenia, sitaSzkicu, zRozpoznaniaNiepewne,
  type NadawcaSzkicu, type SzkicSurowy,
} from "./copilot-szkic.js";
import { wejsciaSzkicow, ZADANIA_SZKICU, type WejscieSzkicu } from "./copilot-wejscie.js";
import { logEvent } from "./events.js";
import { mediana } from "./raporty.js";
import { podzielStopke } from "./stopka.js";

/* ── Zestaw testowy Copilota: powtórka zapisanych spraw ──────────────────────
   `copilot_wejscie` trzyma dokładnie to, co poszło do dostawcy przy każdym
   szkicu. Ten plik puszcza te same wejścia jeszcze raz, innym modelem albo
   inną instrukcją, i mówi, co się zmieniło. Powód: wydanie trafia do magazynu
   samo, więc zmiana instrukcji bez porównania jest zmianą na wiarę.

   TRZY PYTANIA, każde z liczbą, której nie ocenia model:
   1. SITA. Czy nowy szkic przechodzi te same sita co szkic biura. Sito
      odrzuca wymyślony numer, więc „zepsute" jest tu najważniejszym słowem.
      Oba szkice przesiewa DZISIEJSZY kod. Wynik sit zapisany w dniu szkicu
      mierzyłby po zmianie sit zmianę sit, a nie modelu.
   2. KOSZT I CZAS. Z tych samych stawek co pomiar biura.
   3. BLISKOŚĆ DO TEGO, CO POSZŁO DO KLIENTA. Udział wspólnych słów szkicu
      i wysłanej odpowiedzi. To miara zgrubna i raport mówi dlaczego.

   SĘDZIEGO-MODELU TU NIE MA. Ocena szkicu drugim modelem to nowe płatne
   wywołanie z własną instrukcją, a więc osobna decyzja właściciela. Ostatnie
   słowo ma człowiek, który czyta pary szkiców (`paryZestawu`).

   TREŚĆ NIE WYCHODZI INNĄ DROGĄ. Do dostawcy idzie to samo zamaskowane
   wejście, które już raz tam poszło. Księga i dziennik dostają liczby.
   Wysłaną odpowiedź czytamy tylko do policzenia bliskości i nie oddajemy
   jej dalej: pisał ją agent, bywa w niej imię klienta, a maski na niej nie ma.

   POWTÓRKA NIE DOPISUJE WEJŚĆ. Zestaw karmiony własnymi powtórkami rósłby
   o sprawy, których żaden klient nie napisał.

   ZDJĘĆ NIE POWTARZAMY. Wejście trzyma ich spis bez bajtów, a szkic bez
   obrazu, o którym mówią fakty, byłby inną sprawą niż ta zapisana. Sprawy
   ze zdjęciami raport liczy osobno jako pominięte.                          */

/**
 * Zadanie w księdze. Osobne od `szkic`, bo sufit godzinowy taktu liczy
 * wyłącznie `szkic` i powtórka zjadałaby biuru szkice z automatu.
 */
export const ZADANIE_ZESTAWU = "szkic_zestaw";

/** Co agent zrobił ze szkicem pierwotnym. Od najmocniejszej zgody do braku śladu. */
export const LOSY = [
  "bez_zmian", "poprawiony", "odrzucony", "wyslane_bez_szkicu", "bez_odpowiedzi",
] as const;
export type LosSzkicu = (typeof LOSY)[number];

const OPIS_LOSU: Record<LosSzkicu, string> = {
  bez_zmian: "wysłany bez zmian",
  poprawiony: "wysłany po poprawce",
  odrzucony: "odrzucony przez agenta",
  wyslane_bez_szkicu: "odpowiedź poszła bez tego szkicu",
  bez_odpowiedzi: "bez wysłanej odpowiedzi",
};

/** Jak skończył się szkic: przeszedł sita, odpadł na sicie albo dostawca nie odpowiedział. */
export type StanSzkicu =
  | { stan: "ok" }
  | { stan: "sito"; kod: string }
  | { stan: "blad"; kod: string };

export interface SprawaZestawu {
  wejscie: WejscieSzkicu;
  /** Szkic biura z chwili zapisu. */
  bazowy: StanSzkicu & {
    /** Treść bez znaczników faktów; `null`, gdy dostawca nie odpowiedział. */
    tresc: string | null;
    model: string;
    zuzycie: Tokeny | null;
    ms: number | null;
  };
  kategoria: string | null;
  los: LosSzkicu;
  /**
   * Co agent wysłał klientowi, bez stopki. Bez maski, więc wyłącznie do
   * liczenia bliskości w pamięci procesu. Raport ani plik par jej nie niosą.
   */
  wyslane: string | null;
  /** Dlaczego sprawy nie da się powtórzyć; `null` = da się. */
  pominieta: "zdjecia" | "maskowanie" | null;
}

/** Surowa odpowiedź z zapisu, gdy ma kształt, który czytają sita. */
function szkicZWyjscia(wyjscie: unknown): SzkicSurowy | null {
  const w = wyjscie as Partial<SzkicSurowy> | null;
  if (!w || typeof w.tresc !== "string") return null;
  const lista = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return {
    tresc: w.tresc, uzyteFakty: lista(w.uzyteFakty), zastrzezenia: lista(w.zastrzezenia),
    twierdzenia: lista(w.twierdzenia), odczytZeZdjec: lista(w.odczytZeZdjec),
  };
}

const zuzycieZKsiegi = (k: Record<string, unknown> | undefined): Tokeny | null => {
  if (!k || !String(k.model ?? "")) return null;
  return {
    wej: Number(k.tokeny_wej), wyj: Number(k.tokeny_wyj),
    cacheZapis: Number(k.tokeny_cache_zapis), cacheOdczyt: Number(k.tokeny_cache_odczyt),
    wyszukiwania: Number(k.wyszukiwania ?? 0),
  };
};

/**
 * Sprawy do powtórki z tym, co o nich wiemy: wynikiem szkicu biura i losem
 * tego szkicu. Czysty odczyt.
 */
export function sprawyZestawu(
  database: DatabaseSync, o: { od?: string | null; limit: number },
): SprawaZestawu[] {
  const ksiega = database.prepare("SELECT * FROM copilot_wywolanie WHERE id=?");
  /* Odpowiedź na TĘ wiadomość klienta, pierwsza po szkicu. Wysyłka do
     późniejszej wiadomości oceniałaby szkic, którego agent już nie widział. */
  const wysylka = database.prepare(`SELECT body, szkic_los FROM outbox
    WHERE conversation_id=? AND status='sent' AND expected_last_message_id=? AND created_at >= ?
    ORDER BY id LIMIT 1`);
  /* Ostatnia ocena po tym szkicu, a przed następnym szkicem rozmowy, który
     przeszedł sita. Tylko taki szkic zastępuje poprzedni i kasuje jego ocenę.
     Dopytanie i szkic odrzucony sitem okna nie zamykają: po nich agent dalej
     ocenia ten sam tekst. */
  const zadania = ZADANIA_SZKICU.map((z) => `'${z}'`).join(",");
  const ocena = database.prepare(`SELECT json_extract(payload,'$.ocena') AS ocena FROM events
    WHERE type='copilot_szkic_ocena' AND json_valid(payload)
      AND json_extract(payload,'$.conversationId')=? AND created_at >= ?
      AND created_at < COALESCE((SELECT MIN(x.at) FROM copilot_wejscie x
                                  WHERE x.conversation_id=? AND x.id > ?
                                    AND x.zadanie IN (${zadania}) AND x.wynik_sit='ok'), '9999')
    ORDER BY id DESC LIMIT 1`);

  return wejsciaSzkicow(database, o).map((w): SprawaZestawu => {
    const k = w.wywolanieId == null ? undefined
      : ksiega.get(w.wywolanieId) as Record<string, unknown> | undefined;
    const surowy = szkicZWyjscia(w.wyjscie);
    const sito = surowy ? sitaSzkicu(surowy, {
      fakty: faktyZTekstu(String(w.fakty)), material: `${w.fakty}\n${w.watek}`,
      wyslaneZdjecia: new Set(w.zdjecia.map((z) => z.numer)), wynikiN: w.wynikiNarzedzi,
    }) : null;
    const tresc = !surowy || !sito ? null : sito.ok ? sito.tresc : bezZnacznikow(surowy.tresc);
    const stan: StanSzkicu = !sito ? { stan: "blad", kod: String(k?.kod_bledu ?? "inny") }
      : sito.ok ? { stan: "ok" } : { stan: "sito", kod: sito.kod };

    const wys = w.conversationId == null || w.messageId == null ? undefined
      : wysylka.get(w.conversationId, w.messageId, w.at) as
        { body: string; szkic_los: string | null } | undefined;
    /* Ocena dotyczy szkicu przy rozmowie. Wejście odrzucone sitem szkicu nie
       zostawiło, więc ocena w jego oknie należy do starszego tekstu. */
    const oc = w.conversationId == null || w.wynikSit !== "ok" ? undefined
      : ocena.get(w.conversationId, w.at, w.conversationId, w.id) as { ocena: string | null } | undefined;
    const los: LosSzkicu = oc?.ocena === "odrzucony" ? "odrzucony"
      : wys?.szkic_los === "bez_zmian" ? "bez_zmian"
        : wys?.szkic_los === "poprawiony" ? "poprawiony"
          : wys ? "wyslane_bez_szkicu" : "bez_odpowiedzi";

    return {
      wejscie: w,
      bazowy: {
        ...stan, tresc, model: w.model ?? "",
        zuzycie: zuzycieZKsiegi(k), ms: k?.ms == null ? null : Number(k.ms),
      },
      kategoria: k?.kategoria == null ? null : String(k.kategoria),
      los,
      wyslane: wys ? podzielStopke(wys.body).tresc.trim() : null,
      /* Ta sama asercja co przed szkicem biura. Wejście wyszło już raz, ale
         leży do 90 dni, a wzorce maskowania przez ten czas się poprawiają. */
      pominieta: w.zdjecia.length > 0 ? "zdjecia"
        : zostalyDaneOsobowe(String(w.watek)) ? "maskowanie" : null,
    };
  });
}

/**
 * Bliskość dwóch tekstów: udział wspólnych słów, od 0 do 1 (współczynnik
 * Dice'a na słowach z powtórzeniami). Wielkość liter i interpunkcja nie
 * mają znaczenia. `null`, gdy któryś tekst nie ma ani jednego słowa.
 *
 * Miara jest celowo prosta. Nie wie, że dwa zdania znaczą to samo, i polska
 * odmiana ją obniża. Porównujemy nią jednak dwa szkice z TĄ SAMĄ wysłaną
 * odpowiedzią, więc obie słabości trafiają w oba szkice jednakowo.
 */
export function bliskosc(a: string, b: string): number | null {
  const slowa = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const sa = slowa(a);
  const sb = slowa(b);
  if (!sa.length || !sb.length) return null;
  const ile = new Map<string, number>();
  for (const s of sa) ile.set(s, (ile.get(s) ?? 0) + 1);
  let wspolne = 0;
  for (const s of sb) {
    const n = ile.get(s) ?? 0;
    if (n > 0) {
      wspolne += 1;
      ile.set(s, n - 1);
    }
  }
  return (2 * wspolne) / (sa.length + sb.length);
}

export interface WynikSprawy {
  sprawa: SprawaZestawu;
  nowy: StanSzkicu;
  /** Surowa odpowiedź nowego szkicu, przed sitami; `null` przy błędzie dostawcy. */
  surowy: SzkicSurowy | null;
  /** Treść nowego szkicu bez znaczników faktów, także gdy odpadł na sicie. */
  tresc: string | null;
  model: string;
  zuzycie: Tokeny | null;
  ms: number | null;
  /** Skąd narzędzia brały odpowiedzi: z zapisu sprawy czy z dzisiejszej bazy. */
  narzedzia: { zapis: number; zywo: number; brak: number };
  bliskoscBazowa: number | null;
  bliskoscNowa: number | null;
}

export interface OpcjePrzebiegu {
  nadaj: NadawcaSzkicu;
  /** Model powtórki. Do księgi przy błędzie, bo wtedy odpowiedź go nie niesie. */
  model: string;
  /**
   * Czy szkic dostaje narzędzia kartoteki. Zapisane wyniki mają pierwszeństwo,
   * a `narzedziaNaZywo` odpowiada na pytania, których zapis nie zna.
   */
  zNarzedziami: boolean;
  narzedziaNaZywo?: ZestawNarzedzi | null;
  teraz?: () => Date;
  postep?: (zrobione: number, wszystkich: number) => void;
}

export interface Przebieg {
  wyniki: WynikSprawy[];
  pominiete: SprawaZestawu[];
  /** Powód przerwania przed końcem; pozostałe sprawy nie poszły. */
  przerwano: "limit" | "klucz" | "przeciazenie" | "lacznosc" | "seria_bledow" | null;
  niepuszczonych: number;
}

/**
 * Jeden przebieg zestawu: sprawa po sprawie, bez równoległości, bo limit
 * dostawcy jest wspólny z biurem, które pracuje w tym samym czasie.
 *
 * Każde wywołanie zostawia wiersz w księdze, także nieudane: za powtórkę
 * też się płaci i koszt pomiaru ma to pokazać. Limit, przeciążenie, brak
 * łączności i brak klucza przerywają przebieg, bo następna sprawa skończyłaby
 * się tak samo. Przerywa też seria błędów dostawcy z rzędu: literówka
 * w nazwie modelu odrzuca każde żądanie, a księga nie ma retencji.
 */
export const SERIA_BLEDOW = 3;

export async function przebiegZestawu(
  database: DatabaseSync, sprawy: readonly SprawaZestawu[], o: OpcjePrzebiegu,
): Promise<Przebieg> {
  const doPuszczenia = sprawy.filter((s) => !s.pominieta);
  const pominiete = sprawy.filter((s) => s.pominieta);
  const wyniki: WynikSprawy[] = [];
  let przerwano: Przebieg["przerwano"] = null;
  let bledowZRzedu = 0;

  for (const sprawa of doPuszczenia) {
    const w = sprawa.wejscie;
    const at = (o.teraz ?? (() => new Date()))();
    const narzedzia = { zapis: 0, zywo: 0, brak: 0 };
    const zestaw = o.zNarzedziami
      ? narzedziaZZapisu(w.wynikiNarzedzi, o.narzedziaNaZywo ?? null, (skad) => { narzedzia[skad] += 1; })
      : undefined;
    const wspolne = {
      zadanie: ZADANIE_ZESTAWU, conversationId: w.conversationId, przezUserId: null, at,
      zrodlo: "eval" as const, kategoria: sprawa.kategoria,
    };
    const bliskoscBazowa = sprawa.wyslane && sprawa.bazowy.tresc
      ? bliskosc(sprawa.bazowy.tresc, sprawa.wyslane) : null;

    try {
      const odp = zestaw ? await o.nadaj(w.watek, w.fakty, [], zestaw) : await o.nadaj(w.watek, w.fakty, []);
      const fakty = faktyZTekstu(String(w.fakty));
      const sito = sitaSzkicu(odp, {
        fakty, material: `${w.fakty}\n${w.watek}`,
        wyslaneZdjecia: new Set(), wynikiN: odp.wynikiNarzedzi ?? [],
      });
      const zOdpowiedzi = {
        model: odp.model, zuzycie: odp.zuzycie, ms: odp.ms, rund: odp.rund ?? 1,
        narzedzi: (odp.narzedzia ?? []).length, wersjaInstrukcji: odp.wersjaInstrukcji ?? null,
      };
      if (sito.ok) {
        zapiszWKsiedze(database, { ...wspolne, ...zOdpowiedzi, wynik: "ok", twierdzenia: sito.twierdzenia });
      } else {
        zapiszWKsiedze(database, {
          ...wspolne, ...zOdpowiedzi, wynik: "blad", kodBledu: sito.kod,
          blad: `${sito.kod}: ${sito.lista.join(", ")}`,
          twierdzenia: zRozpoznaniaNiepewne(ocenTwierdzenia(odp.twierdzenia), fakty),
        });
      }
      const tresc = sito.ok ? sito.tresc : bezZnacznikow(odp.tresc);
      bledowZRzedu = 0;
      wyniki.push({
        sprawa, nowy: sito.ok ? { stan: "ok" } : { stan: "sito", kod: sito.kod },
        surowy: {
          tresc: odp.tresc, uzyteFakty: odp.uzyteFakty, zastrzezenia: odp.zastrzezenia,
          twierdzenia: odp.twierdzenia, odczytZeZdjec: odp.odczytZeZdjec,
        },
        tresc, model: odp.model, zuzycie: odp.zuzycie, ms: odp.ms, narzedzia,
        bliskoscBazowa, bliskoscNowa: sprawa.wyslane ? bliskosc(tresc, sprawa.wyslane) : null,
      });
    } catch (e) {
      /* Rundy zapłacone przed błędem idą do księgi z modelem. Błąd bez
         rachunku zostaje z pustym modelem i pomiar kosztu go pomija. */
      const p = sladPorazki(e);
      const t = p.zuzycie && (p.zuzycie.wej || p.zuzycie.wyj) ? p.zuzycie : null;
      const kod = kodBledu(e);
      zapiszWKsiedze(database, {
        ...wspolne, model: t ? o.model : "", zuzycie: t, wynik: "blad", kodBledu: kod,
        blad: (e as { slad?: string }).slad || (e as Error).message,
        rund: p.rund, narzedzi: p.narzedzi, wersjaInstrukcji: p.wersjaInstrukcji,
      });
      wyniki.push({
        sprawa, nowy: { stan: "blad", kod }, surowy: null, tresc: null,
        model: o.model, zuzycie: t, ms: null, narzedzia, bliskoscBazowa, bliskoscNowa: null,
      });
      if (e instanceof BladLimituCopilota) przerwano = "limit";
      if (e instanceof BladKluczaCopilota) przerwano = "klucz";
      if (e instanceof BladPrzeciazeniaCopilota) przerwano = "przeciazenie";
      if (e instanceof BladLacznosciCopilota) przerwano = "lacznosc";
      bledowZRzedu += 1;
      if (!przerwano && bledowZRzedu >= SERIA_BLEDOW) przerwano = "seria_bledow";
    }
    o.postep?.(wyniki.length, doPuszczenia.length);
    if (przerwano) break;
  }

  const przebieg: Przebieg = {
    wyniki, pominiete, przerwano, niepuszczonych: doPuszczenia.length - wyniki.length,
  };
  const p = podsumujZestaw(przebieg);
  /* Ładunek niesie liczby, nigdy treść: dziennik nie ma retencji. */
  logEvent("copilot_zestaw", "system", null, {
    spraw: wyniki.length, pominietych: pominiete.length, przerwano,
    ok: p.nowy.ok, naprawionych: p.naprawione.length, zepsutych: p.zepsute.length,
    model: o.model, usd: p.usdPrzebiegu,
  }, null, database);
  return przebieg;
}

export interface Podsumowanie {
  spraw: number;
  pominietych: number;
  bazowy: { ok: number; odpadlo: Record<string, number> };
  nowy: { ok: number; odpadlo: Record<string, number> };
  /** Wejścia, gdzie szkic biura odpadł na sicie, a nowy przechodzi. */
  naprawione: number[];
  /**
   * Wejścia, gdzie szkic biura przeszedł, a nowy odpada na sicie. Błąd
   * dostawcy tu nie wchodzi: limit albo zła nazwa modelu nic nie mówią
   * o tym, co model napisałby klientowi.
   */
  zepsute: number[];
  /** Ile kosztował cały przebieg, razem ze sprawami bez rachunku biura. */
  usdPrzebiegu: number;
  usdBazowy: number;
  usdNowy: number;
  /** Ile spraw ma rachunek po obu stronach; koszt porównujemy tylko na nich. */
  zRachunkiem: number;
  medianaMsBazowa: number | null;
  medianaMsNowa: number | null;
  bliskosc: Array<{ los: LosSzkicu; par: number; bazowa: number | null; nowa: number | null }>;
}

const srednia = (l: number[]): number | null =>
  l.length ? l.reduce((s, x) => s + x, 0) / l.length : null;

const etykieta = (s: StanSzkicu): string => (s.stan === "ok" ? "ok" : `${s.stan}: ${s.kod}`);

/** Liczby przebiegu. Czysta funkcja, żeby raport i dziennik liczyły to samo. */
export function podsumujZestaw(p: Przebieg): Podsumowanie {
  const zlicz = (stany: StanSzkicu[]) => {
    const odpadlo: Record<string, number> = {};
    for (const s of stany) if (s.stan !== "ok") odpadlo[etykieta(s)] = (odpadlo[etykieta(s)] ?? 0) + 1;
    return { ok: stany.filter((s) => s.stan === "ok").length, odpadlo };
  };
  /* Koszt tylko tam, gdzie obie strony mają rachunek. Inaczej błąd dostawcy
     po jednej stronie wyglądałby jak oszczędność. */
  const zRachunkiem = p.wyniki.filter((w) => w.zuzycie && w.sprawa.bazowy.zuzycie);
  const usd = (l: Array<{ model: string; zuzycie: Tokeny | null }>) =>
    Number(l.reduce((s, x) => s + (x.zuzycie ? kosztUsd(x.model, x.zuzycie) : 0), 0).toFixed(6));
  /* Czas w parach, jak koszt: mediana z innych spraw po każdej stronie
     porównywałaby sprawy, nie warianty. */
  const zCzasem = p.wyniki.filter((w) => w.ms !== null && w.sprawa.bazowy.ms !== null);

  return {
    spraw: p.wyniki.length,
    pominietych: p.pominiete.length,
    bazowy: zlicz(p.wyniki.map((w) => w.sprawa.bazowy)),
    nowy: zlicz(p.wyniki.map((w) => w.nowy)),
    naprawione: p.wyniki.filter((w) => w.sprawa.bazowy.stan === "sito" && w.nowy.stan === "ok")
      .map((w) => w.sprawa.wejscie.id),
    zepsute: p.wyniki.filter((w) => w.sprawa.bazowy.stan === "ok" && w.nowy.stan === "sito")
      .map((w) => w.sprawa.wejscie.id),
    usdPrzebiegu: usd(p.wyniki),
    usdBazowy: usd(zRachunkiem.map((w) => w.sprawa.bazowy)),
    usdNowy: usd(zRachunkiem),
    zRachunkiem: zRachunkiem.length,
    medianaMsBazowa: mediana(zCzasem.map((w) => w.sprawa.bazowy.ms!)),
    medianaMsNowa: mediana(zCzasem.map((w) => w.ms!)),
    bliskosc: LOSY.map((los) => {
      /* Para: oba szkice mają treść i jest z czym je porównać. Średnia
         z różnych spraw po każdej stronie porównywałaby sprawy, nie szkice. */
      const pary = p.wyniki.filter((w) => w.sprawa.los === los
        && w.bliskoscBazowa !== null && w.bliskoscNowa !== null);
      return {
        los, par: pary.length,
        bazowa: srednia(pary.map((w) => w.bliskoscBazowa!)),
        nowa: srednia(pary.map((w) => w.bliskoscNowa!)),
      };
    }).filter((b) => b.par > 0),
  };
}

/**
 * Szacunek kosztu przed puszczeniem: tokeny szkiców biura po stawce modelu
 * powtórki. Zgrubny, bo inny model pisze inną liczbę tokenów. Sprawy bez
 * rachunku biura nie wchodzą i ich liczba wraca osobno.
 */
export function wycenaZestawu(sprawy: readonly SprawaZestawu[], model: string): {
  spraw: number; pominietych: number; bezRachunku: number; usd: number;
} {
  const doPuszczenia = sprawy.filter((s) => !s.pominieta);
  const zRachunkiem = doPuszczenia.filter((s) => s.bazowy.zuzycie);
  return {
    spraw: doPuszczenia.length,
    pominietych: sprawy.length - doPuszczenia.length,
    bezRachunku: doPuszczenia.length - zRachunkiem.length,
    usd: Number(zRachunkiem.reduce((s, x) => s + kosztUsd(model, x.bazowy.zuzycie!), 0).toFixed(6)),
  };
}

/** Zdanie o sprawach, które nie poszły do modelu, z powodem każdej grupy. */
export function opisPominietych(pominiete: readonly SprawaZestawu[]): string {
  const ile = (powod: SprawaZestawu["pominieta"]) => pominiete.filter((s) => s.pominieta === powod).length;
  return `Pominiętych, bo mają zdjęcia: ${ile("zdjecia")}.`
    + (ile("maskowanie") ? ` Pominiętych, bo wątek nie przechodzi dzisiejszej kontroli maskowania: ${ile("maskowanie")}.` : "");
}

const proc = (x: number | null): string => (x === null ? "—" : `${Math.round(x * 100)}%`);
const sek = (ms: number | null): string => (ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
const dol = (x: number): string => `${x.toFixed(4).replace(".", ",")} USD`;

const tabela = (naglowki: string[], wiersze: string[][]): string => [
  `| ${naglowki.join(" | ")} |`,
  `|${naglowki.map(() => "---").join("|")}|`,
  ...wiersze.map((w) => `| ${w.join(" | ")} |`),
].join("\n");

/**
 * Raport przebiegu w Markdownie: same liczby i numery wejść, bez treści.
 * Wolno go wkleić do zgłoszenia albo wysłać dalej.
 */
export function raportZestawu(p: Przebieg, o: { model: string; wersja: string; od?: string | null }): string {
  const s = podsumujZestaw(p);
  const odpadlo = (r: Record<string, number>) =>
    Object.entries(r).map(([k, n]) => `${k} × ${n}`).join(", ") || "nic";
  const linie = [
    "# Zestaw testowy Copilota",
    "",
    `Model powtórki: ${o.model}. Instrukcja: ${o.wersja}.${o.od ? ` Sprawy od ${o.od}.` : ""}`,
    `Spraw puszczonych: ${s.spraw}. ${opisPominietych(p.pominiete)}`,
  ];
  if (p.przerwano) {
    linie.push("", `**Przebieg przerwany (${p.przerwano}).** Nie poszło spraw: ${p.niepuszczonych}.`);
  }
  linie.push(
    "", "## Sita", "",
    tabela(["", "przeszło", "odpadło"], [
      ["szkic zapisany", String(s.bazowy.ok), odpadlo(s.bazowy.odpadlo)],
      ["szkic nowy", String(s.nowy.ok), odpadlo(s.nowy.odpadlo)],
    ]),
    "",
    "Oba szkice przesiewa dzisiejszy kod. Błąd dostawcy stoi w tabeli jako „blad” i nie jest zepsuciem.",
    "",
    `Naprawione (zapisany odpadł na sicie, nowy przechodzi): ${s.naprawione.length}`
      + (s.naprawione.length ? ` — wejścia ${s.naprawione.join(", ")}` : ""),
    `Zepsute (zapisany przeszedł, nowy odpada na sicie): ${s.zepsute.length}`
      + (s.zepsute.length ? ` — wejścia ${s.zepsute.join(", ")}` : ""),
    "", "## Koszt i czas", "",
    tabela(["", `koszt (spraw z rachunkiem po obu stronach: ${s.zRachunkiem})`, "mediana czasu"], [
      ["szkic zapisany", dol(s.usdBazowy), sek(s.medianaMsBazowa)],
      ["szkic nowy", dol(s.usdNowy), sek(s.medianaMsNowa)],
    ]),
    "",
    `Cały przebieg kosztował ${dol(s.usdPrzebiegu)}.`,
    "Powtórka bierze wyniki narzędzi z zapisu i nie pobiera zdjęć, więc jej czas bywa krótszy niż w biurze.",
    "", "## Bliskość do odpowiedzi wysłanej klientowi", "",
  );
  if (s.bliskosc.length === 0) {
    linie.push("Brak par: żadna sprawa nie ma wysłanej odpowiedzi i obu szkiców.");
  } else {
    linie.push(
      tabela(["los szkicu zapisanego", "par", "szkic zapisany", "szkic nowy"],
        s.bliskosc.map((b) => [OPIS_LOSU[b.los], String(b.par), proc(b.bazowa), proc(b.nowa)])),
      "",
      "Bliskość to udział wspólnych słów szkicu i wysłanej odpowiedzi.",
      "Przy szkicu wysłanym bez zmian albo po poprawce szkic zapisany wygrywa z definicji:",
      "wysłany tekst powstał z niego. Tam nowy szkic ma być blisko, nie bliżej.",
      "Rozstrzygają wiersze, w których agent napisał odpowiedź sam.",
    );
  }
  linie.push(
    "", "## Sprawy", "",
    tabela(["wejście", "rozmowa", "kategoria", "los", "zapisany", "nowy", "bliskość zap.", "bliskość nowa"],
      p.wyniki.map((w) => [
        String(w.sprawa.wejscie.id), String(w.sprawa.wejscie.conversationId ?? "—"),
        w.sprawa.kategoria ?? "—", OPIS_LOSU[w.sprawa.los],
        etykieta(w.sprawa.bazowy), etykieta(w.nowy), proc(w.bliskoscBazowa), proc(w.bliskoscNowa),
      ])),
    "",
  );
  return linie.join("\n");
}

/**
 * Pary szkiców do czytania przez człowieka: zamaskowana rozmowa, fakty,
 * szkic zapisany i szkic nowy. Wyłącznie to, co już poszło do dostawcy
 * albo od niego wróciło. Odpowiedzi wysłanej klientowi tu nie ma.
 *
 * To jest TREŚĆ rozmów, choć zamaskowana. Plik zostaje na serwerze i znika
 * po przeczytaniu, bo wejście ma retencję 90 dni, a plik nie ma żadnej.
 */
export function paryZestawu(p: Przebieg): string {
  const blok = (t: string | null) => (t === null ? "_(brak: dostawca nie odpowiedział)_" : `\`\`\`\n${t}\n\`\`\``);
  const linie = [
    "# Pary szkiców — treść rozmów, nie wynosić z serwera",
    "",
    "Plik niesie zamaskowane rozmowy klientów. Skasuj go po przeczytaniu.",
    "",
  ];
  for (const w of p.wyniki) {
    linie.push(
      `## Wejście ${w.sprawa.wejscie.id} — ${OPIS_LOSU[w.sprawa.los]}`,
      "",
      `Zapisany: ${etykieta(w.sprawa.bazowy)}. Nowy: ${etykieta(w.nowy)}.`
        + ` Bliskość do wysłanej odpowiedzi: ${proc(w.bliskoscBazowa)} i ${proc(w.bliskoscNowa)}.`,
      "", "### Rozmowa", "", blok(String(w.sprawa.wejscie.watek)),
      "", "### Fakty", "", blok(String(w.sprawa.wejscie.fakty)),
      "", "### Szkic zapisany", "", blok(w.sprawa.bazowy.tresc),
      "", "### Szkic nowy", "", blok(w.tresc),
      "",
    );
  }
  return linie.join("\n");
}
