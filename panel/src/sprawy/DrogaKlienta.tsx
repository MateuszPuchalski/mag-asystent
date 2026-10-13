import React from "react";
import { useDrogaSprawy } from "../api/droga";
import type { OdpowiedzDrogi } from "../api/typy";
import { Blad } from "../ui";
import { DrogaSprawy, Numer, type BiezacaSprawa } from "../reklamacje/DrogaSprawy";

/* ── PASEK DROGI KLIENTA NA EKRANIE SPRAWY ───────────────────────────────────
   Cienka powłoka: pobiera drogę po numerze zamówienia i oddaje ją jednemu
   paskowi, tak samo na zwrotach, dyskusjach, w skrzynce i na profilu.
   Reklamacje karmią pasek własnym szczegółem i tej powłoki nie używają.

   NIC NIE ZAPISUJE. „Sprawdź" przesyłkę pyta Allegro, więc zostaje na ekranie
   reklamacji, a tu pasek tylko czyta: otwarcie ekranu ma nie mutować.

   BŁĄD JEST BŁĘDEM. Pasek, który po awarii serwera znika albo kończy się na
   doręczeniu, mówiłby agentowi „klient nie miał żadnych spraw". Brak
   numeru zamówienia to co innego: tej sprawy nie ma do czego przypiąć,
   więc nie rysujemy nic. */

/* Odpowiedź bez list nie jest drogą (starszy serwer, atrapa, śmieć z proxy).
   Czytamy ją jak brak, bo wyjątek w pasku nie ma prawa zabrać ekranu,
   na którym agent odpisuje klientowi. */
const jestDroga = (d: OdpowiedzDrogi | undefined): d is OdpowiedzDrogi =>
  Boolean(d) && Array.isArray(d!.droga) && Array.isArray(d!.sprawy);

export function DrogaKlienta({ orderId, linkZamowienia, biezaca, bezNumerow = false, bezPrzesylki = false, plaska = false }: {
  orderId: string | null | undefined;
  /** Odnośnik do Allegro, jeśli ekran zna go przed wczytaniem drogi; bez niego sam numer i kopiowanie. */
  linkZamowienia?: string | null;
  biezaca?: BiezacaSprawa;
  /** Ekran sam pokazuje numer zamówienia i przesyłki, więc pasek ich nie powtarza. */
  bezNumerow?: boolean;
  /** Ekran sam pokazuje numer listu przewozowego; numer zamówienia zostaje na pasku. */
  bezPrzesylki?: boolean;
  plaska?: boolean;
}) {
  const numer = orderId ? orderId : null;
  const droga = useDrogaSprawy(numer);
  if (numer === null) return null;
  /* Numer zamówienia mieszka w kroku Zakup paska. Gdy pasek się wczytuje albo
     padł, ekran, który numeru sam nie pokazuje, zostałby bez niego, a agent
     nie mógłby go skopiować ani otworzyć zamówienia. Na szczęśliwej ścieżce
     tego wiersza nie ma: numer stoi wtedy tylko w pasku. */
  const numerZastepczy = bezNumerow ? null
    : <div className="px-4 pb-1"><Numer numer={numer} href={linkZamowienia} nazwa="Zamówienie"
        tytulKopii="Kopiuj numer zamówienia" /></div>;
  if (droga.error) {
    return <>
      <div role="alert" className="px-4 py-2 text-xs">
        <Blad>Nie udało się wczytać drogi klienta: {(droga.error as Error).message}</Blad></div>
      {numerZastepczy}</>;
  }
  if (droga.isLoading) {
    return <>
      <p role="status" className={`text-xs text-slate-600 ${plaska ? "pb-1" : "px-5 py-3"}`}>
        Wczytuję drogę klienta…</p>
      {numerZastepczy}</>;
  }
  if (!jestDroga(droga.data)) return null;
  return <DrogaSprawy dane={droga.data} biezaca={biezaca} bezNumerow={bezNumerow}
    bezPrzesylki={bezPrzesylki} plaska={plaska} />;
}
