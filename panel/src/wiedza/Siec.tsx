import React, { useId, useMemo, useState } from "react";
import { Crosshair, Network } from "lucide-react";
import type { KrawedzSieci, RodzajKrawedzi, TrafieniePasowania, WarstwaSieci, WezelSieci } from "../api/typy";
import { useSiecWiedzy, useWiedzaTowaru } from "../api/wiedza";
import { Blad, FiltrSegmentowy, Karta, Pole, Przycisk, Pusto, ile } from "../ui";
import {
  WARSTWY, naWarstwach, otoczenie, pasujeDoFrazy, roleWezlow, uklad, wedlugTrafnosci, wyspy, zwin,
  type RolaWezla, type Uklad, type Wyspa,
} from "./siec-uklad";

/* ── Sieć wiedzy: co z czym pasuje, na jednym obrazku ────────────────────────
   Zakładka „Sprawdź kartotekę" odpowiada na pytanie o JEDNĄ część. Tu biuro
   widzi całość naraz i łańcuch, którego żaden inny ekran nie składa:
   uszczelka → gaźnik → silnik GX160 → kosiarki, w których on stoi. Widać
   też, które gaźniki mają komplet uszczelek, gdzie stoi sam negatyw, co
   czeka w kolejce i które symbole łączy wyłącznie opis kartoteki.

   To jest WGLĄD, nie praca. Ekran nie ma ani jednego przycisku zapisu —
   rozstrzyga się w kolejce, dopisuje w „Sprawdź kartotekę", do której
   prowadzi przycisk przy wybranej części. Dwie drogi do tego samego zapisu
   to dwa miejsca, w których reguła §14.2 może się rozjechać.

   BARWY ZNACZĄ TO SAMO, CO W RESZCIE WIEDZY. Zieleń — pasuje, czerwień — nie
   pasuje, bursztyn — czeka na decyzję (rodzina „uwaga", nie zaznaczenie),
   łupek — odczyt opisu, błękit — maszyny i silniki. Wybrany węzeł dostaje
   atrament, nie bursztyn: `Bursztyn.test` pilnuje, żeby bursztyn nie wrócił
   jako barwa wyboru. Kreska niesie rodzaj krawędzi drugi raz, a kształt —
   rodzaj węzła, bo czerwień i zieleń to para, której część ludzi nie
   rozróżnia. */

type Styl = { linia: string; grot: string; kreska?: string; nazwa: string };

/* Stopnie z kontrastem ≥ 3:1 na bieli, próg WCAG dla znaków graficznych —
   ten sam rachunek, który w `ui/wykres.tsx` zdjął jasny bursztyn ze słupków. */
const STYL: Record<RodzajKrawedzi, Styl> = {
  pasuje: { linia: "stroke-emerald-700", grot: "fill-emerald-700", nazwa: "pasuje" },
  nie_pasuje: { linia: "stroke-red-700", grot: "fill-red-700", kreska: "7 4", nazwa: "nie pasuje" },
  propozycja: { linia: "stroke-amber-600", grot: "fill-amber-600", kreska: "3 3", nazwa: "czeka w kolejce" },
  zabudowa: { linia: "stroke-sky-800", grot: "fill-sky-800", nazwa: "silnik stoi w maszynie" },
  zamiennik: { linia: "stroke-slate-500", grot: "fill-slate-500", kreska: "1 4", nazwa: "zamiennik z opisu" },
};
const KOLEJNOSC: RodzajKrawedzi[] = ["pasuje", "nie_pasuje", "propozycja", "zabudowa", "zamiennik"];

