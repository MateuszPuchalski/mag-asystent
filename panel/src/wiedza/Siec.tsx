import React, { useId, useMemo, useState } from "react";
import { Network } from "lucide-react";
import type { KartotekaPasowania, KrawedzSieci, RodzajKrawedzi } from "../api/typy";
import { useSiecPasowan } from "../api/wiedza";
import { Blad, Karta, Pole, Pusto, ile } from "../ui";
import { pasujeDoFrazy, roleWezlow, uklad, wyspy, zwin, type RolaWezla, type Uklad, type Wyspa } from "./siec-uklad";

/* ── Sieć pasowań: co do czego pasuje, na jednym obrazku ─────────────────────
   Zakładka „Sprawdź kartotekę" odpowiada na pytanie o JEDNĄ część. Tu biuro
   widzi całość naraz: które gaźniki mają już komplet uszczelek, gdzie stoi
   sam negatyw, co czeka w kolejce i które symbole łączy tylko opis kartoteki.

   To jest WGLĄD, nie praca. Ekran nie ma ani jednego przycisku zapisu —
   rozstrzyga się w kolejce, dopisuje w „Sprawdź kartotekę". Dwie drogi do
   tego samego zapisu to dwa miejsca, w których reguła §14.2 może się rozjechać.

   BARWY ZNACZĄ TO SAMO, CO W RESZCIE WIEDZY. Zieleń — pasuje, czerwień — nie
   pasuje, bursztyn — czeka na decyzję (rodzina „uwaga", nie zaznaczenie),
   łupek — odczyt opisu. Wybrany węzeł dostaje atrament, nie bursztyn:
   `Bursztyn.test` pilnuje, żeby bursztyn nie wrócił jako barwa wyboru.
   Kreska niesie znaczenie drugi raz (ciągła, przerywana, kropkowana), bo
   czerwień i zieleń to para, której część ludzi nie rozróżnia. */

type Styl = { linia: string; grot: string; kreska?: string; nazwa: string };

/* Stopnie z kontrastem ≥ 3:1 na bieli, próg WCAG dla znaków graficznych —
   ten sam rachunek, który w `ui/wykres.tsx` zdjął jasny bursztyn ze słupków. */
const STYL: Record<RodzajKrawedzi, Styl> = {
  pasuje: { linia: "stroke-emerald-700", grot: "fill-emerald-700", nazwa: "pasuje" },
  nie_pasuje: { linia: "stroke-red-700", grot: "fill-red-700", kreska: "7 4", nazwa: "nie pasuje" },
  propozycja: { linia: "stroke-amber-600", grot: "fill-amber-600", kreska: "3 3", nazwa: "czeka w kolejce" },
  zamiennik: { linia: "stroke-slate-500", grot: "fill-slate-500", kreska: "1 4", nazwa: "zamiennik z opisu" },
};
const KOLEJNOSC: RodzajKrawedzi[] = ["pasuje", "nie_pasuje", "propozycja", "zamiennik"];

const WEZEL: Record<RolaWezla, { r: number; klasa: string; nazwa: string }> = {
  cel: { r: 10, klasa: "fill-wertis-ink stroke-wertis-ink", nazwa: "do czego (np. gaźnik)" },
  czesc: { r: 7, klasa: "fill-white stroke-slate-700", nazwa: "część (np. uszczelka)" },
  zamiennik: { r: 6, klasa: "fill-slate-100 stroke-slate-500", nazwa: "tylko z opisu" },
};

/** Wyspa szersza niż tyle węzłów idzie przez całą szerokość — w kolumnie byłaby nieczytelna. */
const DUZA_WYSPA = 9;

