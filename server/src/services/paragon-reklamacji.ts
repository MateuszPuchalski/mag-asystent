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
  /**
   * `null`, gdy kartoteki nie ma w kopii Subiekta. Zastępczy symbol udawałby
   * symbol z dokumentu, a agent przepisałby go do zgłoszenia u dostawcy.
   */
  symbol: string | null;
  nazwa: string | null;
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
 * NAJPIERW ODEJMOWANIE, potem wybór. Inne oferty zamówienia zabierają swoje
 * sztuki tą samą regułą co komplet, a wybierać wolno tylko z reszty. Bez tego
 * jedyny towar na paragonie albo kandydat z mapowania wygrywał, choć należał
 * do cudzej oferty. Kandydat zabrany w całości przez inną ofertę nie wygra.
 *
 * Bez kopii zamówienia albo bez naszej oferty w niej odpowiedzią jest `null`.
 * Nie wiemy wtedy, co jeszcze było na dokumencie, więc reszta byłaby zgadywaniem.
 *
 * Pozycję liczymy po kartotece, nie po dokumencie. Faktura do paragonu
 * niesie ten sam towar drugi raz, a to wciąż jedna rzecz.
 */
function wskazSporna(
  database: Db, dokumenty: DokumentParagonu[], s: SprawaParagonu,
): number | null {
  if (!s.orderId || !s.offerId) return null;
  /* Przesyłka się nie liczy: nie da się jej reklamować jako towaru.
     Dokumenty sumują się razem, bo zamówienie bywa rozbite na dwa paragony.
     Faktura do paragonu podwaja wtedy sztuki, reszta rośnie i wybór milczy,
     a to jest wynik bezpieczny. */
  const naDokumentach = new Map<number, number>();
  for (const d of dokumenty) {
    for (const p of d.pozycje) {
      if (p.usluga) continue;
      naDokumentach.set(p.twId, (naDokumentach.get(p.twId) ?? 0) + p.ilosc);
    }
  }
  const odjete = odejmijInneOferty(database, s.konto, s.orderId, s.offerId, naDokumentach);
  if (!odjete || !odjete.oferty.some((o) => o.offer_id === s.offerId)) return null;
  const pozostale = [...odjete.zostalo.keys()];

  /* Kandydat oferty wśród reszty. Dwóch naraz to sprzeczność mapowania
     z sygnaturą, więc ten krok milczy. */
  const kandydaci = new Set(s.kandydaci.filter((k): k is number => k !== null));
  const trafione = pozostale.filter((t) => kandydaci.has(t));
  if (trafione.length === 1) return trafione[0];

  /* Jedyna reszta jest nasza tylko wtedy, gdy żadna INNA oferta nie została
     bez kartoteki. Cudza oferta bez kartoteki mogła być właśnie tą resztą. */
  const obcaBezKartoteki = odjete.bezKartoteki.some((o) => o !== s.offerId);
  if (pozostale.length === 1 && !obcaBezKartoteki) return pozostale[0];
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