/** `r` to promień kółka albo pół przekątnej kwadratu — tyle skraca się krawędź. */
const WEZEL: Record<RolaWezla, { r: number; klasa: string; nazwa: string }> = {
  cel: { r: 10, klasa: "fill-wertis-ink stroke-wertis-ink", nazwa: "do czego (np. gaźnik)" },
  czesc: { r: 7, klasa: "fill-white stroke-slate-700", nazwa: "część (np. uszczelka)" },
  zamiennik: { r: 6, klasa: "fill-slate-100 stroke-slate-500", nazwa: "tylko z opisu" },
  maszyna: { r: 9, klasa: "fill-sky-800 stroke-sky-800", nazwa: "maszyna" },
  silnik: { r: 10, klasa: "fill-white stroke-sky-800", nazwa: "silnik" },
};
const ROLE: RolaWezla[] = ["cel", "czesc", "zamiennik", "maszyna", "silnik"];

const NAZWA_WARSTWY: Record<WarstwaSieci, string> = {
  pasowania: "Część do części",
  zastosowania: "Części do maszyn",
  zabudowy: "Silniki w maszynach",
  zamienniki: "Zamienniki z opisów",
};

/**
 * Wyspa większa niż tyle węzłów nie rysuje się sama. Sto dwadzieścia kształtów
 * z podpisami to już mapa do studiowania, nie odpowiedź — i sekundy rachunku
 * przy każdym otwarciu. Droga na skróty: szukanie i otoczenie.
 */
const WYSPA_DO_ZGODY = 120;
/** Wyspa szersza niż tyle węzłów idzie przez całą szerokość — w kolumnie byłaby nieczytelna. */
const DUZA_WYSPA = 9;
/** Tyle trafień szukania dostaje skrót do otoczenia; więcej to już lista, nie skrót. */
const SKROTOW = 8;

export type KartotekaDoOtwarcia = { twId: number; symbol: string; nazwa: string };

