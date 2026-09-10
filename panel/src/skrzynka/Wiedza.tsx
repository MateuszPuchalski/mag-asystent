import React, { useState } from "react";
import { BookMarked } from "lucide-react";
import type { PomiarRozmowy, PowodNegatywny, Zastosowanie } from "../api/typy";
import { usePomiarDoWiedzy, useWiedzaDoboru } from "../api/rozmowy";
import { Przycisk, czas } from "../ui";
import { NAZWA_POWODU } from "./statusy";

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
export function Wiedza({ rozmowaId, twId, maMaszyne }: {
  rozmowaId: number;
  /** Wybrana kartoteka — dowód z pomiaru wiesza się na niej, gdy pomiar swojej nie ma. */
  twId: number | null;
  maMaszyne: boolean;
}) {
  const wiedza = useWiedzaDoboru(rozmowaId);
  const pomiarDoWiedzy = usePomiarDoWiedzy();
  const pomiary = wiedza.data?.pomiary ?? [];

  return <div className="p-3" aria-label="Wiedza">
    <p className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
      Każde twierdzenie techniczne w szkicu wskazuje jeden z tych dowodów (§14.3).
      Bez źródła treść jest przypuszczeniem.
    </p>

    <Dowody zastosowanie={wiedza.data?.zastosowanie ?? null} wczytuje={wiedza.isLoading} />

    {/* ── Pomiary z tej rozmowy (§13.4) ───────────────────────────────────
        Wynik z hali NIE jest jeszcze wiedzą i ekran mówi to wprost. Makieta
        nazywa ten stan „niezatwierdzone jako wiedza" i rysuje go bursztynem
        obok zielonych dowodów — bo różnica między pomiarem a katalogiem
        producenta jest dokładnie tym, co ta zakładka ma pokazywać. */}
    {pomiary.length > 0 &&
      <section className="mt-3" aria-label="Pomiary z tej rozmowy">
        <b className="text-xs uppercase tracking-wide text-slate-500">Pomiary z tej rozmowy</b>
        <p className="mt-1 text-[11px] text-slate-500">Wynik z hali nie staje się wiedzą sam. Zaproponowany
          trafia do kolejki jako dowód „pomiar własny” i czeka na zatwierdzenie.</p>
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
 * Dowody wybranej kartoteki (makieta: ranga, data, treść, źródło). Bez wpisu
 * w bazie wiedzy dobór jest przypuszczeniem — i ekran ma to powiedzieć,
 * zamiast pokazywać pustą sekcję.
 */
function Dowody({ zastosowanie, wczytuje }: { zastosowanie: Zastosowanie | null; wczytuje: boolean }) {
  if (wczytuje) return <p className="mt-2 text-[11px] text-slate-500">Sprawdzam bazę wiedzy…</p>;
  if (!zastosowanie) {
    return <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
      <BookMarked size={12} />Brak wpisu w bazie wiedzy dla tej pary — dobór to przypuszczenie,
      dopóki nikt nie zatwierdzi zastosowania.</p>;
  }
  return <div className="mt-3" aria-label="Dowody zastosowania">
    <p className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
      <BookMarked size={12} />Dowody: {zastosowanie.model.etykieta}
      <span className={`ml-1 rounded px-1 py-0.5 font-bold ${zastosowanie.pewnosc === "potwierdzone"
        ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{zastosowanie.pewnosc}</span>
      <span className="font-normal text-slate-500">· zatwierdził {zastosowanie.rozstrzygnal}</span></p>
    <ul className="mt-1 space-y-1">
      {zastosowanie.dowody.map((d) => <li key={d.id} className="rounded border border-slate-200 p-1.5 text-[11px]">
        <span className="rounded bg-slate-100 px-1 font-semibold text-slate-700">{d.nazwaRodzaju}</span>
        <span className="ml-1 text-slate-500">{czas(d.at)}</span>
        <p className="mt-0.5 text-slate-800">{d.tresc}</p>
        <p className="text-slate-500">{d.autor}{d.link && <> · <a className="underline" href={d.link} target="_blank" rel="noreferrer">źródło</a></>}</p>
      </li>)}
    </ul>
  </div>;
}

function Pomiar({ pomiar, maMaszyne, trwa, onZaproponuj }: {
  pomiar: PomiarRozmowy; maMaszyne: boolean; trwa: boolean;
  onZaproponuj: (polaryzacja: "pasuje" | "nie_pasuje", powodNegatywny: PowodNegatywny | null) => void;
}) {
  const [polaryzacja, setPolaryzacja] = useState<"pasuje" | "nie_pasuje">("pasuje");
  const [powod, setPowod] = useState<PowodNegatywny>("niewlasciwy_rozstaw");
  return <li className="rounded border border-amber-200 bg-amber-50/40 p-2 text-xs">
    <p><b>{pomiar.tytul}</b> <span className="text-slate-500">· {pomiar.wykonanoPrzez}, {czas(pomiar.wykonanoAt)}
      {pomiar.symbol && <> · <span className="font-mono">{pomiar.symbol}</span></>}</span></p>
    <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{pomiar.wynik}</p>
    {pomiar.zaproponowano
      ? <p className="mt-1 text-[11px] font-semibold text-emerald-700">w kolejce wiedzy jako dowód</p>
      : <>
          <p className="mt-1 text-[11px] font-semibold text-amber-800">niezatwierdzone jako wiedza</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select className="field w-auto py-0.5 text-[11px]" aria-label={`Wynik pomiaru: ${pomiar.tytul}`}
              value={polaryzacja} onChange={(e) => setPolaryzacja(e.target.value as "pasuje" | "nie_pasuje")}>
              <option value="pasuje">pasuje</option><option value="nie_pasuje">nie pasuje</option>
            </select>
            {polaryzacja === "nie_pasuje" && <select className="field w-auto py-0.5 text-[11px]" aria-label="Powód"
              value={powod} onChange={(e) => setPowod(e.target.value as PowodNegatywny)}>
              {(Object.keys(NAZWA_POWODU) as PowodNegatywny[]).map((k) => <option key={k} value={k}>{NAZWA_POWODU[k]}</option>)}
            </select>}
            <Przycisk className="text-[11px]" disabled={!maMaszyne || trwa}
              title={maMaszyne ? undefined : "Wpisz markę i model w danych wejściowych"}
              onClick={() => onZaproponuj(polaryzacja, polaryzacja === "nie_pasuje" ? powod : null)}>
              <BookMarked size={12} />Zaproponuj jako dowód</Przycisk>
            {/* Bez maszyny pomiar nie ma do czego pasować — przycisk mówi dlaczego. */}
            {!maMaszyne && <span className="text-[11px] text-slate-500">najpierw marka i model maszyny</span>}
          </div>
        </>}
  </li>;
}
