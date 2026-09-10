import React, { useState } from "react";
import { BookMarked } from "lucide-react";
import {
  useKolejkaWiedzy, useModeleZOpisow, useRozstrzygnijPasowanie, useRozstrzygnijZastosowanie, useSilniki,
  useTokenySilnikow,
  useZaproponujZastosowanie,
} from "../api/wiedza";
import { PropozycjaPasowania } from "../wiedza/PropozycjaPasowania";
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
  const tokeny = useTokenySilnikow();
  /* Jedna liczba pracy na zakładce: sekcje „Modele:" i kartoteki z tokenem
     czekają na tego samego człowieka w tym samym widoku. */
  const zOpisowRazem = (zOpisow.data?.liczba ?? 0) + (tokeny.data?.nowychRazem ?? 0);
  const rozstrzygnij = useRozstrzygnijZastosowanie();
  const rozstrzygnijPasowanie = useRozstrzygnijPasowanie();
  const zaproponuj = useZaproponujZastosowanie();
  const [widok, setWidok] = useState<Widok>("kolejka");
  const [blad, setBlad] = useState("");
  const [wyslano, setWyslano] = useState("");

  const propozycje = kolejka.data?.propozycje ?? [];
  const pasowania = kolejka.data?.pasowania ?? [];

  /* Własny scroller — patrz `Wzmianki`; rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <BookMarked size={18} /><b className="text-naglowek mr-auto">Baza wiedzy zastosowań</b>
      {/* DWIE kolejki, dwa liczniki. Sam licznik zastosowań kłamałby przez
          pominięcie: para maszyna–silnik czeka na tę samą decyzję człowieka. */}
      <span className="text-sm text-slate-500">
        {kolejka.data ? `${kolejka.data.liczba} do rozstrzygnięcia` : "Wczytuję…"}
        {kolejka.data?.pasowanDoRozstrzygniecia ? ` · ${odmienPasowania(kolejka.data.pasowanDoRozstrzygniecia)} do rozstrzygnięcia` : ""}
        {silniki.data?.doRozstrzygniecia ? ` · ${silniki.data.doRozstrzygniecia} silników do rozstrzygnięcia` : ""}</span>
    </Karta>

    <Karta className="overflow-hidden">
      <Zakladki<Widok> wybrana={widok} onWybierz={(w) => { setWidok(w); setBlad(""); setWyslano(""); }} pozycje={[
        { klucz: "kolejka", etykieta: "Kolejka" },
        { klucz: "nowa", etykieta: "Nowa propozycja" },
        { klucz: "kartoteka", etykieta: "Sprawdź kartotekę" },
        { klucz: "z-opisow", etykieta: zOpisowRazem ? `Z opisów (${zOpisowRazem})` : "Z opisów" },
        /* Zakładka liczy LUKI, nagłówek — propozycje. Dwie różne prawdy: luka
           to praca do zrobienia, propozycja to decyzja do podjęcia. */
        { klucz: "silniki", etykieta: silniki.data?.lukiRazem ? `Silniki (${silniki.data.lukiRazem})` : "Silniki" },
      ]} />
      <div className="p-4">
        <Blad>{blad || (kolejka.error as Error | null)?.message}</Blad>

        {widok === "kolejka" && <>
          {!kolejka.isLoading && propozycje.length === 0 && pasowania.length === 0 &&
            <Pusto ikona={<BookMarked size={38} />}>
              Nic nie czeka. Propozycje biorą się z zatwierdzonych doborów, z pomiarów hali i z ręcznych wpisów.
            </Pusto>}
          <div className="space-y-3">
            {propozycje.map((z) => <Propozycja key={z.id} z={z} trwa={rozstrzygnij.isPending}
              onRozstrzygnij={(id, decyzja, powod) => { setBlad("");
                rozstrzygnij.mutate({ id, decyzja, powod }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
          </div>
          {/* DRUGA SEKCJA TEJ SAMEJ KOLEJKI, nie szósta zakładka: `Zakladki` daje
              każdej `flex-1` w jednym wierszu, a szósta łamie etykiety. Ważniejsze:
              to ta sama decyzja („rozstrzygnij") tego samego człowieka. */}
          {pasowania.length > 0 && <section className="mt-4" aria-label="Pasowania części">
            <h3 className="mb-2 text-naglowek font-bold">Pasowania części ({pasowania.length})</h3>
            <div className="space-y-3">
              {pasowania.map((p) => <PropozycjaPasowania key={p.id} p={p} trwa={rozstrzygnijPasowanie.isPending}
                onDecyzja={(decyzja, powod) => { setBlad("");
                  rozstrzygnijPasowanie.mutate({ id: p.id, decyzja, powod }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
            </div>
          </section>}
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

/** „1 pasowanie / 2 pasowania / 5 pasowań" — licznik czyta człowiek, nie parser. */
function odmienPasowania(n: number): string {
  const r10 = n % 10, r100 = n % 100;
  const slowo = n === 1 ? "pasowanie" : r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? "pasowania" : "pasowań";
  return `${n} ${slowo}`;
}