export function Siec({ onOtworzKartoteke }: {
  /** Przejście do „Sprawdź kartotekę" — tam się dopisuje i wycofuje. */
  onOtworzKartoteke?: (k: KartotekaDoOtwarcia) => void;
}) {
  const siec = useSiecWiedzy();
  const [warstwy, setWarstwy] = useState<ReadonlySet<WarstwaSieci>>(() => new Set(WARSTWY));
  const [szukaj, setSzukaj] = useState("");
  const [wybrany, setWybrany] = useState<string | null>(null);
  const [ognisko, setOgnisko] = useState<{ klucz: string; kroki: number } | null>(null);

  const pelna = useMemo(() => siec.data ? naWarstwach(siec.data, warstwy) : null, [siec.data, warstwy]);
  const wyspPelnych = useMemo(() => pelna ? wyspy(pelna).length : 0, [pelna]);
  const widok = useMemo(() => pelna && ognisko ? otoczenie(pelna, ognisko.klucz, ognisko.kroki) : pelna,
    [pelna, ognisko]);
  const lista = useMemo(() => widok ? wyspy(widok) : [], [widok]);
  const fraza = zwin(szukaj);

  if (siec.error) return <Blad>{(siec.error as Error).message}</Blad>;
  if (siec.isLoading || !siec.data || !pelna || !widok) return <p className="text-sm text-slate-500">Wczytuję sieć…</p>;
  const dane = siec.data;
  const wiedzy = dane.krawedzie.filter((k) => k.warstwa !== "zamienniki").length;
  if (wiedzy === 0) {
    return <Pusto waga="lista" ikona={Network}>
      Nie ma jeszcze żadnego pasowania ani zastosowania. Dopisuje się je w „Sprawdź kartotekę", w kolejce
      albo z rozmowy przez Copilota.
    </Pusto>;
  }

  const widoczne = fraza && !ognisko ? lista.filter((w) => w.wezly.some((x) => pasujeDoFrazy(x, fraza))) : lista;
  /* Skróty do otoczenia: przy jednej wielkiej wyspie samo zawężenie nic nie
     daje — trzeba wskazać, OD KTÓREGO węzła patrzeć. */
  const trafienia = fraza && !ognisko ? wedlugTrafnosci(pelna.wezly, fraza) : [];
  const naWarstwie = (w: WarstwaSieci) => dane.krawedzie.filter((k) => k.warstwa === w).length;
  const wezelOgniska = ognisko ? pelna.wezly.find((w) => w.klucz === ognisko.klucz) : undefined;
  const skupNa = (klucz: string) => { setOgnisko({ klucz, kroki: ognisko?.kroki ?? 2 }); setWybrany(klucz); };

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="mr-auto text-sm text-slate-600">
        {ile(wiedzy, "powiązanie", "powiązania", "powiązań")} · {ile(pelna.wezly.length, "węzeł", "węzły", "węzłów")}
        {" · "}{ile(wyspPelnych, "wyspa", "wyspy", "wysp")}
      </p>
      <Pole className="w-64" aria-label="Szukaj w sieci" placeholder="Symbol, nazwa albo maszyna" value={szukaj}
        onChange={(e) => { setSzukaj(e.target.value); setOgnisko(null); }} />
    </div>

    <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
      <legend className="sr-only">Warstwy sieci</legend>
      {WARSTWY.map((w) => <label key={w} className="flex items-center gap-2">
        <input type="checkbox" checked={warstwy.has(w)} onChange={(e) => {
          const nowe = new Set(warstwy);
          if (e.target.checked) nowe.add(w); else nowe.delete(w);
          setWarstwy(nowe);
        }} />
        {NAZWA_WARSTWY[w]} <span className="tabular-nums text-slate-500">{naWarstwie(w)}</span>
      </label>)}
    </fieldset>

    {trafienia.length > 0 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pokaż otoczenie">
      <span className="text-xs text-slate-600">Otoczenie:</span>
      {trafienia.slice(0, SKROTOW).map((x) => <button key={x.klucz} type="button" onClick={() => skupNa(x.klucz)}
        title={x.nazwa} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
        <Crosshair size={12} aria-hidden="true" />{x.etykieta}</button>)}
      {trafienia.length > SKROTOW && <span className="text-xs text-slate-600">i {trafienia.length - SKROTOW} więcej — zawęź szukanie</span>}
    </div>}

    {ognisko && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm">
      <Crosshair size={16} aria-hidden="true" />
      <span>Otoczenie <b>{wezelOgniska?.etykieta ?? ognisko.klucz}</b></span>
      <span className="ml-2 text-xs text-slate-600">kroków:</span>
      <FiltrSegmentowy<number> wybrany={ognisko.kroki} onWybierz={(kroki) => setOgnisko({ ...ognisko, kroki })}
        pozycje={[1, 2, 3].map((n) => ({ klucz: n, etykieta: String(n) }))}
        ton={["bg-wertis-ink text-white", "bg-white text-slate-600 hover:bg-slate-200"]} />
      <Przycisk className="ml-auto text-xs" onClick={() => setOgnisko(null)}>Wróć do całości</Przycisk>
    </div>}

    <Legenda />
    {widoczne.length === 0 && <Pusto waga="lista">
      {fraza ? <>Żadna wyspa nie ma węzła pasującego do „{szukaj}".</> : <>Włącz choć jedną warstwę.</>}
    </Pusto>}
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {widoczne.map((w) => <KartaWyspy key={w.srodek.klucz} w={w} fraza={fraza} wybrany={wybrany}
        zgoda={ognisko !== null} onWybierz={(k) => setWybrany((v) => v === k ? null : k)}
        onOgnisko={skupNa} onOtworzKartoteke={onOtworzKartoteke} />)}
    </div>
  </div>;
}

function Legenda() {
  return <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legenda">
    {KOLEJNOSC.map((r) => <li key={r} className="flex items-center gap-1.5">
      <svg width="28" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="27" y2="4" strokeWidth="2" strokeDasharray={STYL[r].kreska} className={STYL[r].linia} />
      </svg>{STYL[r].nazwa}</li>)}
    {ROLE.map((r) => <li key={r} className="flex items-center gap-1.5">
      <svg width="24" height="24" aria-hidden="true"><Ksztalt rola={r} x={12} y={12} /></svg>{WEZEL[r].nazwa}</li>)}
  </ul>;
}

/** Kształt węzła. Maszyna — kwadrat, silnik — romb, kartoteka — kółko. */
function Ksztalt({ rola, x, y }: { rola: RolaWezla; x: number; y: number }) {
  const w = WEZEL[rola];
  if (rola === "maszyna") {
    const b = w.r * 0.8;
    return <rect x={x - b} y={y - b} width={2 * b} height={2 * b} rx={2} strokeWidth={1.5} className={w.klasa} />;
  }
  if (rola === "silnik") {
    return <polygon points={`${x},${y - w.r} ${x + w.r},${y} ${x},${y + w.r} ${x - w.r},${y}`} strokeWidth={2.5}
      strokeLinejoin="round" className={w.klasa} />;
  }
  return <circle cx={x} cy={y} r={w.r} strokeWidth={1.5}
    strokeDasharray={rola === "zamiennik" ? "2 2" : undefined} className={w.klasa} />;
}

function KartaWyspy({ w, fraza, wybrany, zgoda, onWybierz, onOgnisko, onOtworzKartoteke }: {
  w: Wyspa; fraza: string; wybrany: string | null;
  /** W otoczeniu nie pytamy o zgodę na rysunek — człowiek właśnie zawęził widok sam. */
  zgoda: boolean;
  onWybierz: (klucz: string) => void; onOgnisko: (klucz: string) => void;
  onOtworzKartoteke?: (k: KartotekaDoOtwarcia) => void;
}) {
  const [narysuj, setNarysuj] = useState(false);
  const duza = w.wezly.length > WYSPA_DO_ZGODY && !zgoda && !narysuj;
  return <Karta className={`p-3 ${w.wezly.length > DUZA_WYSPA ? "md:col-span-full" : ""}`}>
    <h3 className="text-sm font-bold" title={w.srodek.nazwa}>
      {w.srodek.etykieta} <span className="font-normal text-slate-600">{w.srodek.nazwa}</span></h3>
    <p className="text-xs text-slate-600">
      {ile(w.wiedzy, "powiązanie", "powiązania", "powiązań")} · {ile(w.wezly.length, "węzeł", "węzły", "węzłów")}</p>
    {duza
      ? <div className="mt-2 space-y-2 text-sm text-slate-700">
        <p>Ta wyspa ma {ile(w.wezly.length, "węzeł", "węzły", "węzłów")} — na jednym rysunku nie da się jej przeczytać.
          Wpisz symbol w szukaniu i wybierz otoczenie albo narysuj całość.</p>
        <Przycisk className="text-xs" onClick={() => setNarysuj(true)}>Narysuj mimo to</Przycisk>
      </div>
      : <Rysunek w={w} fraza={fraza} wybrany={wybrany} onWybierz={onWybierz} onOgnisko={onOgnisko}
        onOtworzKartoteke={onOtworzKartoteke} />}
  </Karta>;
}

function Rysunek({ w, fraza, wybrany, onWybierz, onOgnisko, onOtworzKartoteke }: {
  w: Wyspa; fraza: string; wybrany: string | null;
  onWybierz: (klucz: string) => void; onOgnisko: (klucz: string) => void;
  onOtworzKartoteke?: (k: KartotekaDoOtwarcia) => void;
}) {
  /* `useId` oddaje dwukropki albo nawiasy kątowe, zależnie od wydania Reacta,
     a `url(#…)` w atrybucie grotu tych znaków nie przełknie bez ucieczki. */
  const id = `siec${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const u = useMemo(() => uklad(w), [w]);
  const role = useMemo(() => roleWezlow(w.wezly, w.krawedzie), [w]);
  const [podglad, setPodglad] = useState<string | null>(null);
  const tu = wybrany !== null && u.pozycje.has(wybrany) ? wybrany : null;
  /* Podgląd pod kursorem wygrywa z wyborem: najechanie to pytanie „a to?",
     a wybór zostaje w szczegółach pod rysunkiem. */
  const swiatlo = podglad ?? tu;
  /* Sąsiedzi zostają w pełnym kolorze, reszta blednie — jedno spojrzenie
     odpowiada „co z tym", bez czytania całej wyspy. */
  const sasiedzi = useMemo(() => {
    if (swiatlo === null) return null;
    const s = new Set([swiatlo]);
    for (const k of w.krawedzie) if (k.z === swiatlo || k.do === swiatlo) { s.add(k.z); s.add(k.do); }
    return s;
  }, [swiatlo, w]);
  const wybranyWezel = tu !== null ? w.wezly.find((x) => x.klucz === tu) : undefined;

  return <>
    {/* NATURALNA SKALA Z PRZEWIJANIEM, nie dopasowanie do karty. Wyspa
        ściśnięta do szerokości kolumny dawała symbole po sześć pikseli;
        przewinięcie kosztuje ruch, a nieczytelny podpis — cały rysunek. */}
    <div className="mt-2 max-h-[40rem] overflow-auto">
      <svg viewBox={`0 0 ${u.szer} ${u.wys}`} width={u.szer} height={u.wys} className="mx-auto block"
        role="group" aria-label={`Wyspa ${w.srodek.etykieta}`}>
        <defs>
          {KOLEJNOSC.map((r) => <marker key={r} id={`${id}-${r}`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={STYL[r].grot} /></marker>)}
        </defs>
        {w.krawedzie.map((k, i) => <Krawedz key={i} k={k} u={u} role={role} id={id}
          blada={sasiedzi !== null && !(k.z === swiatlo || k.do === swiatlo)} />)}
        {w.wezly.map((x) => <Wezel key={x.klucz} x={x} p={u.pozycje.get(x.klucz)!} rola={role.get(x.klucz) ?? "zamiennik"}
          wybrany={tu === x.klucz} blady={sasiedzi !== null && !sasiedzi.has(x.klucz)}
          trafiony={fraza !== "" && pasujeDoFrazy(x, fraza)} onWybierz={() => onWybierz(x.klucz)}
          onPodglad={(tak) => setPodglad(tak ? x.klucz : null)} />)}
      </svg>
    </div>
    {wybranyWezel && <Szczegoly x={wybranyWezel} krawedzie={w.krawedzie.filter((k) => k.z === tu || k.do === tu)}
      onOgnisko={() => onOgnisko(wybranyWezel.klucz)} onOtworzKartoteke={onOtworzKartoteke} />}
  </>;
}

function Krawedz({ k, u, role, id, blada }: {
  k: KrawedzSieci; u: Uklad; role: Map<string, RolaWezla>; id: string; blada: boolean;
}) {
  const a = u.pozycje.get(k.z); const b = u.pozycje.get(k.do);
  if (!a || !b) return null;
  /* Końce skrócone o promień węzła, inaczej grot chowa się pod kształtem. */
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
    opacity={blada ? 0.12 : 1}>
    <title>{k.zdanie}</title>
  </line>;
}

function Wezel({ x, p, rola, wybrany, blady, trafiony, onWybierz, onPodglad }: {
  x: WezelSieci; p: { x: number; y: number }; rola: RolaWezla;
  wybrany: boolean; blady: boolean; trafiony: boolean; onWybierz: () => void; onPodglad: (tak: boolean) => void;
}) {
  const w = WEZEL[rola];
  return <g role="button" tabIndex={0} aria-pressed={wybrany} aria-label={`${x.etykieta} — ${x.nazwa}`}
    className="cursor-pointer outline-none" opacity={blady ? 0.25 : 1} onClick={onWybierz}
    onMouseEnter={() => onPodglad(true)} onMouseLeave={() => onPodglad(false)}
    onFocus={() => onPodglad(true)} onBlur={() => onPodglad(false)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onWybierz(); } }}>
    <title>{`${x.etykieta} — ${x.nazwa}`}</title>
    {/* Pole trafienia większe niż kształt: sześciopikselowy zamiennik to cel
        na precyzję, a mysz na blacie też ma swoją drżącą rękę. */}
    <circle cx={p.x} cy={p.y} r={16} className="fill-transparent" />
    {trafiony && <circle cx={p.x} cy={p.y} r={w.r + 7} className="fill-none stroke-sky-600" strokeWidth={2.5} />}
    {wybrany && <circle cx={p.x} cy={p.y} r={w.r + 5} className="fill-none stroke-wertis-ink" strokeWidth={2} />}
    <Ksztalt rola={rola} x={p.x} y={p.y} />
    {/* Biała obwódka pod literami: krawędź przechodząca przez podpis
        przekreślała symbol w połowie, co pokazał pierwszy zrzut z seeda. */}
    <text x={p.x} y={p.y + w.r + 13} textAnchor="middle" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
      className={`fill-slate-800 stroke-white text-podpis ${wybrany || rola === "cel" || rola === "maszyna" ? "font-bold" : ""}`}>
      {x.etykieta}</text>
  </g>;
}

function Szczegoly({ x, krawedzie, onOgnisko, onOtworzKartoteke }: {
  x: WezelSieci; krawedzie: KrawedzSieci[]; onOgnisko: () => void;
  onOtworzKartoteke?: (k: KartotekaDoOtwarcia) => void;
}) {
  const porzadek = [...krawedzie].sort((a, b) => KOLEJNOSC.indexOf(a.rodzaj) - KOLEJNOSC.indexOf(b.rodzaj));
  return <section className="mt-2 border-t border-slate-200 pt-2" aria-label={`Połączenia ${x.etykieta}`}>
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-sm"><b>{x.etykieta}</b> <span className="text-slate-600">{x.nazwa}</span></p>
      <Przycisk className="text-xs" onClick={onOgnisko}>Pokaż otoczenie</Przycisk>
      {x.twId !== null && onOtworzKartoteke && <Przycisk className="text-xs"
        onClick={() => onOtworzKartoteke({ twId: x.twId!, symbol: x.etykieta, nazwa: x.nazwa })}>
        Otwórz w „Sprawdź kartotekę"</Przycisk>}
    </div>
    <ul className="mt-1 space-y-1">
      {porzadek.map((k, i) => <Zdanie key={i} rodzaj={k.rodzaj}>{k.zdanie}</Zdanie>)}
    </ul>
    {x.twId !== null && <Wnioski twId={x.twId} />}
  </section>;
}

/**
 * Wnioski przez zamienniki dla wybranej kartoteki. Rysunek pokazuje
 * przesłanki; tu serwer mówi wprost, co z nich wynika — tym samym odczytem,
 * którego używa „Sprawdź kartotekę" i dobór. Jeden GET, zero zapisu.
 */
function Wnioski({ twId }: { twId: number }) {
  const wiedza = useWiedzaTowaru(twId);
  const p = wiedza.data?.pasowania;
  const przez: TrafieniePasowania[] = p ? [...p.pasujeDo, ...p.pasujace].filter((t) => t.przezZamiennik !== null) : [];
  if (wiedza.isLoading) return <p className="mt-2 text-xs text-slate-600">Sprawdzam wnioski przez zamienniki…</p>;
  if (przez.length === 0) return null;
  return <div className="mt-2" aria-label="Wnioski przez zamienniki">
    <p className="text-xs font-semibold text-slate-600">Wynika przez zamienniki — prawdopodobne, nie potwierdzone</p>
    <ul className="mt-1 space-y-1">
      {przez.map((t, i) => <Zdanie key={i} rodzaj="zamiennik">{t.zdanie}</Zdanie>)}
    </ul>
  </div>;
}

function Zdanie({ rodzaj, children }: { rodzaj: RodzajKrawedzi; children: React.ReactNode }) {
  return <li className="flex items-start gap-2 text-sm">
    <svg width="20" height="12" className="mt-1 shrink-0" aria-hidden="true">
      <line x1="1" y1="6" x2="19" y2="6" strokeWidth="2" strokeDasharray={STYL[rodzaj].kreska} className={STYL[rodzaj].linia} />
    </svg>
    <span><span className="sr-only">{STYL[rodzaj].nazwa}: </span>{children}</span>
  </li>;
}
