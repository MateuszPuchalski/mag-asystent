import React, { useState } from "react";
import { BookMarked } from "lucide-react";
import { useKolejkaWiedzy, useRozstrzygnijZastosowanie, useZaproponujZastosowanie } from "../api/wiedza";
import { Blad, Karta, Pusto, Zakladki } from "../ui";
import { Propozycja } from "../wiedza/Propozycja";
import { NowaPropozycja } from "../wiedza/NowaPropozycja";
import { WiedzaTowaru } from "../wiedza/WiedzaTowaru";

/* Baza wiedzy zastosowań (§12, etap E2).

   Trzy widoki jednego ekranu: KOLEJKA propozycji do rozstrzygnięcia (z doboru,
   z pomiaru, ręcznych), NOWA PROPOZYCJA dla wiedzy z katalogów i z głowy
   właściciela oraz SPRAWDŹ KARTOTEKĘ — co wiemy o części.

   Zatwierdza każdy z biura, także autor — decyzja właściciela. Automat nigdy:
   propozycja z zatwierdzonego doboru ląduje TU, nie w wiedzy.

   Otwarcie ekranu niczego nie zapisuje — „zero zapisu przy patrzeniu". */
type Widok = "kolejka" | "nowa" | "kartoteka";

export function Wiedza() {
  const kolejka = useKolejkaWiedzy();
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
      <span className="text-sm text-slate-500">
        {kolejka.data ? `${kolejka.data.liczba} do rozstrzygnięcia` : "Wczytuję…"}</span>
    </Karta>

    <Karta className="overflow-hidden">
      <Zakladki<Widok> wybrana={widok} onWybierz={(w) => { setWidok(w); setBlad(""); setWyslano(""); }} pozycje={[
        { klucz: "kolejka", etykieta: "Kolejka" },
        { klucz: "nowa", etykieta: "Nowa propozycja" },
        { klucz: "kartoteka", etykieta: "Sprawdź kartotekę" },
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
      </div>
    </Karta>
  </div>;
}
