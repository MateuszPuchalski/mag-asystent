import React, { useState } from "react";
import { ImageOff } from "lucide-react";
import type { Dokument, Wyjatek } from "../api/dostawy";
import { useLogoDostawcy, useZdjecieDowodu } from "../towar/useZdjecie";
import { Blad, NaglowekSekcji, Pole, Przycisk, czas, ile } from "../ui";

/* ── Kontekst dostawy — prawa kolumna (0.435.0) ────────────────────────────
   Kolejność sekcji idzie za pytaniem, które biuro zadaje przy wyjątku:
   najpierw DOWÓD (co hala widziała), potem DOSTAWCA (czy to się u niego
   powtarza), potem ROZMOWA Z HALĄ. W biurze dowody leżały w tabeli pozycji
   jako miniatury 48 px, a pytanie przy nich brzmi „czy to TA część" — 48 px
   nie wystarczało i trzeba było otwierać Subiekt obok (0.205.0). */

function Dowod({ p, onPowieksz }: { p: Wyjatek; onPowieksz: (url: string) => void }) {
  const { url, blad, ponow } = useZdjecieDowodu(p.id);
  return <figure className="min-w-0">
    {url
      ? <button type="button" onClick={() => onPowieksz(url)} title="Powiększ"
          className="block w-full overflow-hidden rounded-lg bg-slate-100">
          <img src={url} alt={`Zdjęcie z hali: ${p.sym ?? p.symObcy ?? ""}`} className="h-28 w-full object-cover" /></button>
      : <div className="grid h-28 place-items-center rounded-lg bg-slate-100 text-slate-600">
          {url === undefined && !blad ? <span className="text-xs">wczytuję…</span>
            : <span className="flex flex-col items-center gap-1 text-xs"><ImageOff size={18} />
                {blad ? <button type="button" className="underline" onClick={ponow} title={blad}>ponów</button>
                  : "bez zdjęcia"}</span>}
        </div>}
    <figcaption className="mt-1 truncate text-xs text-slate-600">
      {p.sym ?? p.symObcy ?? "towar"} · {p.typLabel} · {czas(p.createdAt)}</figcaption>
  </figure>;
}

function Dostawca({ d }: { d: Dokument }) {
  const logo = useLogoDostawcy(d.khId, d.maLogo);
  const st = d.dostawcaStat;
  return <section className="mt-5">
    <NaglowekSekcji jako="h3">Dostawca</NaglowekSekcji>
    <div className="mt-1.5 flex items-center gap-3">
      {logo && <img src={logo} alt={`Logo: ${d.dostawca}`} className="h-9 max-w-[84px] object-contain" />}
      <div className="min-w-0">
        <b className="block truncate">{d.dostawca}</b>
        <span className="text-xs text-slate-600">{st?.dostawWRoku
          ? `${ile(st.dostawWRoku, "dostawa", "dostawy", "dostaw")} w tym roku` : "pierwsza dostawa w WERTIS"}</span>
      </div>
    </div>
    {/* Dwie liczby stoją PRZY wyjątku, bo bez nich nie wiadomo, czy niedobór
        zdarza się u tego dostawcy co drugi raz, czy pierwszy w tym roku —
        a to cała różnica między „policzyć ponownie" a „reklamować". */}
    {st && (st.udzialWyjatkow != null || st.medianaDni != null) &&
      <div className="mt-2 flex gap-2">
        <div className="flex-1 rounded-lg border border-slate-200 px-3 py-2">
          <b className={`block text-naglowek tabular-nums ${(st.udzialWyjatkow ?? 0) > 5 ? "text-ranga-zle" : ""}`}>
            {st.udzialWyjatkow == null ? "—" : `${String(st.udzialWyjatkow).replace(".", ",")}%`}</b>
          <span className="text-xs text-slate-600">pozycji z wyjątkiem</span></div>
        <div className="flex-1 rounded-lg border border-slate-200 px-3 py-2">
          <b className="block text-naglowek tabular-nums">
            {st.medianaDni == null ? "—" : `${String(st.medianaDni).replace(".", ",")} dn.`}</b>
          <span className="text-xs text-slate-600">mediana rozłożenia</span></div>
      </div>}
  </section>;
}

/**
 * Notatki z halą jako ROZMOWA — pytanie biura i odpowiedź z hali w dwóch
 * dymkach, jak od 0.97.0 w biurze. Nieodpowiedziana jest wyróżniona, bo to
 * ona trzyma dostawę otwartą.
 */
