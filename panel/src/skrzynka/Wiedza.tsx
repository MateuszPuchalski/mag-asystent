import React, { useState } from "react";
import { BookMarked, Sparkles } from "lucide-react";
import type { PomiarRozmowy, PowodNegatywny, SzkicCopilota, Zastosowanie } from "../api/typy";
import { usePomiarDoWiedzy, useWiedzaDoboru } from "../api/rozmowy";
import { useOcenPasowanie } from "../api/copilot";
import { NaglowekSekcji, Przycisk, czas } from "../ui";
import { Kafel } from "../towar/Kafel";
import { NAZWA_POWODU, NAZWA_ROLI } from "./statusy";

/**
 * Zakładka WIEDZA — dowody pod odpowiedź (makieta „Wiedza", §14.3).
 *
 * ZAKŁADKA WRÓCIŁA Z MAKIETY decyzją właściciela. §10.1 skreślił ją w 0.198.0
 * zdaniem „dowody kartoteki stoją już w Doborze" — i to była prawda, dopóki
 * dowody tam stały. Teraz stoją TUTAJ i tylko tutaj: powód skreślenia był
 * słuszny, więc rozwiązaniem jest jedno miejsce, a nie dwa.
 *
 * DLACZEGO OSOBNO OD DOBORU. Dobór jest ROBOTĄ: kroki, kandydaci, przyciski
 * zmieniające stan rozmowy. Wiedza jest KARTĄ FAKTÓW, po którą sięga się przy
 * pisaniu odpowiedzi — także wtedy, gdy dobór dawno domknięto i nikt już nie
 * przewija jego kroków. Dwa różne momenty pracy, więc dwie zakładki.
 *
 * KLAUZULA U GÓRY NIE JEST OZDOBĄ. §14.3 mówi: twierdzenie techniczne bez
 * źródła jest przypuszczeniem. Agent pisze szkic obok, w środkowej kolumnie —
 * zdanie ma stać tam, gdzie patrzy, zanim napisze „pasuje".
 *
 * Makieta cytuje §4.3 („każdy fakt niesie swoje źródło"). Zdanie o szkicu jest
 * jednak z §14.3 i to jego numer stoi na ekranie: odsyłacz ma prowadzić tam,
 * gdzie naprawdę leży reguła.
 */
export function Wiedza({ rozmowaId, twId, maMaszyne, propozycja = null }: {
  rozmowaId: number;
  /** Wybrana kartoteka — dowód z pomiaru wiesza się na niej, gdy pomiar swojej nie ma. */
  twId: number | null;
  maMaszyne: boolean;
  /** Szkic Copilota; niesie pasowanie rozpoznane w rozmowie. */
  propozycja?: SzkicCopilota | null;
}) {
  const wiedza = useWiedzaDoboru(rozmowaId);
  const pomiarDoWiedzy = usePomiarDoWiedzy();
  const pomiary = wiedza.data?.pomiary ?? [];

  /* Bez własnego wcięcia: oddech daje treść wiersza „Wiedza", więc tekst
     stoi na tej samej osi co reszta kolumny. */
  return <div aria-label="Wiedza">
    {/* Zdanie, nie ramka (23 września 2026): obramowana klauzula była
        najcięższym elementem zakładki, która poza nią zwykle nie ma nic.
        Jedno zdanie, nie dwa (0.513.0): na ekranie zostaje sama reguła,
        bo dokument każe jej stać tam, gdzie agent pisze. Pierwsze zdanie
        opisywało tylko, do czego służy lista niżej — zeszło do dymka. */}
    <p className="text-podpis text-slate-600"
      title="Każde twierdzenie techniczne w szkicu wskazuje jeden z tych dowodów.">
      Bez źródła treść jest przypuszczeniem (§14.3).
    </p>

    {/* Para NAD dowodami: to jedyna rzecz w wierszu, która czeka na ruch
        agenta, a dowody są do czytania (praca na górze, wgląd niżej). */}
    <PasowanieZRozmowy rozmowaId={rozmowaId} propozycja={propozycja} />

    <Dowody zastosowanie={wiedza.data?.zastosowanie ?? null} wczytuje={wiedza.isLoading} />

    {/* ── Pomiary z tej rozmowy (§13.4) ───────────────────────────────────
        Wynik z hali NIE jest jeszcze wiedzą i ekran mówi to wprost. Makieta
        nazywa ten stan „niezatwierdzone jako wiedza" i rysuje go bursztynem
        obok zielonych dowodów — bo różnica między pomiarem a katalogiem
        producenta jest dokładnie tym, co ta zakładka ma pokazywać. */}
    {pomiary.length > 0 &&
      <section className="mt-3" aria-label="Pomiary z tej rozmowy">
        <NaglowekSekcji>Pomiary z tej rozmowy</NaglowekSekcji>
        <ul className="mt-2 space-y-2">
          {pomiary.map((p) => <Pomiar key={p.zadanieId} pomiar={p} maMaszyne={maMaszyne}
            trwa={pomiarDoWiedzy.isPending}
            onZaproponuj={(polaryzacja, powodNegatywny) => pomiarDoWiedzy.mutate({
              id: rozmowaId, zadanieId: p.zadanieId, twId: p.twId ?? twId,
              polaryzacja, powodNegatywny })} />)}
        </ul>
      </section>}
  </div>;
}

