import React, { useState } from "react";
import { FileText } from "lucide-react";
import type { ModelZOpisu } from "../api/typy";
import { useModeleZOpisow, useOdrzucModelZOpisu, usePrzerobModelZOpisu } from "../api/wiedza";
import { Blad, Pusto, Przycisk } from "../ui";
import { PolaModelu, type DaneModelu } from "./PolaModelu";
import { Kafel } from "../towar/Kafel";
import { Tokeny } from "./Tokeny";

/**
 * „Z opisów i ofert" (E3, rozszerzone w 0.264.0): teksty, z których człowiek
 * składa klucz modelu. Dwa źródła, jedna kolejka — sekcje „Modele:" wycięte
 * z opisów kartotek po imporcie oraz pozycje listy zgodności z NASZYCH ofert
 * Allegro, odłożone tu przy układaniu szkicu Copilota.
 *
 * Decyzja właściciela: automat NIE proponuje z tekstu — `FS350 FS400` nie mówi,
 * czyja to maszyna. Człowiek wskazuje markę i model, dopiero to tworzy
 * propozycję (dowód „decyzja biura", źródło zależne od wiersza). Odrzucony
 * wiersz nie wraca po kolejnym imporcie.
 *
 * Nowego widoku dla ofert NIE MA i to jest decyzja, nie skrót: robota jest ta
 * sama co do joty, a rozdzielenie jej na dwa ekrany kazałoby człowiekowi
 * pamiętać o dwóch kolejkach zamiast o jednej.
 */
export function ZOpisow() {
  const lista = useModeleZOpisow();
  const przerob = usePrzerobModelZOpisu();
  const odrzuc = useOdrzucModelZOpisu();
  const [blad, setBlad] = useState("");
  const [ostatnie, setOstatnie] = useState("");
  const wiersze = lista.data?.wiersze ?? [];

  return <div className="space-y-3">
    <p className="text-xs text-slate-500">
      Teksty z opisów kartotek i z list zgodności naszych ofert. Wskaż markę i model —
      powstanie propozycja do kolejki. Odrzuć, gdy to nie jest lista modeli;
      odrzucone nie wracają po imporcie.
    </p>
    <Blad>{blad || (lista.error as Error | null)?.message}</Blad>
    {ostatnie && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{ostatnie}</p>}
    {!lista.isLoading && wiersze.length === 0 &&
      <Pusto ikona={FileText}>Nic do przerobienia. Nowe sekcje pojawią się po imporcie kartotek.</Pusto>}
    {lista.data && lista.data.liczba > wiersze.length && <p className="text-xs text-slate-500">
      Pokazuję {wiersze.length} z {lista.data.liczba} — reszta po przerobieniu tych.</p>}
    <ul className="space-y-3">
      {wiersze.map((m) => <Wiersz key={m.id} m={m} trwa={przerob.isPending || odrzuc.isPending}
        onPrzerob={(model) => { setBlad(""); setOstatnie("");
          przerob.mutate({ id: m.id, model }, {
            onSuccess: (z) => setOstatnie(`Propozycja ${z.symbol} → ${z.model.etykieta} czeka w kolejce.`),
            onError: (e) => setBlad((e as Error).message),
          }); }}
        onOdrzuc={() => { setBlad(""); setOstatnie("");
          odrzuc.mutate({ id: m.id }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
    </ul>
    {/* DRUGA SEKCJA TEGO SAMEGO WIDOKU, nie szósta zakładka (komentarz przy
        `Zakladki` w ekranie Wiedza). Obie sekcje to ta sama robota: wiedza
        wyjęta z kartotek, którą człowiek zamienia na zastosowania. */}
    <Tokeny />
  </div>;
}

function Wiersz({ m, trwa, onPrzerob, onOdrzuc }: {
  m: ModelZOpisu; trwa: boolean;
  onPrzerob: (model: { rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant: string | null }) => void;
  onOdrzuc: () => void;
}) {
  const [model, setModel] = useState<DaneModelu>({ rodzaj: "maszyna", marka: "", nazwa: "", wariant: "" });
  /* Bez marki i modelu przycisk stoi — pilnuje tego przycisk, nie odmowa z serwera. */
  const gotowe = Boolean(model.marka.trim() && model.nazwa.trim());
  return <li className="rounded-lg border border-slate-200 p-3" aria-label={`Z opisu: ${m.symbol}`}>
    {/* Zdjęcie przy wierszu (0.203.0). Człowiek ma tu wskazać markę i model
        do listy w rodzaju „FS200 FS250", a lista nie mówi, do czego pasuje.
        Wygląd części bywa jedyną wskazówką, czy to osprzęt kosy, czy pilarki. */}
    <div className="flex items-start gap-3">
      <Kafel twId={m.twId} rozmiar={40} nazwa={m.nazwa ?? m.symbol} symbol={m.symbol} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <b className="font-mono">{m.symbol}</b>
          <span className="text-sm text-slate-700">{m.nazwa ?? ""}</span>
        </div>
        {/* ZNACZNIK ŹRÓDŁA (0.264.0). Człowiek rozstrzygający ma prawo
            wiedzieć, na co patrzy: opis kartoteki pisał magazyn, listę
            zgodności — sprzedawca w aukcji. To różnej wagi świadectwa,
            a decyzja bywa inna przy jednym i drugim. */}
        <p className="mt-1 rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">
          {m.zrodlo === "oferta" ? "Lista zgodności oferty" : "Modele"}: {m.tekst}</p>
        {m.zrodlo === "oferta" && <p className="mt-1 text-podpis text-sky-800">
          z naszej oferty Allegro{m.ofertaId ? ` ${m.ofertaId}` : ""}</p>}
      </div>
    </div>
    <div className="mt-2 space-y-2">
      <PolaModelu dane={model} onZmiana={setModel} zwarte />
      <div className="flex flex-wrap gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={!gotowe || trwa}
          onClick={() => onPrzerob({ rodzaj: model.rodzaj, marka: model.marka.trim(), nazwa: model.nazwa.trim(),
            wariant: model.wariant.trim() || null })}>Zaproponuj</Przycisk>
        <Przycisk className="text-xs" disabled={trwa} onClick={onOdrzuc}>Odrzuć</Przycisk>
      </div>
    </div>
  </li>;
}
