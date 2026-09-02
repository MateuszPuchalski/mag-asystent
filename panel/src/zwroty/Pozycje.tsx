import React, { useMemo, useState } from "react";
import { Check, X as Krzyzyk } from "lucide-react";
import type { PozycjaZwrotu, Zwrot } from "../api/typy";
import { usePotwierdzKartoteke, zlote } from "../api/zwroty";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { Przycisk, Blad } from "../ui";
import { Zdjecie } from "./Zdjecie";
import { Powiekszenie } from "./Powiekszenie";
import { Rabat } from "./Rabat";
import { Link } from "./Link";

/* ── Produkty ze zwrotu (0.167.0) ────────────────────────────────────────────
   Do 0.165.0 pozycje stały w PRAWEJ kolumnie, szerokiej na 340 px: nazwy
   ucinały się w połowie („Podkaszarka elektry…"), zdjęcia miały 56 px, a
   środek ekranu — najszerszy — świecił pustką pod paskiem decyzji. Decyzja
   właściciela: produkty idą do głównego okna.

   Razem z nimi przeniosła się AKCJA. Do 0.165.0 kubełki DO OCENY i DO ZWROTU
   wypisywały te same pozycje drugi raz, jako gołe nazwy z przyciskami — bez
   zdjęcia, bez powodu zwrotu, bez kartoteki. Operator oceniał towar, patrząc
   na listę, która towaru nie pokazywała. Teraz jest jeden wiersz produktu,
   a przycisk oceny albo pole zaznaczenia stoją na nim.

   Prawa kolumna zostaje kolumną DOWODÓW: zegar ustawowy, numery, zamówienie,
   paczka. To rzeczy o zwrocie, nie o towarze.                               */

/* Siedemnaście powodów, bo tyle wymienia SCHEMAT Allegro (0.169.0). Do
   0.167.0 stało tu jedenaście — te zaobserwowane przez sondę — a sześć
   pozostałych pokazywało się operatorowi surowym kodem. `reason.type` nie ma
   w specyfikacji enuma, więc lista i tak nie jest zamknięta: nieznany kod
   nadal przechodzi surowy, zamiast zniknąć. */
const POWODY: Record<string, string> = {
  NONE: "bez powodu", MISTAKE: "pomyłka klienta", TRANSPORT: "uszkodzenie w transporcie",
  DAMAGED: "towar uszkodzony", NOT_AS_DESCRIBED: "niezgodny z opisem",
  DONT_LIKE_IT: "nie spodobał się", OVERDUE_DELIVERY: "dostawa po terminie",
  INCOMPLETE: "niekompletny", HIDDEN_FLAW: "wada ukryta", OTHER_FLAW: "inna wada",
  DIFFERENT: "inny towar", COUNTERFEIT: "podróbka", NOT_NEW: "towar nienowy",
  TOO_LARGE: "za duży", TOO_SMALL: "za mały", NOT_AS_EXPECTED: "inny niż oczekiwany",
  ORDERED_FOR_COMPARISON: "zamówiony na przymiarkę",
};

const OCENY: Array<["stan" | "przecena" | "utylizacja", string, string]> = [
  ["stan", "S", "Na stan"],
  ["przecena", "C", "Na przecenę"],
  ["utylizacja", "U", "Utylizacja"],
];

/**
 * Kartoteka pozycji: propozycja automatu, potwierdzenie człowieka.
 *
 * Wskazanie ręczne otwiera się dopiero na żądanie: wyszukiwarka pod każdą
 * pozycją byłaby ścianą pól tam, gdzie w większości przypadków wystarczy
 * potwierdzić to, co automat już policzył.
 */
