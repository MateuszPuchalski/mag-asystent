import React, { useEffect, useId, useRef, useState } from "react";
import { Ruler } from "lucide-react";
import {
  NA_STRONIE, useBezWymiarow, useZapiszPomiar, type PozycjaBezWymiarow, type Pomiar, type SortWymiarow,
} from "../api/wymiary";
import { Blad, EtykietaWartosci, Karta, Pole, Przycisk, Pusto, WierszKolejki, ile } from "../ui";
import { klawiszZajety } from "../nawigacja/fokus";
import { nastepnyWolny, sasiad } from "./Zdjecia";

/* ── WYMIARY: TOWARY BEZ WAGI ALBO WYMIARÓW ──────────────────────────────────
   Praca seryjna przy wadze i miarce: kartoteki Subiekta, którym brakuje wagi
   brutto, netto albo choć jednego wymiaru, jedna po drugiej. Lewa kolumna to lista, prawa
   to formularz pomiaru. Po zapisie ekran sam przechodzi do następnego towaru
   i stawia kursor w pierwszym polu (ergonomia, punkt 1).

   Pole zostawione puste nie jedzie do Subiekta. To, co kartoteka już ma,
   stoi pod polem jako „w Subiekcie", więc człowiek mierzy tylko braki,
   a wpisaniem liczby poprawia wartość złą.

   Skan kodu w polu szukania, który trafi w jeden towar, od razu go wybiera:
   ręka z czytnikiem nie musi sięgać po mysz (punkt 5). */

const SORTOWANIA: Array<{ wartosc: SortWymiarow; etykieta: string }> = [
  { wartosc: "sprzedaz", etykieta: "Najczęściej sprzedawane (30 dni)" },
  { wartosc: "stan", etykieta: "Największy stan" },
  { wartosc: "symbol", etykieta: "Symbol" },
  { wartosc: "nazwa", etykieta: "Nazwa" },
  { wartosc: "najnowsze", etykieta: "Najnowsze kartoteki" },
  { wartosc: "lokalizacja", etykieta: "Lokalizacja (obchód regałów)" },
];

const LICZBA = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 });

const POLA: Array<{ klucz: keyof Pomiar; etykieta: string; jednostka: string }> = [
  { klucz: "bruttoKg", etykieta: "Waga brutto", jednostka: "kg" },
  { klucz: "nettoKg", etykieta: "Waga netto", jednostka: "kg" },
  { klucz: "dlugosc", etykieta: "Długość", jednostka: "cm" },
  { klucz: "szerokosc", etykieta: "Szerokość", jednostka: "cm" },
  { klucz: "wysokosc", etykieta: "Wysokość", jednostka: "cm" },
];

const PUSTY: Pomiar = { bruttoKg: "", nettoKg: "", dlugosc: "", szerokosc: "", wysokosc: "" };

/** Co kartoteka już ma w danym polu, jako tekst; `null` = brak. */
function obecne(p: PozycjaBezWymiarow, klucz: keyof Pomiar): string | null {
  if (klucz === "bruttoKg") return p.brutto === null ? null : LICZBA.format(p.brutto);
  if (klucz === "nettoKg") return p.netto === null ? null : LICZBA.format(p.netto);
  return p[klucz];
}

/** Czego brakuje, krótko — „waga" i „wymiary" zamiast pojedynczych nazw, gdy brak wszystkich. */
export function braki(p: PozycjaBezWymiarow): string {
  const wymiary = (["dlugosc", "szerokosc", "wysokosc"] as const).filter((k) => !p[k]);
  const nazwy = { dlugosc: "długość", szerokosc: "szerokość", wysokosc: "wysokość" };
  return [
    p.brutto === null && p.netto === null ? "waga"
      : p.brutto === null ? "brutto" : p.netto === null ? "netto" : null,
    ...(wymiary.length === 3 ? ["wymiary"] : wymiary.map((k) => nazwy[k])),
  ].filter(Boolean).join(", ");
}

