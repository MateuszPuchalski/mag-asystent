import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, Square } from "lucide-react";
import type { PowodOdrzuceniaSieci, WynikPrzebieguSieci } from "../api/typy";
import { kluczeWiedzy, usePasowanieZSieci, useSprawdzZSieci } from "../api/wiedza";
import { Blad, NaglowekSekcji, Przycisk, czas, ile } from "../ui";

/* ── Szukanie w sieci uruchomione ręcznie ───────────────────────────────────
   0.508.0: właściciel chciał zobaczyć automat nocny w pracy bez czekania
   na 1:00. 0.527.0: „dodaj przycisk sprawdzaj przez godzinę”.

   JEDEN PRZYCISK (0.528.0), decyzją właściciela: „uprość w użytkowaniu”.
   Były dwa — „Sprawdź teraz (3)” i „Sprawdzaj przez godzinę” — i pytanie,
   który kliknąć, było jedyną decyzją, jaką karta stawiała. Zostaje godzina
   z przyciskiem „Zatrzymaj”, bo trzy kartoteki to też godzina przerwana
   po trzech. Mniej decyzji wygrywa spór o kształt ekranu.

   WŁASNY LIMIT NA GODZINĘ (0.528.0). Ręczne szukanie zużywało limit nocy
   i godzina kończyła się po kilku kartotekach z radą „podnieś
   PASOWANIE_Z_SIECI_NA_NOC”. Żeby kliknąć, trzeba było zmienić ustawienie.
   Serwer liczy teraz ręczne szukanie w oknie godziny (`RECZNIE_NA_GODZINE`),
   więc godzina idzie godzinę.

   EKRAN PROWADZI PRZEBIEG, kartoteka po kartotece, jak zbiórka „Pasuje do”:
   serwer nie trzyma przebiegów w tle. Zejście z Wiedzy albo zmiana zakładki
   go kończy — żadnych wydatków za plecami człowieka. Allegro nie jest tu
   czytane wcale; OLX i Ceneo też nie (reguła SZPERACZA). */
