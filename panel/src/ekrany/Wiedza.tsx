import React, { useState } from "react";
import { BookMarked } from "lucide-react";
import {
  useKolejkaWiedzy, useModeleZOpisow, useRozstrzygnijZastosowanie, useSilniki, useZaproponujZastosowanie,
} from "../api/wiedza";
import { Blad, Karta, Pusto, Zakladki } from "../ui";
import { Propozycja } from "../wiedza/Propozycja";
import { NowaPropozycja } from "../wiedza/NowaPropozycja";
import { WiedzaTowaru } from "../wiedza/WiedzaTowaru";
import { ZOpisow } from "../wiedza/ZOpisow";
import { Silniki } from "../wiedza/Silniki";

/* Baza wiedzy zastosowań (§12, etap E2).

   Pięć widoków jednego ekranu: KOLEJKA propozycji do rozstrzygnięcia (z doboru,
   z pomiaru, ręcznych), NOWA PROPOZYCJA dla wiedzy z katalogów i z głowy
   właściciela, SPRAWDŹ KARTOTEKĘ — co wiemy o części, oraz od E3 Z OPISÓW —
   sekcje „Modele:" z opisów kartotek, które człowiek zamienia na propozycje,
   oraz SILNIKI — które silniki stoją w których maszynach, z listą luk
   ułożoną po częstości pytań.

   Zatwierdza każdy z biura, także autor — decyzja właściciela. Automat nigdy:
   propozycja z zatwierdzonego doboru ląduje TU, nie w wiedzy.

   Otwarcie ekranu niczego nie zapisuje — „zero zapisu przy patrzeniu". */
type Widok = "kolejka" | "nowa" | "kartoteka" | "z-opisow" | "silniki";

export function Wiedza() {
  const kolejka = useKolejkaWiedzy();
  const zOpisow = useModeleZOpisow();
  const silniki = useSilniki();
  const rozstrzygnij = useRozstrzygnijZastosowanie();
  const zaproponuj = useZaproponujZastosowanie();
  const [widok, setWidok] = useState<Widok>("kolejka");
  const [blad, setBlad] = useState("");
  const [wyslano, setWyslano] = useState("");

  const propozycje = kolejka.data?.propozycje ?? [];

  /* Własny scroller — patrz `Wzmianki`; rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <BookMarked size={18} /><b className="mr-auto">Baza wiedzy zastosowań</b>
      {/* DWIE kolejki, dwa liczniki. Sam licznik zastosowań kłamałby przez
          pominięcie: para maszyna–silnik czeka na tę samą decyzję człowieka. */}
      <span className="text-sm text-slate-500">
        {kolejka.data ? `${kolejka.data.liczba} do rozstrzygnięcia` : "Wczytuję…"}
        {silniki.data?.doRozstrzygniecia ? ` · ${silniki.data.doRozstrzygniecia} silników do rozstrzygnięcia` : ""}</span>
    </Karta>

    <Karta className="overflow-hidden">
      <Zakladki<Widok> wybrana={widok} onWybierz={(w) => { setWidok(w); setBlad(""); setWyslano(""); }} pozycje={[
        { klucz: "kolejka", etykieta: "Kolejka" },
        { klucz: "nowa", etykieta: "Nowa propozycja" },
        { klucz: "kartoteka", etykieta: "Sprawdź kartotekę" },
        { klucz: "z-opisow", etykieta: zOpisow.data?.liczba ? `Z opisów (${zOpisow.data.liczba})` : "Z opisów" },
        /* Zakładka liczy LUKI, nagłówek — propozycje. Dwie różne prawdy: luka
           to praca do zrobienia, propozycja to decyzja do podjęcia. */
        { klucz: "silniki", etykieta: silniki.data?.lukiRazem ? `Silniki (${silniki.data.lukiRazem})` : "Silniki" },
      ]} />
      <div className="p-4">
        <Blad>{blad || (kolejka.error as Error | null)?.message}</Blad>

        {widok === "kolejka" && <>
          {!kolejka.isLoading && propozycje.length === 0 &&
            <Pusto ikona={<BookMarked size={38} />}>
              Nic nie czeka. Propozycje biorą się z zatwierdzonych doborów, z pomiarów hali i z ręcznych wpisów.
            </Pusto>}
          <div className="space-y-3">
            {propozycje.map((z) => <Propozycja key={z.id} z={z} trwa={rozstrzygnij.isPending}
              onRozstrzygnij={(id, decyzja, powod) => { setBlad("");
                rozstrzygnij.mutate({ id, decyzja, powod }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
          </div>
        </>}

        {widok === "nowa" && <>
          {wyslano && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{wyslano}</p>}
          <NowaPropozycja trwa={zaproponuj.isPending} blad={blad}
            onWyslij={(p) => { setBlad(""); setWyslano("");
              zaproponuj.mutate(p, {
                onSuccess: (z) => setWyslano(`Propozycja ${z.symbol} → ${z.model.etykieta} czeka w kolejce.`),
                onError: (e) => setBlad((e as Error).message),
              }); }} />
        </>}

        {widok === "kartoteka" && <WiedzaTowaru />}
        {widok === "z-opisow" && <ZOpisow />}
        {widok === "silniki" && <Silniki />}
      </div>
    </Karta>
  </div>;
}
