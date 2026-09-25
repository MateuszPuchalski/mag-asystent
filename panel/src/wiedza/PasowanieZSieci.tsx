import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, Square } from "lucide-react";
import type { PowodOdrzuceniaSieci, WynikPrzebieguSieci } from "../api/typy";
import { kluczeWiedzy, usePasowanieZSieci, useSprawdzZSieci } from "../api/wiedza";
import { Blad, NaglowekSekcji, Przycisk, czas, ile } from "../ui";

/* ── Pasowanie z sieci uruchomione ręcznie (0.508.0) ────────────────────────
   Właściciel chciał zobaczyć automat nocny w pracy bez czekania na 1:00.

   EKRAN PROWADZI PRZEBIEG, kartoteka po kartotece, jak zbiórka „Pasuje do"
   obok: serwer nie trzyma przebiegów w tle. Jedna kartoteka to kilka
   wyszukiwań i przeczytanych stron — pół minuty do dwóch — więc człowiek ma
   widzieć, że idzie, i móc przerwać.

   Sufit to ten sam sufit co w nocy. Ręczny przebieg liczy się do tej samej
   księgi, więc klikanie nie wyda więcej niż jedna noc — i karta mówi wprost,
   ile z niego zostało. Allegro nie jest tu czytane wcale. */

/** Tyle kartotek na jedno kliknięcie. Dość, żeby zobaczyć wynik; mało, żeby przejrzeć. */
export const NA_KLIKNIECIE = 3;

const POWODY: Record<PowodOdrzuceniaSieci, string> = {
  zly_adres: "zły adres",
  allegro: "strona Allegro",
  strona_nieprzeczytana: "strony nie przeczytano",
  cytat_spoza_strony: "cytatu nie ma na stronie",
  model_spoza_cytatu: "modelu nie ma w cytacie",
  marka_spoza_strony: "marki nie ma na stronie",
  numer_spoza_strony: "naszego numeru nie ma na stronie",
  za_krotki_model: "za krótkie oznaczenie",
};

const odrzuty = (o: Partial<Record<PowodOdrzuceniaSieci, number>>) =>
  Object.entries(o).map(([p, n]) => `${POWODY[p as PowodOdrzuceniaSieci] ?? p}: ${n}`).join(", ");

const ZERO: WynikPrzebieguSieci = { sprawdzono: 0, zaproponowano: 0, bledow: 0, odrzucono: {}, przerwane: null };

