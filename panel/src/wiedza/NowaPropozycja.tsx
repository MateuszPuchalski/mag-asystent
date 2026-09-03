import React, { useState } from "react";
import { BookMarked } from "lucide-react";
import type { NowaPropozycja as NowaPropozycjaTyp, PowodNegatywny, RodzajDowodu } from "../api/typy";
import { Pole, Przycisk } from "../ui";
import { PolaModelu, type DaneModelu } from "./PolaModelu";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { DOWODY_DO_WYBORU, NAZWA_DOWODU, NAZWA_POWODU } from "../skrzynka/statusy";

/**
 * Ręczna propozycja wpisu (E2) — dla wiedzy z katalogów i z głowy właściciela.
 * Rodzi się Z DOWODEM, bo zatwierdzenie bez dowodu serwer odbija; formularz
 * nie wysyła bez kartoteki, maszyny i treści dowodu — pilnuje tego przycisk,
 * nie dopiero odmowa z serwera. Negatyw wymaga powodu z listy §11.4.
 */
export function NowaPropozycja({ trwa, blad, onWyslij }: {
  trwa: boolean;
  blad: string;
  onWyslij: (p: NowaPropozycjaTyp) => void;
}) {
  const [towar, setTowar] = useState<Towar | null>(null);
  const [model, setModel] = useState<DaneModelu>({ rodzaj: "maszyna", marka: "", nazwa: "", wariant: "" });
  const { rodzaj, marka, nazwa, wariant } = model;
  const [polaryzacja, setPolaryzacja] = useState<"pasuje" | "nie_pasuje">("pasuje");
  const [powod, setPowod] = useState<PowodNegatywny>("niewlasciwy_rozstaw");
  const [rodzajDowodu, setRodzajDowodu] = useState<RodzajDowodu>("katalog_dostawcy");
  const [tresc, setTresc] = useState("");
  const [link, setLink] = useState("");
  const [komentarz, setKomentarz] = useState("");
  const gotowe = Boolean(towar && marka.trim() && nazwa.trim() && tresc.trim());

  return <form className="space-y-3" aria-label="Nowa propozycja"
    onSubmit={(e) => {
      e.preventDefault();
      if (!gotowe || !towar) return;
      onWyslij({
        twId: towar.id,
        model: { rodzaj, marka: marka.trim(), nazwa: nazwa.trim(), wariant: wariant.trim() || null },
        polaryzacja, powodNegatywny: polaryzacja === "nie_pasuje" ? powod : null,
        komentarz: komentarz.trim() || null,
        dowod: { rodzaj: rodzajDowodu, tresc: tresc.trim(), link: link.trim() || null },
      });
    }}>
    <div>
      <div className="mb-1 text-sm font-semibold">Kartoteka</div>
      <Wyszukiwarka wybrany={towar} onWybierz={setTowar} etykieta="Wskazana przez Ciebie" />
    </div>

    <PolaModelu dane={model} onZmiana={setModel} />

    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1 text-sm">
        <input type="radio" name="polaryzacja" checked={polaryzacja === "pasuje"} onChange={() => setPolaryzacja("pasuje")} />pasuje</label>
      <label className="flex items-center gap-1 text-sm">
        <input type="radio" name="polaryzacja" checked={polaryzacja === "nie_pasuje"} onChange={() => setPolaryzacja("nie_pasuje")} />nie pasuje</label>
      {polaryzacja === "nie_pasuje" && <select className="field w-auto" aria-label="Powód negatywny" value={powod}
        onChange={(e) => setPowod(e.target.value as PowodNegatywny)}>
        {(Object.keys(NAZWA_POWODU) as PowodNegatywny[]).map((k) => <option key={k} value={k}>{NAZWA_POWODU[k]}</option>)}
      </select>}
    </div>

    <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
      <label className="text-xs font-bold text-slate-600">Rodzaj dowodu
        <select className="field mt-1" aria-label="Rodzaj dowodu" value={rodzajDowodu}
          onChange={(e) => setRodzajDowodu(e.target.value as RodzajDowodu)}>
          {DOWODY_DO_WYBORU.map((r) => <option key={r} value={r}>{NAZWA_DOWODU[r]}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">Treść dowodu
        <Pole className="mt-1" aria-label="Treść dowodu" value={tresc} placeholder="np. katalog NAC 2024, s. 34: szarpak 148/82 do LS 46-450"
          onChange={(e) => setTresc(e.target.value)} /></label>
    </div>
    <div className="grid gap-2 md:grid-cols-2">
      <label className="text-xs font-bold text-slate-600">Odnośnik (opcjonalnie)
        <Pole className="mt-1" aria-label="Odnośnik" value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} /></label>
      <label className="text-xs font-bold text-slate-600">Komentarz (opcjonalnie)
        <Pole className="mt-1" aria-label="Komentarz" value={komentarz} onChange={(e) => setKomentarz(e.target.value)} /></label>
    </div>

    {blad && <p className="text-sm text-red-700">{blad}</p>}
    <Przycisk wariant="glowny" type="submit" disabled={!gotowe || trwa}>
      <BookMarked size={16} />ZAPROPONUJ DO KOLEJKI</Przycisk>
    {!gotowe && <span className="ml-2 text-xs text-slate-500">kartoteka, marka, model i treść dowodu są wymagane</span>}
  </form>;
}
