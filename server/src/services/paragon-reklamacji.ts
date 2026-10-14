import { config } from "../config.js";
import type { Db } from "../db/db.js";
import { dokumentySprzedazyZId } from "./faktury.js";
import { odejmijInneOferty, wierszeDokumentuSprzedazy } from "./komplety.js";

/* ── Paragon zamówienia w reklamacji ─────────────────────────────────────────
   Prośba właściciela: w reklamacji ma być widać, jaki towar klient
   RZECZYWIŚCIE kupił, z symbolem wziętym z paragonu albo faktury zamówienia.

   DOKUMENT ALBO NIC. Bez dokumentu Subiekta serwer mówi „brak paragonu"
   i podaje powód; nie podstawia symbolu z oferty, mapowania ani SKU Allegro.
   Te źródła mówią, na co oferta wskazuje dziś albo co wpisał sprzedawca,
   a reklamację rozstrzyga to, co wydał magazyn. Pomylony symbol odsyła
   reklamację do złego dostawcy.

   Z dokumentem idzie CAŁY dokument, bo agent porównuje go z paragonem, który
   przysłał klient. Sporna pozycja jest wyróżniona tylko wtedy, gdy wskazanie
   jest jednoznaczne. Wyróżnienie zgadnięte jest gorsze od braku wyróżnienia:
   agent przestaje wtedy czytać resztę dokumentu.

   Prywatność: dokument niesie numer, typ, datę i towary, bez kontrahenta.
   Czysty odczyt — szczegół reklamacji otwiera się bez zapisu.               */

export interface PozycjaParagonu {
  twId: number;
  symbol: string;
  nazwa: string;
  /** Suma po kartotece w tym dokumencie. */
  ilosc: number;
  /** Pozycja usługowa (`pomijane.ts`), np. przesyłka. */
  usluga: boolean;
  /** To jest reklamowany towar. */
  sporna: boolean;
}

export interface DokumentParagonu {
  dokId: number;
  numer: string;
  typ: "FS" | "PA";
  data: string;
  pozycje: PozycjaParagonu[];
}

export type BrakParagonu = "bez-zamowienia" | "poza-oknem" | "nie-znaleziono";

export interface ParagonReklamacji {
  /** FS i PA tego zamówienia z okna, od najstarszego. Korekty nie wchodzą. */
  dokumenty: DokumentParagonu[];
  /** Kartoteka spornej pozycji, gdy wskazana jednoznacznie. */
  spornaTwId: number | null;
  /** Gdy `dokumenty` puste: dlaczego. */
  brak: BrakParagonu | null;
  /** Okno read-modelu w dniach, do zdania w panelu. */
  oknoDni: number;
}

/** Co o sprawie trzeba wiedzieć, żeby znaleźć dokument i sporną pozycję. */
export interface SprawaParagonu {
  konto: number;
  orderId: string | null;
  offerId: string | null;
  kupionoAt: string | null;
  /**
   * Kartoteki, które sprawa przypisuje ofercie: mapowanie oferty i unikalna
   * sygnatura z pozycji zamówienia. To kandydaci, nie odpowiedź — rozstrzyga
   * dopiero obecność na dokumencie.
   */
  kandydaci: Array<number | null>;
}

/**
 * Która kartoteka dokumentów jest reklamowanym towarem; `null` = nie wiadomo.
 *
 * Trzy kroki od najpewniejszego, każdy przyjmuje wyłącznie JEDNO trafienie.
 * Pozycję liczymy po kartotece, nie po dokumencie. Faktura do paragonu
 * niesie ten sam towar drugi raz, a to wciąż jedna rzecz, nie dwie.
 */
function wskazSporna(
  database: Db, dokumenty: DokumentParagonu[], s: SprawaParagonu,
): number | null {
  const naDokumentach = new Map<number, number>();
  for (const d of dokumenty) {
    for (const p of d.pozycje) {
      if (p.usluga) continue;
      naDokumentach.set(p.twId, (naDokumentach.get(p.twId) ?? 0) + p.ilosc);
    }
  }
  const towary = [...naDokumentach.keys()];

  /* Jedyny towar na dokumentach to ten, który klient reklamuje. Przesyłka
     się nie liczy: jej nie da się reklamować jako towaru. */
  if (towary.length === 1) return towary[0];

  /* Kandydat obecny na dokumencie. Dwa kandydaci obecni naraz to sprzeczność
     mapowania z sygnaturą, więc ten krok milczy i oddaje głos odejmowaniu. */
  const kandydaci = new Set(s.kandydaci.filter((k): k is number => k !== null));
  const trafione = towary.filter((t) => kandydaci.has(t));
  if (trafione.length === 1) return trafione[0];

  /* Odejmowanie tą samą regułą co komplet: inne oferty zamówienia zabierają
     swoje sztuki. Dwie oferty bez kartoteki znaczą podział nie do zgadnięcia.
     Dokumenty sumują się razem, bo zamówienie bywa rozbite na dwa paragony.
     Faktura do paragonu podwaja wtedy sztuki i odejmowanie milczy, a to jest
     wynik bezpieczny. */
  if (s.orderId && s.offerId) {
    const odjete = odejmijInneOferty(database, s.konto, s.orderId, s.offerId, naDokumentach);
    if (odjete && odjete.bezKartoteki.length <= 1 && odjete.zostalo.size === 1) {
      return [...odjete.zostalo.keys()][0];
    }
  }
  return null;
}

/**
 * Dokumenty sprzedaży zamówienia reklamacji z pozycjami i sporną pozycją.
 *
 * Powód braku rozróżnia trzy sytuacje, bo każda wysyła agenta gdzie indziej:
 * bez zamówienia nie ma czego szukać; zakup sprzed okna read-modelu ma
 * dokument tylko w samym Subiekcie; w oknie dokumentu jeszcze nie wystawiono
 * albo nie niesie numeru zamówienia.
 */
export function paragonReklamacji(
  database: Db, s: SprawaParagonu, teraz = Date.now(),
): ParagonReklamacji {
  const oknoDni = config.mssql.fakturyDniWstecz;
  const pusty = (brak: BrakParagonu): ParagonReklamacji =>
    ({ dokumenty: [], spornaTwId: null, brak, oknoDni });
  if (!s.orderId) return pusty("bez-zamowienia");

  const dokumenty: DokumentParagonu[] = dokumentySprzedazyZId(s.orderId, s.kupionoAt, database, teraz)
    .map((d) => ({
      dokId: d.dokId,
      numer: d.numer,
      /* Zapytanie bierze wyłącznie FS i PA, więc innego typu tu nie ma. */
      typ: d.typ === "FS" ? "FS" : "PA",
      data: d.data,
      pozycje: wierszeDokumentuSprzedazy(database, d.dokId)
        .map((p) => ({ ...p, sporna: false })),
    }));

  if (dokumenty.length === 0) {
    /* Read-model sięga `oknoDni` od dziś, więc starszego zakupu w nim nie ma.
       Bez daty zakupu nie wiemy tego, więc mówimy „nie znaleziono". */
    const kupiono = s.kupionoAt ? Date.parse(s.kupionoAt) : Number.NaN;
    const pozaOknem = Number.isFinite(kupiono) && kupiono < teraz - oknoDni * 86_400_000;
    return pusty(pozaOknem ? "poza-oknem" : "nie-znaleziono");
  }

  const spornaTwId = wskazSporna(database, dokumenty, s);
  if (spornaTwId !== null) {
    for (const d of dokumenty) for (const p of d.pozycje) p.sporna = p.twId === spornaTwId;
  }
  return { dokumenty, spornaTwId, brak: null, oknoDni };
}
