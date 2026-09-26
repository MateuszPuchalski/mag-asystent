import React, { useState } from "react";
import { BookMarked } from "lucide-react";
import {
  useKolejkaWiedzy, useModeleZOpisow, useRozstrzygnijPasowanie, useRozstrzygnijZamiennosc,
  useRozstrzygnijZastosowanie, useSilniki,
  useTokenySilnikow,
  useZaproponujZastosowanie, useZatwierdzZSieci, useZatwierdzZWykazu,
} from "../api/wiedza";
import { PrzegladWykazu } from "../wiedza/PrzegladWykazu";
import { PrzegladZSieci } from "../wiedza/PrzegladZSieci";
import { PropozycjaPasowania } from "../wiedza/PropozycjaPasowania";
import { KandydatZamiennosci } from "../wiedza/KandydatZamiennosci";
import { Blad, Karta, Pusto, Zakladki, ile } from "../ui";
import { Propozycja } from "../wiedza/Propozycja";
import { NowaPropozycja } from "../wiedza/NowaPropozycja";
import { WiedzaTowaru } from "../wiedza/WiedzaTowaru";
import { ZOpisow } from "../wiedza/ZOpisow";
import { Silniki } from "../wiedza/Silniki";
import { Siec } from "../wiedza/Siec";
import type { Towar } from "../wyszukiwarka";

/* Baza wiedzy zastosowań (§12, etap E2).

   Sześć widoków jednego ekranu: KOLEJKA propozycji do rozstrzygnięcia (z doboru,
   z pomiaru, ręcznych), NOWA PROPOZYCJA dla wiedzy z katalogów i z głowy
   właściciela, SPRAWDŹ KARTOTEKĘ — co wiemy o części, oraz od E3 Z OPISÓW —
   sekcje „Modele:" z opisów kartotek, które człowiek zamienia na propozycje,
   oraz SILNIKI — które silniki stoją w których maszynach, z listą luk
   ułożoną po częstości pytań. SIEĆ dochodzi jako szósty: pasowania,
   zastosowania, silniki i zamienniki na jednym obrazku, bez żadnego zapisu.

   Zatwierdza każdy z biura, także autor — decyzja właściciela. Automat nigdy:
   propozycja z zatwierdzonego doboru ląduje TU, nie w wiedzy.

   Otwarcie ekranu niczego nie zapisuje — „zero zapisu przy patrzeniu". */
