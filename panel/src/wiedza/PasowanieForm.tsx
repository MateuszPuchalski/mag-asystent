import React, { useState } from "react";
import type { KartotekaPasowania, NowePasowanie, PowodNegatywny, RodzajDowodu, RolaPasowania } from "../api/typy";
import { Pole, Przycisk } from "../ui";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { DOWODY_DO_WYBORU, NAZWA_DOWODU, NAZWA_POWODU, NAZWA_ROLI, ROLE_PASOWANIA } from "../skrzynka/statusy";

/**
 * Formularz pasowania: „X pasuje DO Y" (uszczelka do gaźnika).
 *
 * Dwa tryby jednego formularza. `para` STAŁA przychodzi z zakładki Dobór —
 * wybrany kandydat pasuje do kotwicy (gaźnika klienta), kierunek narzucony,
 * bo taki jest sens pytania klienta. Bez `para` formularz stoi na ekranie
 * Wiedza i drugi koniec wskazuje się wyszukiwarką, z radiem kierunku.
 *
 * Rodzi się Z DOWODEM (serwer odbija bez niego) i z ROLĄ; negatyw wymaga
 * powodu z listy §11.4. Pilnuje tego przycisk, nie dopiero odmowa serwera.
 */
export function PasowanieForm({ para, kartoteka, conversationId, trwa, blad, onWyslij, onAnuluj }: {
  /** Tryb pary stałej: `czesc` pasuje do `doCzego`. */
  para?: { czesc: KartotekaPasowania; doCzego: KartotekaPasowania };
  /** Tryb z wyszukiwarką: ta kartoteka jest jednym końcem, drugi wskazuje agent. */
  kartoteka?: KartotekaPasowania;
  conversationId?: number | null;
  trwa: boolean;
  blad?: string;
  onWyslij: (p: NowePasowanie) => void;
  onAnuluj?: () => void;
}) {
  const [drugi, setDrugi] = useState<Towar | null>(null);
  /* Kierunek w trybie wyszukiwarki: „ta część pasuje do wskazanej” albo odwrotnie. */
  const [tenPasuje, setTenPasuje] = useState(true);
  const [rola, setRola] = useState<RolaPasowania>("uszczelka");
  const [pozycja, setPozycja] = useState("");
  const [polaryzacja, setPolaryzacja] = useState<"pasuje" | "nie_pasuje">("pasuje");
  const [powod, setPowod] = useState<PowodNegatywny>("niewlasciwy_rozstaw");
  const [rodzajDowodu, setRodzajDowodu] = useState<RodzajDowodu>(conversationId ? "rozmowa" : "katalog_dostawcy");
  const [tresc, setTresc] = useState(conversationId ? `dobór w rozmowie #${conversationId}` : "");
  const [link, setLink] = useState("");

  const konce = para
    ? { czesc: para.czesc, doCzego: para.doCzego }
    : kartoteka && drugi
      ? tenPasuje
        ? { czesc: kartoteka, doCzego: { twId: drugi.id, symbol: drugi.sym, nazwa: drugi.name } }
        : { czesc: { twId: drugi.id, symbol: drugi.sym, nazwa: drugi.name }, doCzego: kartoteka }
      : null;
  const gotowe = Boolean(konce && tresc.trim());

  return <form className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Pasowanie części"
    onSubmit={(e) => {
      e.preventDefault();
      if (!gotowe || !konce) return;
      onWyslij({
        twId: konce.czesc.twId, doTwId: konce.doCzego.twId, rola, pozycja: pozycja.trim() || null,
        polaryzacja, powodNegatywny: polaryzacja === "nie_pasuje" ? powod : null,
        rodzajDowodu, dowodTresc: tresc.trim(), dowodLink: link.trim() || null,
        conversationId: conversationId ?? null,
      });
    }}>
    {para
      ? <p className="text-sm"><b className="font-mono">{para.czesc.symbol}</b> pasuje do <b className="font-mono">{para.doCzego.symbol}</b>
          <span className="text-slate-500"> · {para.doCzego.nazwa}</span></p>
      : <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="kierunek" checked={tenPasuje} onChange={() => setTenPasuje(true)} />
              ta część pasuje do…</label>
            <label className="flex items-center gap-1">
              <input type="radio" name="kierunek" checked={!tenPasuje} onChange={() => setTenPasuje(false)} />
              …pasuje do tej części</label>
          </div>
          <Wyszukiwarka wybrany={drugi} onWybierz={setDrugi} etykieta={tenPasuje ? "Do czego pasuje" : "Co pasuje"} />
        </div>}

    <div className="flex flex-wrap items-center gap-2">
      <select className="field w-auto" aria-label="Rola części" value={rola} onChange={(e) => setRola(e.target.value as RolaPasowania)}>
        {ROLE_PASOWANIA.map((r) => <option key={r} value={r}>{NAZWA_ROLI[r]}</option>)}
      </select>
      <Pole className="w-48" aria-label="Pozycja" value={pozycja} placeholder="pozycja, np. od strony filtra"
        onChange={(e) => setPozycja(e.target.value)} />
      <label className="flex items-center gap-1 text-sm">
        <input type="radio" name="polaryzacja" checked={polaryzacja === "pasuje"} onChange={() => setPolaryzacja("pasuje")} />pasuje</label>
      <label className="flex items-center gap-1 text-sm">
        <input type="radio" name="polaryzacja" checked={polaryzacja === "nie_pasuje"} onChange={() => setPolaryzacja("nie_pasuje")} />nie pasuje</label>
      {polaryzacja === "nie_pasuje" && <select className="field w-auto" aria-label="Powód negatywny" value={powod}
        onChange={(e) => setPowod(e.target.value as PowodNegatywny)}>
        {(Object.keys(NAZWA_POWODU) as PowodNegatywny[]).map((k) => <option key={k} value={k}>{NAZWA_POWODU[k]}</option>)}
      </select>}
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <select className="field w-auto" aria-label="Rodzaj dowodu" value={rodzajDowodu}
        onChange={(e) => setRodzajDowodu(e.target.value as RodzajDowodu)}>
        {/* Z rozmowy dowodem bywa sama rozmowa („klient ma W09-0211”); z ekranu Wiedza — dowód techniczny. */}
        {(conversationId ? ["rozmowa", ...DOWODY_DO_WYBORU] : DOWODY_DO_WYBORU).map((r) =>
          <option key={r} value={r}>{NAZWA_DOWODU[r as RodzajDowodu]}</option>)}
      </select>
      <Pole className="flex-1" aria-label="Dowód" value={tresc} placeholder="skąd wiadomo? np. katalog dostawcy, str. 12"
        onChange={(e) => setTresc(e.target.value)} />
      <Pole className="w-48" aria-label="Odnośnik" value={link} placeholder="odnośnik (opcjonalnie)"
        onChange={(e) => setLink(e.target.value)} />
    </div>

    <div className="flex items-center gap-2">
      <Przycisk type="submit" wariant="glowny" className="text-xs" disabled={trwa || !gotowe}>Zaproponuj pasowanie</Przycisk>
      {onAnuluj && <Przycisk type="button" className="text-xs" onClick={onAnuluj}>Anuluj</Przycisk>}
      {blad && <span className="text-xs text-red-700">{blad}</span>}
    </div>
  </form>;
}