function Wiersz({ p, wybrany, wKolejce, onWybierz }: {
  p: PozycjaBezWymiarow; wybrany: boolean; wKolejce: boolean; onWybierz: () => void;
}) {
  const tresc = <>
    <span className="flex items-baseline justify-between gap-2">
      <span className="truncate font-mono text-sm text-slate-800">{p.symbol}</span>
      {wKolejce ? <EtykietaWartosci className="shrink-0">w kolejce</EtykietaWartosci>
        : <span className="shrink-0 text-sm tabular-nums text-slate-600">
            <span className={p.sprzedaz > 0 ? "font-semibold text-slate-800" : undefined}
              title="Sztuki sprzedane w ostatnich 30 dniach">sprzedano {LICZBA.format(p.sprzedaz)}</span>
            {" · "}stan {LICZBA.format(p.stan)}</span>}
    </span>
    <span className={`line-clamp-2 text-sm ${wKolejce ? "text-slate-500" : "text-slate-900"}`}>{p.nazwa}</span>
    {!wKolejce && <span className="text-sm text-slate-600">
      {p.lokalizacja && <span className="font-mono text-slate-800">{p.lokalizacja} · </span>}brak: {braki(p)}</span>}
  </>;
  if (!wKolejce) return <WierszKolejki aktywny={wybrany} onKlik={onWybierz}>{tresc}</WierszKolejki>;
  return <li>
    <button type="button" disabled title="Pomiar tego towaru czeka w kolejce do Subiekta"
      className="flex w-full cursor-not-allowed flex-col border-l-[3px] border-l-transparent px-4 py-2 text-left">
      {tresc}
    </button>
  </li>;
}

/**
 * Formularz pomiaru jednego towaru.
 *
 * Enter w polu przechodzi do następnego, a w ostatnim zapisuje: waga
 * i miarka zajmują ręce, więc całość ma się dać przejść samą klawiaturą.
 * Kursor startuje w pierwszym polu, którego kartoteka nie ma.
 */
function Formularz({ towar, onZapisano, onPomin }: {
  towar: PozycjaBezWymiarow; onZapisano: () => void; onPomin?: () => void;
}) {
  const [pomiar, setPomiar] = useState<Pomiar>(PUSTY);
  const id = useId();
  const zapis = useZapiszPomiar();
  const pola = useRef<Array<HTMLInputElement | null>>([]);
  const pierwszyBrak = Math.max(0, POLA.findIndex((p) => obecne(towar, p.klucz) === null));
  useEffect(() => { pola.current[pierwszyBrak]?.focus(); }, [pierwszyBrak]);

  const cokolwiek = Object.values(pomiar).some((v) => v.trim() !== "");
  const wyslij = () => {
    if (!cokolwiek || zapis.isPending) return;
    zapis.mutate({ twId: towar.twId, pomiar }, { onSuccess: onZapisano });
  };
  const klawisz = (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i < POLA.length - 1) pola.current[i + 1]?.focus();
    else wyslij();
  };

  return <form className="flex flex-col gap-4 p-4" onSubmit={(e) => { e.preventDefault(); wyslij(); }}>
    <div>
      <p className="font-mono text-sm text-slate-600">{towar.symbol}{towar.ean ? ` · ${towar.ean}` : ""}</p>
      <h2 className="text-lg font-semibold text-slate-900">{towar.nazwa}</h2>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {POLA.map((p, i) => {
        const jest = obecne(towar, p.klucz);
        /* Podpis „w Subiekcie" opisuje pole, ale nie jest jego nazwą — stąd
           `aria-describedby`, a nie wnętrze etykiety. */
        return <div key={p.klucz} className="flex flex-col gap-1 text-sm text-slate-700">
          <label htmlFor={`${id}-${p.klucz}`} className="font-semibold">{p.etykieta} ({p.jednostka})</label>
          <input id={`${id}-${p.klucz}`} aria-describedby={`${id}-${p.klucz}-jest`}
            ref={(el) => { pola.current[i] = el; }} className="field" inputMode="decimal"
            autoComplete="off" value={pomiar[p.klucz]} onKeyDown={klawisz(i)}
            onChange={(e) => setPomiar({ ...pomiar, [p.klucz]: e.target.value })}
            placeholder={jest ?? "np. 12,5"} />
          <span id={`${id}-${p.klucz}-jest`} className="text-podpis text-slate-600">
            {jest === null ? "W Subiekcie: brak" : `W Subiekcie: ${jest} ${p.jednostka}`}</span>
        </div>;
      })}
    </div>
    {zapis.error && <Blad>{(zapis.error as Error).message}</Blad>}
    <div className="flex flex-wrap gap-2">
      <Przycisk type="submit" wariant="glowny" disabled={!cokolwiek || zapis.isPending}>
        {zapis.isPending ? "Zapisuję…" : "Zapisz pomiar"}</Przycisk>
      {onPomin && <Przycisk type="button" onClick={onPomin}>Pomiń</Przycisk>}
    </div>
    <p className="text-sm text-slate-600">Puste pole zostaje w Subiekcie bez zmian. Enter przechodzi
      do następnego pola, w ostatnim zapisuje.</p>
  </form>;
}