type Widok = "kolejka" | "nowa" | "kartoteka" | "z-opisow" | "silniki" | "siec";

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
  const rozstrzygnijZamiennosc = useRozstrzygnijZamiennosc();
  const zaproponuj = useZaproponujZastosowanie();
  const zatwierdzZWykazu = useZatwierdzZWykazu();
  const zatwierdzZSieci = useZatwierdzZSieci();
  const [widok, setWidok] = useState<Widok>("kolejka");
  const [blad, setBlad] = useState("");
  const [wyslano, setWyslano] = useState("");
  /* Kartoteka wskazana w sieci. Przejście do „Sprawdź kartotekę" niesie ją
     ze sobą, bo szukanie tego samego symbolu drugi raz to czysta strata. */
  const [zSieci, setZSieci] = useState<Towar | null>(null);

  /* Propozycje z wykazów części idą przeglądem listą; pojedyncze karty
     dostaje wyłącznie reszta. Każda propozycja stoi na ekranie RAZ. */
  const wykazy = kolejka.data?.wykazy ?? [];
  /* Propozycje automatu z sieci (@wydanie) — ta sama zasada: przegląd listą
     po kartotece, a pojedyncza karta tylko dla reszty. */
  const przegladySieci = kolejka.data?.zSieci ?? [];
  const wPrzegladzie = new Set([...wykazy.flatMap((w) => w.pozycje.map((p) => p.id)),
    ...przegladySieci.flatMap((g) => g.pozycje.map((p) => p.id))]);
  const propozycje = (kolejka.data?.propozycje ?? []).filter((z) => !wPrzegladzie.has(z.id));
  const pasowania = kolejka.data?.pasowania ?? [];
  const zamiennosci = kolejka.data?.zamiennosciOem ?? [];
  /* Liczniki z serwera, nie długości list: lista par bywa przycięta, licznik
     mówi o całej pracy. Silniki doliczają się, gdy ich odczyt już wrócił. */
  const doDecyzji = kolejka.data
    ? kolejka.data.liczba + kolejka.data.pasowanDoRozstrzygniecia
      + (kolejka.data.zamiennosciOemDoRozstrzygniecia ?? zamiennosci.length)
      + (silniki.data?.doRozstrzygniecia ?? 0)
    : null;

  /* Własny scroller — patrz `Wzmianki`; rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <BookMarked size={18} /><b className="text-naglowek mr-auto">Baza wiedzy zastosowań</b>
      {/* JEDNA suma, nie cztery liczniki (0.510.0). Nagłówek niósł cztery
          liczby, a trzy z nich powtarzały nagłówki sekcji i zakładki niżej.
          Suma bierze wszystkie decyzje, bo licznik samych zastosowań kłamałby
          przez pominięcie: para maszyna–silnik czeka na tego samego człowieka. */}
      <span className="text-sm text-slate-500">
        {doDecyzji === null ? "Wczytuję…" : `${doDecyzji} do rozstrzygnięcia`}</span>
    </Karta>

    <Karta className="overflow-hidden">
      <Zakladki<Widok> wybrana={widok} onWybierz={(w) => { setWidok(w); setBlad(""); setWyslano(""); }} pozycje={[
        { klucz: "kolejka", etykieta: "Kolejka" },
        { klucz: "nowa", etykieta: "Nowa propozycja" },
        { klucz: "kartoteka", etykieta: "Sprawdź kartotekę" },
        /* „i ofert" od 0.264.0: ta sama kolejka niesie odtąd pozycje list
           zgodności z naszych ofert Allegro, a etykieta mówiąca tylko o opisach
           kazałaby szukać ich gdzie indziej. */
        /* Liczba w `ile`, nie doklejona do etykiety (0.510.0): ten sam
           kształt licznika co w kubełkach zwrotów, a zero mówi „nic tu nie ma"
           bez klikania. Przed odczytem licznika nie ma — zero byłoby kłamstwem. */
        { klucz: "z-opisow", etykieta: "Z opisów i ofert", ile: zOpisow.data ? zOpisowRazem : undefined },
        /* Zakładka liczy LUKI, nagłówek — decyzje. Dwie różne prawdy: luka
           to praca do zrobienia, propozycja to decyzja do podjęcia. */
        { klucz: "silniki", etykieta: "Silniki", ile: silniki.data?.lukiRazem },
        /* Szósta zakładka, choć pasowania w kolejce szóstej nie dostały.
           Tamte to ta sama decyzja co zastosowania, więc zostały w kolejce.
           Sieć to inny widok, nie inna decyzja. Zrzut przy 1024 px mieści
           sześć etykiet w rzędzie; na telefonie rząd wychodzi za kadr,
           tak jak górna nawigacja panelu, bo biuro pracuje przy biurku. */
        { klucz: "siec", etykieta: "Sieć" },
      ]} />
      <div className="p-4">
        <Blad>{blad || (kolejka.error as Error | null)?.message}</Blad>

        {widok === "kolejka" && <>
          {!kolejka.isLoading && propozycje.length === 0 && wykazy.length === 0 && przegladySieci.length === 0
            && pasowania.length === 0 && zamiennosci.length === 0 &&
            <Pusto ikona={BookMarked}>
              Nic nie czeka. Propozycje biorą się z zatwierdzonych doborów, z pomiarów hali i z ręcznych wpisów.
            </Pusto>}
          {wyslano && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{wyslano}</p>}
          {wykazy.length > 0 && <div className="mb-3 space-y-3">
            {wykazy.map((w) => <PrzegladWykazu key={w.id} w={w} trwa={zatwierdzZWykazu.isPending || rozstrzygnij.isPending}
              onZatwierdz={(ids) => { setBlad(""); setWyslano("");
                zatwierdzZWykazu.mutate({ importId: w.id, ids }, {
                  onSuccess: (r) => setWyslano(`Zatwierdzono ${ile(r.zatwierdzono, "propozycję", "propozycje", "propozycji")}`
                    + ` z wykazu „${w.zrodlo}”.`
                    + (r.pominieto > 0 ? ` ${r.pominieto} rozstrzygnął w międzyczasie ktoś inny — tych lista nie ruszyła.` : "")),
                  onError: (e) => setBlad((e as Error).message),
                }); }}
              onOdrzuc={(id, powod) => { setBlad("");
                rozstrzygnij.mutate({ id, decyzja: "odrzuc", powod }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
          </div>}
          {przegladySieci.length > 0 && <div className="mb-3 space-y-3">
            {przegladySieci.map((g) => <PrzegladZSieci key={g.twId} p={g}
              trwa={zatwierdzZSieci.isPending || rozstrzygnij.isPending}
              onZatwierdz={(ids) => { setBlad(""); setWyslano("");
                zatwierdzZSieci.mutate({ twId: g.twId, ids }, {
                  onSuccess: (r) => setWyslano(`Zatwierdzono ${ile(r.zatwierdzono, "maszynę", "maszyny", "maszyn")}`
                    + ` dla ${g.symbol}.`
                    + (r.pominieto > 0 ? ` ${r.pominieto} rozstrzygnął w międzyczasie ktoś inny — tych lista nie ruszyła.` : "")),
                  onError: (e) => setBlad((e as Error).message),
                }); }}
              onOdrzuc={(id, powod) => { setBlad("");
                rozstrzygnij.mutate({ id, decyzja: "odrzuc", powod }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
          </div>}
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
          {/* TRZECIA SEKCJA tej samej kolejki, z tego samego powodu co druga:
              ta sama decyzja tego samego człowieka. Zdanie nad listą mówi,
              czego szukać, bo pomiar na seedzie znalazł dokładnie te trzy
              pułapki — a wiedza przed kliknięciem kosztuje mniej niż wycofanie. */}
          {zamiennosci.length > 0 && <section className="mt-4" aria-label="Wspólny numer oryginału">
            <h3 className="text-naglowek font-bold">Wspólny numer oryginału ({zamiennosci.length})</h3>
            <p className="mb-2 text-sm text-slate-600">
              Dwie kartoteki wskazują ten sam numer OEM. Zamienne zwykle są — ale nie lewy z prawym, nie zestaw
              ze swoją nakrętką i nie filtr wstępny z głównym. Porównaj nazwy.</p>
            <div className="space-y-3">
              {zamiennosci.map((k) => <KandydatZamiennosci key={`${k.a.twId}~${k.b.twId}`} k={k}
                trwa={rozstrzygnijZamiennosc.isPending}
                onDecyzja={(decyzja, powod) => { setBlad("");
                  rozstrzygnijZamiennosc.mutate({ twA: k.a.twId, twB: k.b.twId, decyzja, powod },
                    { onError: (e) => setBlad((e as Error).message) }); }} />)}
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

        {widok === "kartoteka" && <WiedzaTowaru key={zSieci?.id ?? 0} poczatkowy={zSieci} />}
        {widok === "z-opisow" && <ZOpisow />}
        {widok === "silniki" && <Silniki />}
        {widok === "siec" && <Siec onOtworzKartoteke={(k) => {
          setZSieci({ id: k.twId, sym: k.symbol, name: k.nazwa, locs: [] });
          setWidok("kartoteka");
        }} />}
      </div>
    </Karta>
  </div>;
}

/* Reguła trzech form przeniosła się do `ui/odmien` (audyt, 15 września 2026).
   Stała tutaj jako jedyna poprawna kopia w całym panelu — i właśnie dlatego,
   że stała w ekranie, nikt jej nie znalazł przy ośmiu pozostałych miejscach. */
