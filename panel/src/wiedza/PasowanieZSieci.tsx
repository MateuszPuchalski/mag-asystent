import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, Square, Timer } from "lucide-react";
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

/* ── Tryb „przez godzinę" (@wydanie) ─────────────────────────────────────────
   Właściciel po pierwszym dniu: „dodaj przycisk sprawdzaj przez godzinę".
   Klikanie co trzy kartoteki przez godzinę to kilkadziesiąt kliknięć.

   Ta sama pętla, inny warunek końca: czas zamiast licznika. Limit dalej
   obowiązuje — pętla staje, gdy serwer nie ma już czego albo na co sprawdzić,
   i mówi wtedy, że to limit, nie koniec godziny. Bez tego zdania „godzina"
   kończąca się po siedmiu kartotekach wyglądałaby na awarię.

   Ekran dalej prowadzi przebieg, więc zejście z Wiedzy albo zmiana zakładki
   go kończy. Zwinięcie sekcji nie kończy, bo karta zostaje zamontowana. */
export const GODZINA_MS = 60 * 60_000;

type Tryb = { rodzaj: "kilka" } | { rodzaj: "godzina"; koniec: number };

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
  const [koniecPowod, setKoniecPowod] = useState("");
  const [godzinny, setGodzinny] = useState(false);

  /* Zejście z ekranu kończy pętlę — żadnych wydatków za plecami człowieka. */
  useEffect(() => () => { stop.current = true; }, []);

  const s = dane.data;
  const zostalo = s ? Math.max(0, s.naNoc - s.sprawdzono) : 0;

  const uruchom = async (tryb: Tryb) => {
    stop.current = false;
    setTrwa(true); setBlad(""); setSumy(ZERO); setKoniecPowod(""); setGodzinny(tryb.rodzaj === "godzina");
    let razem: WynikPrzebieguSieci = { ...ZERO, odrzucono: {} };
    const dalej = (i: number) => !stop.current
      && (tryb.rodzaj === "kilka" ? i <= NA_KLIKNIECIE : Date.now() < tryb.koniec);
    try {
      for (let i = 1; dalej(i); i++) {
        setPostep(tryb.rodzaj === "kilka"
          ? `Szukam w sieci — kartoteka ${i} z ${NA_KLIKNIECIE}…`
          : `Sprawdzam przez godzinę — kartoteka ${i}, do końca ${Math.max(1, Math.ceil((tryb.koniec - Date.now()) / 60_000))} min…`);
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
           kolejne żądanie niczego by nie zmieniło, więc kończymy. W trybie
           godzinnym mówimy, dlaczego przed czasem (patrz nagłówek). */
        if (wynik.przerwane) break;
        if (wynik.sprawdzono === 0 && wynik.bledow === 0) {
          if (tryb.rodzaj === "godzina") {
            setKoniecPowod(stan.doSprawdzenia === 0
              ? "Skończyłem przed czasem — nie ma już kartotek do sprawdzenia."
              : `Skończyłem przed czasem — wyczerpał się limit (${stan.naNoc} kartotek na 12 godzin). `
                + "Żeby godzina szła dalej, podnieś PASOWANIE_Z_SIECI_NA_NOC w ustawieniach.");
          }
          break;
        }
      }
      if (tryb.rodzaj === "godzina" && stop.current) setKoniecPowod("Zatrzymano przed końcem godziny.");
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
        żadnego zastosowania. Nocą robi to sam; tu możesz uruchomić go od razu.</p>
      {/* GDZIE SZUKAĆ WYNIKU (@wydanie). Właściciel po pierwszym przebiegu
          zapytał, gdzie trafiają propozycje — licznik „w kolejce: 16" nie
          mówił, która to kolejka. Podpis „automat (siec)" jest tym, co stoi
          przy każdej propozycji w Kolejce, więc po nim się ją rozpoznaje. */}
      <p className="text-sm text-slate-600">
        Propozycje czekają w zakładce <b>Kolejka</b>, podpisane „automat (siec)”, z cytatem ze strony
        i linkiem „źródło”. Tam je zatwierdzasz albo odrzucasz — do doboru i Copilota trafiają dopiero po
        zatwierdzeniu.</p>
    </div>
    {/* „Limit", nie „sufit … wykorzystane" (0.510.0): agent pyta, ile może
        jeszcze kliknąć, a nie ile zużyła księga. Skąd limit — w podpowiedzi,
        bo to wiedza na wypadek pytania, nie do czytania co dzień. */}
    {s && <p className="text-sm" aria-label="Stan pasowania z sieci">
      Czeka na sprawdzenie: <b>{ile(s.doSprawdzenia, "kartoteka", "kartoteki", "kartotek")}</b>
      {" "}· <span title="Wspólny z przebiegiem nocnym: ręczne sprawdzenia zużywają ten sam limit.">
        w limicie zostało <b>{zostalo}</b> z {s.naNoc}</span></p>}
    {s?.niegotowy && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700" role="note">{s.niegotowy}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {!trwa
        /* Drugorzędny (0.510.0): karta stoi pod listą, w zwiniętych
           „Importach i zbiórkach", a główny przycisk tej zakładki to
           „Zaproponuj" przy wierszu. Dwa główne obok siebie nie mówią, od
           czego zacząć. */
        ? <>
          <Przycisk disabled={!s || !!s.niegotowy || zostalo === 0 || s.doSprawdzenia === 0}
            onClick={() => void uruchom({ rodzaj: "kilka" })}>
            <Globe size={16} />Sprawdź teraz ({ile(Math.min(NA_KLIKNIECIE, zostalo), "kartoteka", "kartoteki", "kartotek")})</Przycisk>
          {/* Liczba w nawiasie to LIMIT, nie obietnica godziny: przy
              domyślnym limicie godzina kończy się po kilku kartotekach,
              a przycisk ma to mówić, zanim ktoś kliknie. */}
          <Przycisk disabled={!s || !!s.niegotowy || zostalo === 0 || s.doSprawdzenia === 0}
            onClick={() => void uruchom({ rodzaj: "godzina", koniec: Date.now() + GODZINA_MS })}>
            <Timer size={16} />Sprawdzaj przez godzinę (najwyżej {zostalo})</Przycisk>
        </>
        : <Przycisk onClick={() => { stop.current = true; }}><Square size={14} />Zatrzymaj po tej kartotece</Przycisk>}
      {postep && <span className="text-sm text-slate-600" role="status">{postep}</span>}
    </div>
    {trwa && godzinny && <p className="text-xs text-slate-600">
      Nie przechodź na inną zakładkę ani ekran — przebieg idzie z tej karty i zejście go kończy.</p>}
    {koniecPowod && <p className="text-sm text-slate-700" aria-label="Koniec przebiegu">{koniecPowod}</p>}
    {(trwa || sumy.sprawdzono > 0 || sumy.bledow > 0) && <p className="text-sm text-slate-700" aria-label="Wynik pasowania z sieci">
      Sprawdzono {ile(sumy.sprawdzono, "kartotekę", "kartoteki", "kartotek")} · propozycji w kolejce: <b>{sumy.zaproponowano}</b>
      {/* „Pominięte", nie „odrzuciło sito" (0.510.0) — agent nie zna sita.
          Zna tylko to, że znalezisko bez pokrycia na stronie nie weszło. */}
      {Object.keys(sumy.odrzucono).length > 0 && <span
        title="Znaleziska, których strona nie potwierdziła, nie trafiają do kolejki."> · pominięte jako niepewne: {odrzuty(sumy.odrzucono)}</span>}
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