function Kartoteka({ p }: { p: PozycjaZwrotu }) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = usePotwierdzKartoteke();

  const ustaw = (twId: number | null, zrodlo: "sku" | "reczne") =>
    zapisz.mutate({ pozycjaId: p.id, twId, zrodlo }, { onSuccess: () => setSzukam(false) });

  if (p.twId !== null) {
    return <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
      Kartoteka <b>{p.twSymbol}</b>
      <span className="text-slate-500">
        {/* „zatwierdzona propozycja", a nie „z SKU oferty": od 0.154.0 automat
            proponuje z czterech źródeł (SKU, pamięć wskazań, jedyna pozycja
            zamówienia, nazwa w zamówieniu), a wszystkie zapisują się tym samym
            `sku`. Dawny podpis kłamałby przy trzech z czterech. */}
        {p.twZrodlo === "sku" ? "· zatwierdzona propozycja" : "· wskazana ręcznie"}
      </span>
      <button type="button" title="Zdejmij powiązanie" disabled={zapisz.isPending}
        onClick={() => ustaw(null, "reczne")}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
        <Krzyzyk size={12} />
      </button>
    </p>;
  }

  const prop = p.propozycja;
  return <div className="mt-1 text-xs">
    {prop?.twId != null
      /* Propozycja nie udaje faktu: mówi, skąd się wzięła, i czeka na
         zatwierdzenie. Projekt panelu §4.3 i §11.3. Warunek stoi na `twId`,
         a nie na jednej wartości pewności — inaczej propozycja z pamięci
         wskazań (ta najpewniejsza, bo za nią stoi człowiek) nie dostałaby
         przycisku i wymagałaby ręcznego wskazania po raz drugi. */
      ? <div className="flex flex-wrap items-center gap-2 text-amber-800">
          <span>Propozycja: <b>{prop.symbol}</b>
            <span className="text-slate-500"> · {prop.zrodlo}</span></span>
          <button type="button" disabled={zapisz.isPending}
            onClick={() => ustaw(prop.twId, "sku")}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check size={12} />Zatwierdź</button>
        </div>
      /* POWÓD, nie samo „Bez kartoteki". Do 0.153.1 sześć różnych zerwań
         łańcucha wyglądało tu identycznie i operator nie miał jak odróżnić
         „sprzedawca nie wypełnił SKU" od „kod ma błąd". Zdanie pisze SERWER
         (`dopasowanie-sku.ts`) — druga kopia tej reguły w panelu rozjechałaby
         się przy pierwszej poprawce jednej z nich. */
      : <p className="text-slate-500">
          Bez kartoteki{prop?.zrodlo ? <> · <span className="text-slate-600">{prop.zrodlo}</span></> : null}</p>}

    {szukam
      ? <div className="mt-1">
          <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t: Towar | null) => t && ustaw(t.id, "reczne")} />
        </div>
      /* Własny wiersz, nie doklejka do zdania o powodzie: „…jeszcze nie
         pobranowskaż kartotekę" czytało się jak jedno słowo. */
      : <button type="button" onClick={() => setSzukam(true)}
          className="mt-1 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
          wskaż kartotekę</button>}
    {zapisz.error && <p className="mt-1 text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

export function Pozycje({ zwrot, trwa, blad, trwaRabat = false, bladRabatu = "",
  onOcena, onKwota, onZglosRabat }: {
  zwrot: Zwrot;
  trwa: boolean;
  blad: string;
  trwaRabat?: boolean;
  bladRabatu?: string;
  onOcena: (pozycjaId: number, ocena: "stan" | "przecena" | "utylizacja") => void;
  onKwota: (pozycjeIds: number[], dostawa: boolean) => void;
  onZglosRabat?: (pozycjaId: number) => void;
}) {
  const [powiekszony, setPowiekszony] = useState<PozycjaZwrotu | null>(null);
  /* Pozycje startują ZAZNACZONE — to one wracają do nas. Dostawa nie:
     o niej decyduje człowiek, bo zależy od tego, czy klient odstępuje od
     całego zamówienia, czy oddaje jedną rzecz z pięciu. */
  const [wybrane, setWybrane] = useState<number[]>(() => zwrot.pozycje.map((p) => p.id));
  const [dostawa, setDostawa] = useState(false);

  const wycena = zwrot.kubelek === "zwrot";
  const ocenianie = zwrot.kubelek === "ocena";
  const dostawaGrosze = zwrot.zamowienie?.dostawaGrosze ?? null;

  const suma = useMemo(() => {
    const pozycje = zwrot.pozycje
      .filter((p) => wybrane.includes(p.id))
      .reduce((s, p) => s + Math.round(p.cenaGrosze * p.ilosc), 0);
    return pozycje + (dostawa ? dostawaGrosze ?? 0 : 0);
  }, [zwrot.pozycje, wybrane, dostawa, dostawaGrosze]);

  const przelacz = (id: number) => setWybrane((w) =>
    w.includes(id) ? w.filter((x) => x !== id) : [...w, id].sort((a, b) => a - b));

  if (!zwrot.pozycje.length) {
    return <p className="p-4 text-sm text-slate-500">Zwrot bez pozycji — nie ma czego wycenić.</p>;
  }

  return <div className="p-4">
    <ul className="space-y-2">
      {zwrot.pozycje.map((p) => <li key={p.id} className="flex gap-3 rounded-lg bg-slate-50 p-3">
        {/* Pole zaznaczenia stoi PRZED zdjęciem, w jednej kolumnie dla całej
            listy: odhaczanie idzie wtedy w dół jednym ruchem oka. */}
        {wycena && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0"
          aria-label={`Oddaj: ${p.nazwa}`}
          checked={wybrane.includes(p.id)} onChange={() => przelacz(p.id)} />}
        <Zdjecie twId={p.twId} rozmiar={72} nazwa={p.nazwa}
          onKlik={p.twId !== null ? () => setPowiekszony(p) : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {/* Bez `truncate`: w środkowej kolumnie nazwa się MIEŚCI, a gdy
                nie mieści — łamie się, zamiast gubić końcówkę. Ucinanie było
                ceną za 340 px po prawej i tej ceny już nie płacimy. */}
            <span className="font-semibold">{p.nazwa}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {zlote(Math.round(p.cenaGrosze * p.ilosc), p.waluta)}</span>
          </div>
          <div className="text-xs text-slate-600">
            {p.ilosc} szt.{p.powod ? ` · ${POWODY[p.powod] ?? p.powod}` : ""}
          </div>
          {/* Kody, po których pracownik szuka towaru na półce i w Subiekcie.
              EAN wisi przy KARTOTECE, więc pojawia się dopiero po jej
              potwierdzeniu; SKU jest sprzedawcy i idzie z pozycji ZAMÓWIENIA,
              bo pozycja zwrotu własnego SKU w specyfikacji nie ma. */}
          {(p.ean || p.sku) && <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
            {p.ean && <span>EAN <b className="font-mono text-slate-700">{p.ean}</b></span>}
            {p.sku && <span>SKU <b className="font-mono text-slate-700">{p.sku}</b></span>}
          </div>}
          {/* Odnośnik JAWNY i podpisany. Od 0.153.0 był nim sama nazwa towaru —
              istniał, ale nikt go nie widział: podkreślenie nie mówi, dokąd
              prowadzi. Gdy adresu nie ma, ekran mówi to wprost — milczenie
              wygląda jak usterka panelu, a jest brakiem danych po stronie
              Allegro. */}
          <p className="mt-0.5 text-xs">
            {p.url
              ? <Link href={p.url}>Zobacz ofertę</Link>
              : <span className="text-slate-400">Allegro nie podało adresu oferty</span>}
          </p>
          {p.powodKomentarz && <p className="mt-1 text-xs italic text-slate-600">
            „{p.powodKomentarz}"</p>}
          <Kartoteka p={p} />
          {/* Rabat stoi przy POZYCJI, nie przy zwrocie: wniosek składa się
              na pozycję zamówienia, więc zwrot z dwiema pozycjami ma dwa
              osobne rabaty i dwa osobne przyciski. */}
          <Rabat rabat={p.rabat} trwa={trwaRabat} blad={bladRabatu}
            onZglos={() => onZglosRabat?.(p.id)} />

          {/* Ocena towaru: pytanie kubełka DO OCENY, zadane przy towarze,
              którego dotyczy. Zapisana ocena zostaje widoczna w każdym
              kubełku — to fakt o tej pozycji, nie stan ekranu. */}
          {ocenianie && !p.ocena && <div className="mt-2 flex flex-wrap gap-2">
            {OCENY.map(([klucz, klawisz, etykieta]) => (
              <Przycisk key={klucz} className="text-xs" disabled={trwa}
                onClick={() => onOcena(p.id, klucz)}>
                <kbd className="rounded border border-slate-300 px-1">{klawisz}</kbd> {etykieta}
              </Przycisk>))}
          </div>}
          {p.ocena && <p className="mt-2 text-xs font-bold text-ranga-ok">
            Ocena: {OCENY.find(([k]) => k === p.ocena)?.[2] ?? p.ocena}</p>}
        </div>
      </li>)}
    </ul>

    {wycena
      /* ZAZNACZENIE, nie wybór wariantu. Operator odhacza to, co oddaje,
         a suma rośnie na oczach. Wariant („pełna", „bez wysyłki") wylicza
         sobie z tego serwer — jest etykietą, a nie pozycją w menu.

         W tym kubełku podsumowanie NIE pokazuje sumy pozycji obok kwoty do
         oddania: dwie liczby o pieniądzach jedna nad drugą czytałoby się
         jako jedna, a myli się tę, która idzie do klienta. */
      ? <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3">
          {dostawaGrosze != null && <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={dostawa}
              onChange={() => setDostawa((d) => !d)} />
            <span className="mr-auto">Koszt dostawy</span>
            <span className="tabular-nums text-slate-600">
              {zlote(dostawaGrosze, zwrot.waluta)}</span>
          </label>}
          <div className="flex items-center gap-3 border-t border-slate-200 pt-2">
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
        </div>
      : <div className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-500">Suma pozycji</span>
            <span className="tabular-nums">{zlote(zwrot.sumaPozycjiGrosze, zwrot.waluta)}</span>
          </div>
          {zwrot.kwotaPelnaGrosze === null
            /* Ekran mówi, czego NIE wie: koszt dostawy stoi przy zamówieniu,
               a tego jeszcze nie pobrano. */
            ? <p className="text-xs text-slate-500">
                Kwoty pełnej nie znamy bez zamówienia — koszt dostawy stoi przy nim.</p>
            : <div className="flex items-baseline justify-between">
                <span className="font-bold">Z dostawą</span>
                <span className="text-lg font-bold tabular-nums">
                  {zlote(zwrot.kwotaPelnaGrosze, zwrot.waluta)}</span>
              </div>}
        </div>}

    {/* Błąd oceny i kwoty ląduje TU, bo tu stoją ich przyciski. */}
    {(wycena || ocenianie) && blad && <div className="mt-3"><Blad>{blad}</Blad></div>}

    {powiekszony?.twId != null && <Powiekszenie
      twId={powiekszony.twId} nazwa={powiekszony.nazwa} symbol={powiekszony.twSymbol}
      zamknij={() => setPowiekszony(null)} />}
  </div>;
}