/**
 * PASOWANIE Z ROZMOWY. Model nazwał parę SYMBOLAMI z faktów, serwer sprawdził
 * oba końce po kartotekach tej rozmowy, a agent tylko klika. „Zaproponuj"
 * kładzie parę w kolejce wiedzy ze źródłem copilot; rozstrzyga biuro.
 *
 * Karta stoi w Wiedzy, nie w Doborze: para to utrzymanie bazy wiedzy, a nie
 * odpowiedź klientowi (`docs/dobor-od-zera.md` §2). Po „Zaproponuj" zdanie
 * bierze się Z DANYCH (`pasowanieOcena`), więc przeżywa odświeżenie.
 */
function PasowanieZRozmowy({ rozmowaId, propozycja }: { rozmowaId: number; propozycja: SzkicCopilota | null }) {
  const ocen = useOcenPasowanie();
  const para = propozycja?.pasowanie ?? null;
  const ocena = propozycja?.pasowanieOcena ?? null;
  if (!para || ocena === "odrzucone") return null;
  return <section aria-label="Pasowanie z rozmowy" className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-2">
    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
      <b className="text-violet-900"><Sparkles size={12} className="inline" aria-hidden /> Copilot rozpoznał pasowanie</b>
      {ocena === null && <span className="ml-auto flex flex-wrap items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={ocen.isPending}
          onClick={() => ocen.mutate({ rozmowaId, ocena: "zaproponowane" })}>Zaproponuj pasowanie</Przycisk>
        <Przycisk className="text-xs" disabled={ocen.isPending}
          onClick={() => ocen.mutate({ rozmowaId, ocena: "odrzucone" })}>Odrzuć</Przycisk>
      </span>}
    </div>
    <div className="flex items-center gap-2">
      <Kafel twId={para.czesc.twId} rozmiar={40} nazwa={para.czesc.nazwa} symbol={para.czesc.symbol} />
      <div className="min-w-0 flex-1 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <b className="font-mono">{para.czesc.symbol}</b>
          <span className="text-slate-500">→</span>
          <b className="font-mono">{para.doCzego.symbol}</b>
          <span className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-podpis">
            {NAZWA_ROLI[para.rola]}{para.pozycja ? ` · ${para.pozycja}` : ""}</span>
        </div>
        <p className="truncate text-slate-600">{para.czesc.nazwa} → {para.doCzego.nazwa}</p>
      </div>
      <Kafel twId={para.doCzego.twId} rozmiar={40} nazwa={para.doCzego.nazwa} symbol={para.doCzego.symbol} />
    </div>
    {ocena === "zaproponowane"
      ? <p className="mt-1 text-podpis text-emerald-800">
          Propozycja „{para.czesc.symbol} pasuje do {para.doCzego.symbol}” czeka w kolejce wiedzy — rozstrzyga biuro.</p>
      : <p className="mt-1 text-podpis text-slate-600">
          Oba końce to kartoteki z tej rozmowy, sprawdzone przez serwer. Do kolejki trafia po kliknięciu,
          rozstrzyga biuro. Zła rola albo pozycja: odrzuć i złóż parę na ekranie Wiedza.</p>}
    {ocen.error && <p className="mt-1 text-podpis font-semibold text-ranga-zle">{(ocen.error as Error).message}</p>}
  </section>;
}

/**
 * Dowody wybranej kartoteki (makieta: ranga, data, treść, źródło). Bez wpisu
 * w bazie wiedzy dobór jest przypuszczeniem — i ekran ma to powiedzieć,
 * zamiast pokazywać pustą sekcję.
 */