export function PasowanieZSieci() {
  const qc = useQueryClient();
  const dane = usePasowanieZSieci();
  const sprawdz = useSprawdzZSieci();
  const stop = useRef(false);
  const [trwa, setTrwa] = useState(false);
  const [postep, setPostep] = useState("");
  const [sumy, setSumy] = useState(ZERO);
  const [blad, setBlad] = useState("");

  /* Zejście z ekranu kończy pętlę — żadnych wydatków za plecami człowieka. */
  useEffect(() => () => { stop.current = true; }, []);

  const s = dane.data;
  const zostalo = s ? Math.max(0, s.naNoc - s.sprawdzono) : 0;

  const uruchom = async () => {
    stop.current = false;
    setTrwa(true); setBlad(""); setSumy(ZERO);
    let razem: WynikPrzebieguSieci = { ...ZERO, odrzucono: {} };
    try {
      for (let i = 1; i <= NA_KLIKNIECIE && !stop.current; i++) {
        setPostep(`Szukam w sieci — kartoteka ${i} z ${NA_KLIKNIECIE}…`);
        const { wynik, stan } = await sprawdz.mutateAsync();
        qc.setQueryData(kluczeWiedzy.pasowanieZSieci, stan);
        const odrzucono = { ...razem.odrzucono };
        for (const [p, n] of Object.entries(wynik.odrzucono)) {
          odrzucono[p as PowodOdrzuceniaSieci] = (odrzucono[p as PowodOdrzuceniaSieci] ?? 0) + (n ?? 0);
        }
        razem = { sprawdzono: razem.sprawdzono + wynik.sprawdzono, zaproponowano: razem.zaproponowano + wynik.zaproponowano,
          bledow: razem.bledow + wynik.bledow, odrzucono, przerwane: wynik.przerwane };
        setSumy(razem);
        /* Nic do sprawdzenia, sufit wyczerpany albo dostawca prosi o przerwę —
           kolejne żądanie niczego by nie zmieniło, więc kończymy. */
        if (wynik.przerwane || (wynik.sprawdzono === 0 && wynik.bledow === 0)) break;
      }
    } catch (e) {
      setBlad((e as Error).message);
    } finally {
      setTrwa(false); setPostep("");
      /* Propozycje stanęły w kolejce — odświeżamy wszystko, co z niej czyta. */
      qc.invalidateQueries({ queryKey: ["wiedza"] });
    }
  };

  return <section className="space-y-3 rounded-lg border border-slate-200 p-3" aria-label="Pasowanie z sieci">
    <div>
      <NaglowekSekcji>Pasowanie z sieci</NaglowekSekcji>
      <p className="text-sm text-slate-600">
        Szuka na stronach spoza Allegro, do czego pasują nasze części z numerem OEM, które nie mają jeszcze
        żadnego zastosowania. Znaleziska trafiają do kolejki jako propozycje z linkiem — zatwierdzasz Ty.
        Nocą robi to sam; tu możesz uruchomić go od razu.</p>
    </div>
    {s && <p className="text-sm" aria-label="Stan pasowania z sieci">
      Czeka na sprawdzenie: <b>{ile(s.doSprawdzenia, "kartoteka", "kartoteki", "kartotek")}</b>
      {" "}· sufit: {s.sprawdzono} z {s.naNoc} wykorzystane (zostało <b>{zostalo}</b>)</p>}
    {s?.niegotowy && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700" role="note">{s.niegotowy}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {!trwa
        ? <Przycisk wariant="glowny" disabled={!s || !!s.niegotowy || zostalo === 0 || s.doSprawdzenia === 0}
          onClick={() => void uruchom()}>
          <Globe size={16} />Sprawdź teraz ({ile(Math.min(NA_KLIKNIECIE, zostalo), "kartoteka", "kartoteki", "kartotek")})</Przycisk>
        : <Przycisk onClick={() => { stop.current = true; }}><Square size={14} />Zatrzymaj po tej kartotece</Przycisk>}
      {postep && <span className="text-sm text-slate-600" role="status">{postep}</span>}
    </div>
    {(trwa || sumy.sprawdzono > 0 || sumy.bledow > 0) && <p className="text-sm text-slate-700" aria-label="Wynik pasowania z sieci">
      Sprawdzono {ile(sumy.sprawdzono, "kartotekę", "kartoteki", "kartotek")} · propozycji w kolejce: <b>{sumy.zaproponowano}</b>
      {Object.keys(sumy.odrzucono).length > 0 && <> · odrzuciło sito: {odrzuty(sumy.odrzucono)}</>}
      {sumy.bledow > 0 && <span className="text-red-800"> · błędów: {sumy.bledow}</span>}
      {sumy.przerwane && <span className="text-red-800"> · przerwano: {sumy.przerwane}</span>}</p>}
    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>
    {s && s.ostatnie.length > 0 && <div aria-label="Ostatnio sprawdzone">
      <p className="text-sm font-semibold">Ostatnio sprawdzone</p>
      <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
        {s.ostatnie.map((o, i) => <li key={i}>
          <span className="font-mono">{o.symbol}</span> · {czas(o.at)} · {o.wynik === "blad"
            ? <span className="text-red-800">błąd: {o.blad}</span>
            : <>znalezisk {o.znalezisk}, propozycji {o.zaproponowano}
              {Object.keys(o.odrzucone).length > 0 && <span className="text-slate-600"> (odrzucone: {odrzuty(o.odrzucone)})</span>}</>}
        </li>)}
      </ul>
    </div>}
  </section>;
}