function Notatki({ d, notatka, przeczytane }: {
  d: Dokument;
  notatka: { trwa: boolean; blad: string; onWyslij: (tresc: string) => Promise<boolean> };
  przeczytane: { trwa: boolean; onPrzeczytane: (id: number) => void };
}) {
  const [tresc, setTresc] = useState("");
  return <section className="mt-5">
    <NaglowekSekcji jako="h3">Notatki z halą</NaglowekSekcji>
    {d.notatki.length === 0 && <p className="mt-1 text-sm text-slate-600">Brak notatek.</p>}
    {d.notatki.map((n) => <div key={n.id} className="mt-1.5 space-y-1.5">
      <div className="rounded-lg border border-os-komentarz-ramka bg-os-komentarz px-2.5 py-2 text-sm">
        <div className="text-xs text-slate-600">{n.createdBy} · {czas(n.createdAt)}</div>{n.tresc}</div>
      {n.odpowiedz
        ? <div className="ml-4 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm">
            <div className="text-xs text-slate-600">{n.odpBy} · {czas(n.odpAt)}</div>{n.odpowiedz}
            {!n.odpWidzianaAt && <div className="mt-1.5">
              <Przycisk className="!px-2.5 !py-1 !text-xs" disabled={przeczytane.trwa}
                onClick={() => przeczytane.onPrzeczytane(n.id)}>Przeczytane</Przycisk></div>}
          </div>
        : <p className="text-xs text-ranga-uwaga"><b>Czeka na odpowiedź</b> — dostawa się nie domknie, dopóki jej nie ma.</p>}
    </div>)}
    {/* Pole w miejscu, nie okno: pytanie do hali pisze się, patrząc na
        pozycję, o którą się pyta (dekalog pkt 5). */}
    <form className="mt-2 flex gap-2" onSubmit={(e) => {
      e.preventDefault();
      if (!tresc.trim()) return;
      void notatka.onWyslij(tresc.trim()).then((ok) => { if (ok) setTresc(""); });
    }}>
      <Pole className="min-w-0 flex-1" value={tresc} onChange={(e) => setTresc(e.target.value)}
        placeholder="Napisz do hali — trzeba będzie odpowiedzieć przed zamknięciem"
        aria-label="Notatka do hali" />
      <Przycisk type="submit" disabled={notatka.trwa || !tresc.trim()}>Wyślij</Przycisk>
    </form>
    <Blad>{notatka.blad}</Blad>
  </section>;
}

/**
 * Zdjęcie z listy pracy — rozłożone poza WERTIS.
 *
 * Powód jest obowiązkowy i to nie jest formalność: za pół roku „kto"
 * i „kiedy" nie odpowie na pytanie, dlaczego tej faktury nikt nie rozkładał.
 * Dostawy domkniętej normalnie nie ma czego zdejmować — przycisku wtedy nie
 * ma wcale, zamiast wyszarzonego, który zaprasza do kliknięcia i odmawia.
 */
function PozaWertis({ d, akcja }: {
  d: Dokument;
  akcja: { trwa: boolean; blad: string; onZamknij: (powod: string) => void; onPrzywroc: () => void };
}) {
  const [pytam, setPytam] = useState(false);
  const [powod, setPowod] = useState("");
  if (d.zamkniecie) {
    return <section className="mt-5 border-t border-slate-200 pt-3">
      <NaglowekSekcji jako="h3">Rozłożone poza WERTIS</NaglowekSekcji>
      <p className="mt-1 text-sm">{d.zamkniecie.kto} · {czas(d.zamkniecie.at)}</p>
      <p className="text-sm text-slate-600">powód: {d.zamkniecie.powod}</p>
      <Przycisk className="mt-2" disabled={akcja.trwa} onClick={akcja.onPrzywroc}>Przywróć na listę</Przycisk>
      <Blad>{akcja.blad}</Blad>
    </section>;
  }
  if (d.status === "done") return null;
  return <section className="mt-5 border-t border-slate-200 pt-3">
    {!pytam
      ? <Przycisk onClick={() => setPytam(true)}>Rozłożone poza WERTIS…</Przycisk>
      : <form onSubmit={(e) => { e.preventDefault(); akcja.onZamknij(powod.trim()); }}>
          <p className="text-sm">Dostawa {d.nrPelny} zniknie z listy rozkładania. Dlaczego?</p>
          <Pole className="mt-1.5" autoFocus value={powod} onChange={(e) => setPowod(e.target.value)}
            placeholder="np. rozłożone starą aplikacją przed wdrożeniem WERTIS" aria-label="Powód" />
          <div className="mt-2 flex gap-2">
            <button type="submit" disabled={akcja.trwa || !powod.trim()}
              className="inline-flex items-center rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50">
              Zamknij dostawę</button>
            <Przycisk type="button" onClick={() => { setPytam(false); setPowod(""); }}>Anuluj</Przycisk>
          </div>
          <Blad>{akcja.blad}</Blad>
        </form>}
  </section>;
}

export function Kontekst({ d, onPowieksz, notatka, przeczytane, pozaWertis }: {
  d: Dokument;
  onPowieksz: (url: string) => void;
  notatka: React.ComponentProps<typeof Notatki>["notatka"];
  przeczytane: React.ComponentProps<typeof Notatki>["przeczytane"];
  pozaWertis: React.ComponentProps<typeof PozaWertis>["akcja"];
}) {
  const dowody = [...d.lines.flatMap((l) => l.problemy), ...d.problemyBezLinii].filter((p) => p.hasPhoto);
  return <div className="p-4">
    <NaglowekSekcji jako="h3">Dowody</NaglowekSekcji>
    {dowody.length
      ? <div className="mt-1.5 grid grid-cols-2 gap-2">
          {dowody.map((p) => <Dowod key={p.id} p={p} onPowieksz={onPowieksz} />)}</div>
      : <p className="mt-1 text-sm text-slate-600">Hala nie dołączyła zdjęć do tej dostawy.</p>}
    <Dostawca d={d} />
    <Notatki d={d} notatka={notatka} przeczytane={przeczytane} />
    <PozaWertis d={d} akcja={pozaWertis} />
  </div>;
}