export function Siec() {
  const siec = useSiecPasowan();
  const [zZamiennikami, setZZamiennikami] = useState(true);
  const [szukaj, setSzukaj] = useState("");
  const [wybrany, setWybrany] = useState<number | null>(null);

  const lista = useMemo(() => siec.data ? wyspy(siec.data, zZamiennikami) : [], [siec.data, zZamiennikami]);
  const fraza = zwin(szukaj);
  const widoczne = fraza ? lista.filter((w) => w.wezly.some((x) => pasujeDoFrazy(x, fraza))) : lista;

  if (siec.error) return <Blad>{(siec.error as Error).message}</Blad>;
  if (siec.isLoading || !siec.data) return <p className="text-sm text-slate-500">Wczytuję sieć…</p>;
  const pasowan = siec.data.krawedzie.filter((k) => k.rodzaj !== "zamiennik").length;
  if (pasowan === 0) {
    return <Pusto waga="lista" ikona={Network}>
      Nie ma jeszcze żadnego pasowania. Dopisuje się je w „Sprawdź kartotekę" albo z rozmowy przez Copilota.
    </Pusto>;
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <p className="mr-auto text-sm text-slate-600">
        {ile(pasowan, "pasowanie", "pasowania", "pasowań")} · {ile(siec.data.wezly.length, "kartoteka", "kartoteki", "kartotek")}
        {" · "}{ile(lista.length, "wyspa", "wyspy", "wysp")}
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={zZamiennikami} onChange={(e) => { setZZamiennikami(e.target.checked); setWybrany(null); }} />
        Zamienniki z opisów
      </label>
      <Pole className="w-64" aria-label="Szukaj w sieci" placeholder="Symbol albo nazwa" value={szukaj}
        onChange={(e) => setSzukaj(e.target.value)} />
    </div>
    <Legenda />
    {widoczne.length === 0 && <Pusto waga="lista">Żadna wyspa nie ma kartoteki pasującej do „{szukaj}".</Pusto>}
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {widoczne.map((w) => <KartaWyspy key={`${w.srodek.twId}-${w.wezly.length}`} w={w} fraza={fraza}
        wybrany={wybrany} onWybierz={(tw) => setWybrany((v) => v === tw ? null : tw)} />)}
    </div>
  </div>;
}

function Legenda() {
  return <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legenda">
    {KOLEJNOSC.map((r) => <li key={r} className="flex items-center gap-1.5">
      <svg width="28" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="27" y2="4" strokeWidth="2" strokeDasharray={STYL[r].kreska} className={STYL[r].linia} />
      </svg>{STYL[r].nazwa}</li>)}
    {(Object.keys(WEZEL) as RolaWezla[]).map((r) => <li key={r} className="flex items-center gap-1.5">
      <svg width="20" height="20" aria-hidden="true">
        <circle cx="10" cy="10" r={WEZEL[r].r - 1} strokeWidth="1.5" className={WEZEL[r].klasa} />
      </svg>{WEZEL[r].nazwa}</li>)}
  </ul>;
}

function KartaWyspy({ w, fraza, wybrany, onWybierz }: {
  w: Wyspa; fraza: string; wybrany: number | null; onWybierz: (twId: number) => void;
}) {
  /* `useId` oddaje dwukropki albo nawiasy kątowe, zależnie od wydania Reacta,
     a `url(#…)` w atrybucie grotu tych znaków nie przełknie bez ucieczki. */
  const id = `siec${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const u = useMemo(() => uklad(w), [w]);
  const role = useMemo(() => roleWezlow(w.krawedzie), [w]);
  const tu = wybrany !== null && u.pozycje.has(wybrany) ? wybrany : null;
  /* Sąsiedzi wybranego zostają w pełnym kolorze, reszta blednie — jedno
     kliknięcie odpowiada „co z tym", bez czytania całej wyspy. */
  const sasiedzi = useMemo(() => {
    if (tu === null) return null;
    const s = new Set([tu]);
    for (const k of w.krawedzie) if (k.z === tu || k.do === tu) { s.add(k.z); s.add(k.do); }
    return s;
  }, [tu, w]);
  const poId = useMemo(() => new Map(w.wezly.map((x) => [x.twId, x])), [w]);
  const wybranyWezel = tu !== null ? poId.get(tu) : undefined;

  return <Karta className={`p-3 ${w.wezly.length > DUZA_WYSPA ? "md:col-span-full" : ""}`}>
    <h3 className="text-sm font-bold" title={w.srodek.nazwa}>
      {w.srodek.symbol} <span className="font-normal text-slate-600">{w.srodek.nazwa}</span></h3>
    <p className="text-xs text-slate-600">
      {ile(w.pasowan, "pasowanie", "pasowania", "pasowań")} · {ile(w.wezly.length, "kartoteka", "kartoteki", "kartotek")}</p>
    {/* Nie większa niż naturalna: dwuwęzłowa wyspa rozciągnięta na całą
        kartę dałaby symbole wielkości nagłówka. W dół skaluje się sama. */}
    <svg viewBox={`0 0 ${u.szer} ${u.wys}`} className="mx-auto mt-2 block h-auto w-full"
      style={{ maxWidth: u.szer, maxHeight: 560 }}
      role="group" aria-label={`Wyspa ${w.srodek.symbol}`}>
      <defs>
        {KOLEJNOSC.map((r) => <marker key={r} id={`${id}-${r}`} viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className={STYL[r].grot} /></marker>)}
      </defs>
      {w.krawedzie.map((k, i) => <Krawedz key={i} k={k} u={u} role={role} id={id}
        blada={sasiedzi !== null && !(k.z === tu || k.do === tu)} />)}
      {w.wezly.map((x) => <Wezel key={x.twId} x={x} p={u.pozycje.get(x.twId)!} rola={role.get(x.twId) ?? "zamiennik"}
        wybrany={tu === x.twId} blady={sasiedzi !== null && !sasiedzi.has(x.twId)}
        trafiony={fraza !== "" && pasujeDoFrazy(x, fraza)} onWybierz={() => onWybierz(x.twId)} />)}
    </svg>
    {wybranyWezel && <Szczegoly x={wybranyWezel} krawedzie={w.krawedzie.filter((k) => k.z === tu || k.do === tu)} />}
  </Karta>;
}

function Krawedz({ k, u, role, id, blada }: {
  k: KrawedzSieci; u: Uklad; role: Map<number, RolaWezla>; id: string; blada: boolean;
}) {
  const a = u.pozycje.get(k.z); const b = u.pozycje.get(k.do);
  if (!a || !b) return null;
  /* Końce skrócone o promień węzła, inaczej grot chowa się pod kółkiem. */
  const dx = b.x - a.x; const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const ra = WEZEL[role.get(k.z) ?? "zamiennik"].r + 2;
  const rb = WEZEL[role.get(k.do) ?? "zamiennik"].r + 3;
  const s = STYL[k.rodzaj];
  /* Zamiennik nie ma kierunku w sensie „pasuje DO": grot tylko wtedy, gdy
     wymienia jeden opis — wtedy strzałka mówi, czyj opis to twierdzi. */
  const grot = k.rodzaj !== "zamiennik" || !k.obustronnie ? `url(#${id}-${k.rodzaj})` : undefined;
  return <line x1={a.x + (dx / d) * ra} y1={a.y + (dy / d) * ra} x2={b.x - (dx / d) * rb} y2={b.y - (dy / d) * rb}
    className={s.linia} strokeDasharray={s.kreska} markerEnd={grot}
    strokeWidth={k.rodzaj !== "zamiennik" && k.pewnosc === "potwierdzone" ? 2.5 : 1.5}
    opacity={blada ? 0.15 : 1}>
    <title>{k.zdanie}</title>
  </line>;
}

function Wezel({ x, p, rola, wybrany, blady, trafiony, onWybierz }: {
  x: KartotekaPasowania; p: { x: number; y: number }; rola: RolaWezla;
  wybrany: boolean; blady: boolean; trafiony: boolean; onWybierz: () => void;
}) {
  const w = WEZEL[rola];
  return <g role="button" tabIndex={0} aria-pressed={wybrany} aria-label={`${x.symbol} — ${x.nazwa}`}
    className="cursor-pointer outline-none" opacity={blady ? 0.25 : 1} onClick={onWybierz}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onWybierz(); } }}>
    <title>{`${x.symbol} — ${x.nazwa}`}</title>
    {/* Pole trafienia większe niż kółko: sześciopikselowy zamiennik to cel
        na precyzję, a mysz na blacie też ma swoją drżącą rękę. */}
    <circle cx={p.x} cy={p.y} r={16} className="fill-transparent" />
    {trafiony && <circle cx={p.x} cy={p.y} r={w.r + 6} className="fill-none stroke-sky-600" strokeWidth={2.5} />}
    {wybrany && <circle cx={p.x} cy={p.y} r={w.r + 4} className="fill-none stroke-wertis-ink" strokeWidth={2} />}
    <circle cx={p.x} cy={p.y} r={w.r} strokeWidth={1.5}
      strokeDasharray={rola === "zamiennik" ? "2 2" : undefined} className={w.klasa} />
    {/* Biała obwódka pod literami: krawędź przechodząca przez podpis
        przekreślała symbol w połowie, co pokazał pierwszy zrzut z seeda. */}
    <text x={p.x} y={p.y + w.r + 13} textAnchor="middle" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
      className={`fill-slate-800 stroke-white text-podpis ${wybrany || rola === "cel" ? "font-bold" : ""}`}>{x.symbol}</text>
  </g>;
}

function Szczegoly({ x, krawedzie }: { x: KartotekaPasowania; krawedzie: KrawedzSieci[] }) {
  const porzadek = [...krawedzie].sort((a, b) => KOLEJNOSC.indexOf(a.rodzaj) - KOLEJNOSC.indexOf(b.rodzaj));
  return <section className="mt-2 border-t border-slate-200 pt-2" aria-label={`Połączenia ${x.symbol}`}>
    <p className="text-sm"><b>{x.symbol}</b> <span className="text-slate-600">{x.nazwa}</span></p>
    <ul className="mt-1 space-y-1">
      {porzadek.map((k, i) => <li key={i} className="flex items-start gap-2 text-sm">
        <svg width="20" height="12" className="mt-1 shrink-0" aria-hidden="true">
          <line x1="1" y1="6" x2="19" y2="6" strokeWidth="2" strokeDasharray={STYL[k.rodzaj].kreska} className={STYL[k.rodzaj].linia} />
        </svg>
        <span><span className="sr-only">{STYL[k.rodzaj].nazwa}: </span>{k.zdanie}</span>
      </li>)}
    </ul>
  </section>;
}
