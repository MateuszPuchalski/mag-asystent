import React, { useMemo, useState } from "react";
import type { Zwrot } from "../api/typy";
import { Przycisk, Pole, Blad } from "../ui";
import { zlote } from "../api/zwroty";

/* ── Pasek decyzji zwrotu (0.156.0) ──────────────────────────────────────────
   Do tego wydania klawisze z §25a.2 stały tu jako PODPISY: `kubelekZwrotu`
   routował po `werdykt`, ocenie pozycji i `kwota_grosze`, a żadnej z tych
   kolumn nic nie zapisywało. Kolejka bramek była maszyną bez paliwa.

   Trzy kubełki dostały działanie w 0.156.0, czwarty — korekta — w 0.162.0.
   Korekty NIE wystawia panel: robi to człowiek w Subiekcie, a tutaj przepisuje
   jej numer. Stąd pole tekstowe zamiast przycisku „zleć" i stąd cofnięcie
   (§25a.5): literówka w przepisanym numerze jest zdarzeniem normalnym.      */

type Props = {
  zwrot: Zwrot;
  onWerdykt: (decyzja: "przyjety" | "odrzucony", powod: string | null) => void;
  onOcena: (pozycjaId: number, ocena: "stan" | "przecena" | "utylizacja") => void;
  onKwota: (pozycjeIds: number[], dostawa: boolean) => void;
  onKorekta: (numer: string) => void;
  onCofnijKorekte: () => void;
  trwa: boolean;
  blad: string;
};

const OCENY: Array<["stan" | "przecena" | "utylizacja", string, string]> = [
  ["stan", "S", "Na stan"],
  ["przecena", "C", "Na przecenę"],
  ["utylizacja", "U", "Utylizacja"],
];