export function Wymiary() {
  const [fraza, setFraza] = useState("");
  /* Szukanie liczy serwer — ćwierć sekundy przerwy, jak na ekranie zdjęć. */
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortuj, setSortuj] = useState<SortWymiarow>("sprzedaz");
  const [naStanie, setNaStanie] = useState(false);
  const [sprzedane, setSprzedane] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setQ(fraza.trim()); setOffset(0); }, 250);
    return () => clearTimeout(t);
  }, [fraza]);
  const lista = useBezWymiarow(q, offset, sortuj, naStanie, sprzedane);
  const [wybrany, setWybrany] = useState<PozycjaBezWymiarow | null>(null);
  const [zrobione, setZrobione] = useState<ReadonlySet<number>>(() => new Set());
  const [ostatni, setOstatni] = useState("");

  const pozycje = lista.data?.pozycje ?? [];
  const wolny = (p: PozycjaBezWymiarow) => !p.oczekuje && !zrobione.has(p.twId);
  /* Pierwszy wolny towar wybiera się sam — wybór nie jest zapisem.
     Szukanie trafiające w jeden towar (skan kodu) przełącza na niego. */
  const jedyny = q && pozycje.length === 1 && wolny(pozycje[0]) ? pozycje[0] : null;
  useEffect(() => {
    if (jedyny) { if (wybrany?.twId !== jedyny.twId) setWybrany(jedyny); return; }
    if (wybrany) return;
    const p = pozycje.find((x) => !x.oczekuje && !zrobione.has(x.twId));
    if (p) setWybrany(p);
  }, [jedyny, pozycje, wybrany, zrobione]);

  /* j/k jak na ekranie zdjęć i w kolejkach obsługi. Słuchacz czyta ref, bo wstaje raz. */
  const ruch = useRef<(e: KeyboardEvent) => void>(() => undefined);
  ruch.current = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || klawiszZajety(e.target)) return;
    if (e.key !== "j" && e.key !== "k") return;
    const p = sasiad(pozycje, wybrany?.twId ?? null, e.key === "j" ? 1 : -1, zrobione);
    if (p) { e.preventDefault(); setWybrany(p); setOstatni(""); }
  };
  useEffect(() => {
    const sluchaj = (e: KeyboardEvent) => ruch.current(e);
    window.addEventListener("keydown", sluchaj);
    return () => window.removeEventListener("keydown", sluchaj);
  }, []);

  if (lista.data && !lista.data.wlaczone) {
    return <Karta className="flex lg:h-full">
      <Pusto ikona={Ruler}>{lista.data.powod ?? "Wymiary są w tej instalacji wyłączone."}</Pusto>
    </Karta>;
  }

  const zapisano = (biezacy: PozycjaBezWymiarow) => () => {
    const nowe = new Set(zrobione).add(biezacy.twId);
    setZrobione(nowe);
    setOstatni(`Zapisano pomiar ${biezacy.symbol}. Do Subiekta trafi z kolejki za chwilę.`);
    setWybrany(nastepnyWolny(pozycje, biezacy.twId, nowe));
  };

  /* „Pomiń” niczego nie zapisuje: towar zostaje na liście, a ekran idzie dalej. */
  const pomin = (biezacy: PozycjaBezWymiarow) => {
    const p = nastepnyWolny(pozycje, biezacy.twId, zrobione);
    return p ? () => { setWybrany(p); setOstatni(""); } : undefined;
  };

  const razem = lista.data?.razem;
  /* Awaria bazy Subiekta (503) to nie wyłączona funkcja — mija sama, więc obok stoi ponowienie. */
  const bladListy = lista.error && <div className="flex flex-col gap-2 p-2">
    <Blad>{(lista.error as Error).message}</Blad>
    <Przycisk onClick={() => void lista.refetch()} disabled={lista.isFetching}>
      {lista.isFetching ? "Pytam jeszcze raz…" : "Spróbuj jeszcze raz"}</Przycisk>
  </div>;
  const lewa = lista.isLoading ? <Pusto waga="lista">Wczytuję towary bez wymiarów…</Pusto>
    /* Błąd bez danych zamiast „wszystko zmierzone” — awaria to nie koniec pracy. */
    : lista.error && !lista.data ? bladListy
    : pozycje.length === 0 ? <Pusto waga="lista">{q ? "Nic nie pasuje do szukania."
        : sprzedane ? "Każdy towar sprzedany w 30 dni ma wagę i wymiary."
        : naStanie ? "Każdy towar na stanie ma wagę i wymiary." : "Każdy towar ma wagę i wymiary."}</Pusto>
    : <ul className="divide-y divide-slate-100">
        {pozycje.map((p) => <Wiersz key={p.twId} p={p} wybrany={wybrany?.twId === p.twId}
          wKolejce={!wolny(p)} onWybierz={() => { setWybrany(p); setOstatni(""); }} />)}
      </ul>;

  return <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[23rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)]">
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 p-2">
        <Pole value={fraza} onChange={(e) => setFraza(e.target.value)}
          placeholder="Symbol, nazwa albo EAN" aria-label="Szukaj towaru bez wymiarów" />
        {/* Zmiana porządku albo filtra wraca na pierwszą stronę. */}
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">Kolejność
          <select className="field min-w-0 flex-1" value={sortuj}
            onChange={(e) => { setSortuj(e.target.value as SortWymiarow); setOffset(0); }}>
            {SORTOWANIA.map((s) => <option key={s.wartosc} value={s.wartosc}>{s.etykieta}</option>)}
          </select>
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-x-4">
          <label className="flex min-h-10 items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={sprzedane}
              onChange={(e) => { setSprzedane(e.target.checked); setOffset(0); }} />
            Sprzedane w 30 dni
          </label>
          <label className="flex min-h-10 items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={naStanie}
              onChange={(e) => { setNaStanie(e.target.checked); setOffset(0); }} />
            Tylko na stanie
          </label>
        </div>
      </div>
      <div className="shrink-0 border-y border-slate-200 bg-slate-50 px-3 py-1">
        <span className="text-xs font-semibold text-slate-600">
          {razem === undefined ? "Towary bez wymiarów" : `${ile(razem, "towar", "towary", "towarów")} bez wagi lub wymiarów`}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{lewa}</div>
      {lista.data && bladListy}
      {razem !== undefined && razem > NA_STRONIE && <nav aria-label="Strony listy"
        className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 p-2 text-sm text-slate-600">
        <Przycisk disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - NA_STRONIE))}>Wstecz</Przycisk>
        <span>{offset + 1}–{Math.min(offset + NA_STRONIE, razem)} z {razem}</span>
        <Przycisk disabled={offset + NA_STRONIE >= razem} onClick={() => setOffset(offset + NA_STRONIE)}>Dalej</Przycisk>
      </nav>}
    </Karta>
    <Karta className="flex min-h-0 flex-col overflow-y-auto">
      {ostatni && <p role="status" className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{ostatni}</p>}
      {wybrany
        /* Klucz po towarze: nowy towar to świeży formularz z pustymi polami. */
        ? <Formularz key={wybrany.twId} towar={wybrany} onZapisano={zapisano(wybrany)} onPomin={pomin(wybrany)} />
        : <Pusto ikona={Ruler}>{pozycje.length ? "Wybierz towar z listy." : "Nie ma towaru do zmierzenia."}</Pusto>}
    </Karta>
  </div>;
}