function Dowody({ zastosowanie, wczytuje }: { zastosowanie: Zastosowanie | null; wczytuje: boolean }) {
  if (wczytuje) return <p className="mt-2 text-podpis text-slate-500">Sprawdzam bazę wiedzy…</p>;
  if (!zastosowanie) {
    return <p className="mt-2 flex items-center gap-1 text-podpis text-slate-500">
      <BookMarked size={12} />Brak wpisu w bazie wiedzy dla tej pary — dobór to przypuszczenie,
      dopóki nikt nie zatwierdzi zastosowania.</p>;
  }
  return <div className="mt-3" aria-label="Dowody zastosowania">
    <p className="flex items-center gap-1 text-podpis font-bold text-slate-600">
      <BookMarked size={12} />Dowody: {zastosowanie.model.etykieta}
      <span className={`ml-1 rounded px-1 py-0.5 font-bold ${zastosowanie.pewnosc === "potwierdzone"
        ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{zastosowanie.pewnosc}</span>
      <span className="font-normal text-slate-500">· zatwierdził {zastosowanie.rozstrzygnal}</span></p>
    <ul className="mt-1 space-y-1">
      {zastosowanie.dowody.map((d) => <li key={d.id} className="rounded border border-slate-200 p-1.5 text-podpis">
        <span className="rounded bg-slate-100 px-1 font-semibold text-slate-700">{d.nazwaRodzaju}</span>
        <span className="ml-1 text-slate-500">{czas(d.at)}</span>
        <p className="mt-0.5 text-slate-800">{d.tresc}</p>
        <p className="text-slate-500">{d.autor}{d.link && <> · <a className="underline" href={d.link} target="_blank" rel="noreferrer">źródło</a></>}</p>
      </li>)}
    </ul>
  </div>;
}

const DROGA_POMIARU = "Wynik z hali nie staje się wiedzą sam. Zaproponowany trafia do kolejki "
  + "jako dowód „pomiar własny” i czeka na zatwierdzenie.";

function Pomiar({ pomiar, maMaszyne, trwa, onZaproponuj }: {
  pomiar: PomiarRozmowy; maMaszyne: boolean; trwa: boolean;
  onZaproponuj: (polaryzacja: "pasuje" | "nie_pasuje", powodNegatywny: PowodNegatywny | null) => void;
}) {
  const [polaryzacja, setPolaryzacja] = useState<"pasuje" | "nie_pasuje">("pasuje");
  const [powod, setPowod] = useState<PowodNegatywny>("niewlasciwy_rozstaw");
  return <li className="rounded border border-amber-200 bg-amber-50/40 p-2 text-xs">
    <p><b>{pomiar.tytul}</b> <span className="text-slate-500">· {pomiar.wykonanoPrzez}, {czas(pomiar.wykonanoAt)}
      {pomiar.symbol && <> · <span className="font-mono">{pomiar.symbol}</span></>}</span></p>
    {/* Wynik w piśmie treści, nie większym od tytułu wiersza kolumny. */}
    <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{pomiar.wynik}</p>
    {pomiar.zaproponowano
      ? <p className="mt-1 text-podpis font-semibold text-emerald-700">w kolejce wiedzy jako dowód</p>
      : <>
          {/* Opis drogi pomiaru zszedł spod nagłówka do dymka (0.513.0):
              etykieta mówi stan słowem, a „jak to działa” czyta się raz. */}
          <p className="mt-1 text-podpis font-semibold text-amber-800" title={DROGA_POMIARU}>
            niezatwierdzone jako wiedza</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select className="field w-auto py-0.5 text-podpis" aria-label={`Wynik pomiaru: ${pomiar.tytul}`}
              value={polaryzacja} onChange={(e) => setPolaryzacja(e.target.value as "pasuje" | "nie_pasuje")}>
              <option value="pasuje">pasuje</option><option value="nie_pasuje">nie pasuje</option>
            </select>
            {polaryzacja === "nie_pasuje" && <select className="field w-auto py-0.5 text-podpis" aria-label="Powód"
              value={powod} onChange={(e) => setPowod(e.target.value as PowodNegatywny)}>
              {(Object.keys(NAZWA_POWODU) as PowodNegatywny[]).map((k) => <option key={k} value={k}>{NAZWA_POWODU[k]}</option>)}
            </select>}
            <Przycisk className="text-podpis" disabled={!maMaszyne || trwa}
              title={maMaszyne ? undefined : "Wpisz markę i model w danych wejściowych"}
              onClick={() => onZaproponuj(polaryzacja, polaryzacja === "nie_pasuje" ? powod : null)}>
              <BookMarked size={12} />Zaproponuj jako dowód</Przycisk>
            {/* Bez maszyny pomiar nie ma do czego pasować — przycisk mówi dlaczego. */}
            {!maMaszyne && <span className="text-podpis text-slate-500">najpierw marka i model maszyny</span>}
          </div>
        </>}
  </li>;
}