export function Decyzje({ zwrot, onWerdykt, onOcena, onKwota, onKorekta, onCofnijKorekte,
  trwa, blad }: Props) {
  const [odmowa, setOdmowa] = useState(false);
  const [powod, setPowod] = useState("");
  /* Pozycje startują ZAZNACZONE — to one wracają do nas. Dostawa nie:
     o niej decyduje człowiek, bo zależy od tego, czy klient odstępuje od
     całego zamówienia, czy oddaje jedną rzecz z pięciu. */
  const [wybrane, setWybrane] = useState<number[]>(() => zwrot.pozycje.map((p) => p.id));
  const [dostawa, setDostawa] = useState(false);
  /* Numer korekty PRZEPISUJE człowiek z Subiekta — panel go nie wywiedzie
     z niczego, bo read-model zna tylko dokumenty zakupu (FZ, PZ). */
  const [numer, setNumer] = useState("");

  const dostawaGrosze = zwrot.zamowienie?.dostawaGrosze ?? null;
  const suma = useMemo(() => {
    const pozycje = zwrot.pozycje
      .filter((p) => wybrane.includes(p.id))
      .reduce((s, p) => s + Math.round(p.cenaGrosze * p.ilosc), 0);
    return pozycje + (dostawa ? dostawaGrosze ?? 0 : 0);
  }, [zwrot.pozycje, wybrane, dostawa, dostawaGrosze]);

  const przelacz = (id: number) => setWybrane((w) =>
    w.includes(id) ? w.filter((x) => x !== id) : [...w, id].sort((a, b) => a - b));

  const ramka = "border-b border-slate-200 bg-slate-50 p-4";

  if (zwrot.kubelek === "decyzja") {
    return <div className={ramka}>
      {!odmowa
        ? <div className="flex flex-wrap gap-2">
            <Przycisk wariant="glowny" disabled={trwa}
              onClick={() => onWerdykt("przyjety", null)}>
              <kbd className="rounded border border-black/20 px-1 text-xs">P</kbd> Przyjmij
            </Przycisk>
            <Przycisk disabled={trwa} onClick={() => setOdmowa(true)}>
              <kbd className="rounded border border-slate-300 px-1 text-xs">O</kbd> Odrzuć
            </Przycisk>
          </div>
        : <div className="space-y-2">
            {/* Odmowa jest NIEODWRACALNA (§25a.5), więc dostaje potwierdzenie
                i wymaga powodu — bez niego nie ma czego pokazać klientowi. */}
            <label className="block text-xs font-bold text-slate-600" htmlFor="powod-odmowy">
              Powód odmowy — zobaczy go klient
            </label>
            <Pole id="powod-odmowy" value={powod} autoFocus
              onChange={(e) => setPowod(e.target.value)}
              placeholder="np. towar nosi ślady użycia" />
            <div className="flex gap-2">
              <Przycisk wariant="glowny" disabled={trwa || powod.trim() === ""}
                onClick={() => onWerdykt("odrzucony", powod.trim())}>
                Potwierdź odmowę
              </Przycisk>
              <Przycisk onClick={() => { setOdmowa(false); setPowod(""); }}>Wróć</Przycisk>
            </div>
          </div>}
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  if (zwrot.kubelek === "ocena") {
    return <div className={ramka}>
      <ul className="space-y-2">
        {zwrot.pozycje.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-sm">{p.nazwa}</span>
          {p.ocena
            ? <span className="text-xs font-bold text-ranga-ok">
                {OCENY.find(([k]) => k === p.ocena)?.[2] ?? p.ocena}</span>
            : OCENY.map(([klucz, klawisz, etykieta]) => (
                <Przycisk key={klucz} className="text-xs" disabled={trwa}
                  onClick={() => onOcena(p.id, klucz)}>
                  <kbd className="rounded border border-slate-300 px-1">{klawisz}</kbd> {etykieta}
                </Przycisk>))}
        </li>)}
      </ul>
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  if (zwrot.kubelek === "zwrot") {
    return <div className={ramka}>
      {/* ZAZNACZENIE, nie wybór wariantu. Operator odhacza to, co oddaje,
          a suma rośnie na oczach. Wariant („pełna", „bez wysyłki") wylicza
          sobie z tego serwer — jest etykietą, a nie pozycją w menu. */}
      <ul className="space-y-1">
        {zwrot.pozycje.map((p) => <li key={p.id}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wybrane.includes(p.id)}
              onChange={() => przelacz(p.id)} />
            <span className="mr-auto">{p.nazwa}{p.ilosc !== 1 && ` × ${p.ilosc}`}</span>
            <span className="tabular-nums text-slate-600">
              {zlote(Math.round(p.cenaGrosze * p.ilosc), p.waluta)}</span>
          </label>
        </li>)}
        {dostawaGrosze != null && <li>
          <label className="flex items-center gap-2 border-t border-slate-200 pt-1 text-sm">
            <input type="checkbox" checked={dostawa} onChange={() => setDostawa((d) => !d)} />
            <span className="mr-auto">Koszt dostawy</span>
            <span className="tabular-nums text-slate-600">
              {zlote(dostawaGrosze, zwrot.waluta)}</span>
          </label>
        </li>}
      </ul>
      <div className="mt-3 flex items-center gap-3 border-t border-slate-300 pt-2">
        <span className="text-xs font-bold uppercase text-slate-500">Do oddania</span>
        <b data-testid="suma" className="mr-auto tabular-nums text-lg">
          {zlote(suma, zwrot.waluta)}</b>
        <Przycisk wariant="glowny" disabled={trwa}
          onClick={() => onKwota(wybrane, dostawa)}>
          <kbd className="rounded border border-black/20 px-1 text-xs">Enter</kbd> Zapisz kwotę
        </Przycisk>
      </div>
      {/* Podgląd jest PODGLĄDEM. Do serwera idzie zaznaczenie, a sumę składa
          on sam (§25a.3) — inaczej dałoby się zapisać dowolną kwotę żądaniem
          z pominięciem tego ekranu. */}
      <p className="mt-1 text-xs text-slate-500">
        Kwotę przelicza serwer z zaznaczenia; to podgląd.
      </p>
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  if (zwrot.kubelek === "korekta") {
    return <div className={ramka}>
      <p className="mb-2 text-xs text-slate-500">
        {/* Wprost, bo inaczej ekran obiecywałby, że zrobi to sam. */}
        Korektę wystawiasz w Subiekcie. Tu przepisz jej numer — to zamyka zwrot.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Pole className="w-56" value={numer} aria-label="Numer korekty"
          placeholder="Np. KFS 12/2026" onChange={(e) => setNumer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && numer.trim()) onKorekta(numer.trim()); }} />
        <Przycisk wariant="glowny" disabled={trwa || !numer.trim()}
          onClick={() => onKorekta(numer.trim())}>
          <kbd className="rounded border border-black/20 px-1 text-xs">Enter</kbd> Zapisz korektę
        </Przycisk>
      </div>
      {/* Pieniądze oddaje człowiek w panelu Allegro — zamknięcie znaczy
          „nasza część zrobiona", nie „klient dostał przelew". */}
      <p className="mt-1 text-xs text-slate-500">
        Pieniądze oddajesz w panelu Allegro; panel ich nie przelewa.
      </p>
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  return <div className={ramka}>
    {zwrot.korektaNumer
      ? <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Korekta</span>
          <b className="mr-auto">{zwrot.korektaNumer}</b>
          {/* §25a.5: cofnięcie zamiast potwierdzenia — numer przepisano ręką. */}
          <Przycisk disabled={trwa} onClick={onCofnijKorekte}>
            <kbd className="rounded border border-slate-300 px-1 text-xs">R</kbd> Cofnij korektę
          </Przycisk>
        </div>
      : <p className="text-xs text-slate-500">Stan końcowy — nie ma tu decyzji do podjęcia.</p>}
    {blad && <Blad>{blad}</Blad>}
  </div>;
}