export const GODZINA_MS = 60 * 60_000;

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

  useEffect(() => () => { stop.current = true; }, []);

  const s = dane.data;
  /* Starszy serwer nie zna limitu ręcznego — wtedy mówi limit nocy, jak dawniej. */
  const limit = s ? (s.reczne ? s.reczne.naGodzine : s.naNoc) : 0;
  const zostalo = s ? Math.max(0, limit - (s.reczne ? s.reczne.wGodzinie : s.sprawdzono)) : 0;
  const nieMoze = !s || !!s.niegotowy || zostalo === 0 || s.doSprawdzenia === 0;
  /* Treść ostatniego błędu (@wydanie). Samo „błędów: 3” nie mówi, czy to
     klucz, limit dostawcy, czy strona za duża — a od tego zależy, co zrobić. */
  const ostatniBlad = s?.ostatnie.find((o) => o.wynik === "blad") ?? null;

  const uruchom = async () => {
    const koniec = Date.now() + GODZINA_MS;
    stop.current = false;
    setTrwa(true); setBlad(""); setSumy(ZERO); setKoniecPowod("");
    let razem: WynikPrzebieguSieci = { ...ZERO, odrzucono: {} };
    try {
      for (let i = 1; !stop.current && Date.now() < koniec; i++) {
        setPostep(`Szukam — kartoteka ${i}, do końca ${Math.max(1, Math.ceil((koniec - Date.now()) / 60_000))} min…`);
        const { wynik, stan } = await sprawdz.mutateAsync();
        qc.setQueryData(kluczeWiedzy.pasowanieZSieci, stan);
        const odrzucono = { ...razem.odrzucono };
        for (const [p, n] of Object.entries(wynik.odrzucono)) {
          odrzucono[p as PowodOdrzuceniaSieci] = (odrzucono[p as PowodOdrzuceniaSieci] ?? 0) + (n ?? 0);
        }
        razem = { sprawdzono: razem.sprawdzono + wynik.sprawdzono, zaproponowano: razem.zaproponowano + wynik.zaproponowano,
          bledow: razem.bledow + wynik.bledow, odrzucono, przerwane: wynik.przerwane };
        setSumy(razem);
        /* Nic do sprawdzenia, limit wyczerpany albo dostawca prosi o przerwę —
           kolejne żądanie niczego by nie zmieniło. Mówimy, dlaczego przed
           czasem: „godzina” kończąca się po siedmiu kartotekach bez słowa
           wyglądałaby na awarię. */
        if (wynik.przerwane) break;
        if (wynik.sprawdzono === 0 && wynik.bledow === 0) {
          setKoniecPowod(stan.doSprawdzenia === 0
            ? "Skończyłem przed czasem — nie ma już kartotek do sprawdzenia."
            : `Skończyłem przed czasem — wyczerpał się limit (${ile(stan.reczne?.naGodzine ?? stan.naNoc,
              "kartoteka", "kartoteki", "kartotek")} na godzinę). Kliknij znowu za kilkanaście minut.`);
          break;
        }
      }
      if (stop.current) setKoniecPowod("Zatrzymano.");
    } catch (e) {
      setBlad((e as Error).message);
    } finally {
      setTrwa(false); setPostep("");
      /* Propozycje stanęły w kolejce — odświeżamy wszystko, co z niej czyta. */
      qc.invalidateQueries({ queryKey: ["wiedza"] });
    }
  };

  return <section className="space-y-2 rounded-lg border border-slate-200 p-3" aria-label="Szukanie w sieci">
    <div>
      <NaglowekSekcji>Szukanie w sieci</NaglowekSekcji>
      {/* GDZIE SZUKAĆ WYNIKU. Właściciel po pierwszym przebiegu zapytał, gdzie
          trafiają propozycje. Karta stoi teraz na górze Kolejki (0.528.0),
          więc odpowiedź to „niżej, tutaj” — bez przechodzenia między zakładkami. */}
      <p className="text-sm text-slate-600">
        Szuka po numerach OEM, do czego pasują nasze części — w katalogach producentów i sklepach, nigdy na
        Allegro, OLX ani Ceneo. Nocą robi to sam. Propozycje pojawiają się niżej, w tej kolejce.</p>
    </div>
    {s && <p className="text-sm" aria-label="Stan pasowania z sieci">
      Czeka: <b>{ile(s.doSprawdzenia, "kartoteka", "kartoteki", "kartotek")}</b>
      {" "}· <span title={s.reczne ? "Ręczne szukanie ma własny limit, osobny od nocy." : "Wspólny z przebiegiem nocnym."}>
        w tej godzinie zostało <b>{zostalo}</b> z {limit}</span>
      {/* Silniki idą PIERWSZE (0.527.0): jeden wykaz części silnika
          dopasowuje dziesiątki kartotek naraz. */}
      {s.silniki && s.silniki.doSprawdzenia > 0 && <span className="text-slate-600">
        {" "}· najpierw popularne silniki ({s.silniki.doSprawdzenia} z {s.silniki.razem})</span>}</p>}
    {s?.niegotowy && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700" role="note">{s.niegotowy}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {!trwa
        ? <Przycisk disabled={nieMoze} onClick={() => void uruchom()}><Globe size={16} />Szukaj w sieci</Przycisk>
        : <Przycisk onClick={() => { stop.current = true; }}><Square size={14} />Zatrzymaj</Przycisk>}
      {postep && <span className="text-sm text-slate-600" role="status">{postep}</span>}
      {!trwa && <span className="text-xs text-slate-600">Szuka przez godzinę; możesz zatrzymać w każdej chwili.</span>}
    </div>
    {trwa && <p className="text-xs text-slate-600">
      Nie przechodź na inną zakładkę ani ekran — przebieg idzie z tej karty i zejście go kończy.</p>}
    {koniecPowod && <p className="text-sm text-slate-700" aria-label="Koniec przebiegu">{koniecPowod}</p>}
    {(trwa || sumy.sprawdzono > 0 || sumy.bledow > 0) && <p className="text-sm text-slate-700" aria-label="Wynik pasowania z sieci">
      Sprawdzono {ile(sumy.sprawdzono, "kartotekę", "kartoteki", "kartotek")} · nowych propozycji: <b>{sumy.zaproponowano}</b>
      {/* „Pominięte”, nie „odrzuciło sito” (0.510.0) — agent nie zna sita. */}
      {Object.keys(sumy.odrzucono).length > 0 && <span
        title="Znaleziska, których strona nie potwierdziła, nie trafiają do kolejki."> · pominięte jako niepewne: {odrzuty(sumy.odrzucono)}</span>}
      {sumy.bledow > 0 && <span className="text-red-800"> · błędów: {sumy.bledow}</span>}
      {sumy.bledow > 0 && ostatniBlad && <span className="block text-red-800" aria-label="Ostatni błąd">
        Ostatni błąd ({ostatniBlad.rodzaj === "silnik" ? "silnik " : ""}{ostatniBlad.symbol}): {ostatniBlad.blad}</span>}
      {sumy.przerwane && <span className="text-red-800"> · przerwano: {sumy.przerwane}</span>}</p>}
    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>
    {/* Zwinięte (0.528.0): to wiedza na wypadek pytania „czemu nic nie
        znalazł”, nie do czytania co dzień nad kolejką. */}
    {/* Otwarte, gdy wśród ostatnich jest błąd — wtedy to jest to, czego się szuka. */}
    {s && s.ostatnie.length > 0 && <details aria-label="Ostatnio sprawdzone" open={!!ostatniBlad}>
      <summary className="cursor-pointer text-sm text-slate-600">Ostatnio sprawdzone</summary>
      <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
        {s.ostatnie.map((o, i) => <li key={i}>
          {o.rodzaj === "silnik" ? <>silnik <b>{o.symbol}</b></> : <span className="font-mono">{o.symbol}</span>}
          {" "}· {czas(o.at)} · {o.wynik === "blad"
            ? <span className="text-red-800">błąd: {o.blad}</span>
            : <>{o.rodzaj === "silnik" ? "wykazów" : "znalezisk"} {o.znalezisk}, propozycji {o.zaproponowano}
              {Object.keys(o.odrzucone).length > 0 && <span className="text-slate-600"> (odrzucone: {odrzuty(o.odrzucone)})</span>}</>}
        </li>)}
      </ul>
    </details>}
  </section>;
}
