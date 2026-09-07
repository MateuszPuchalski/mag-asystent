import React, { useState } from "react";
import { Cog } from "lucide-react";
import type { LukaSilnika, RodzajDowodu, Zabudowa } from "../api/typy";
import {
  useRozstrzygnijZabudowe, useSilniki, useWycofajZabudowe, useZaproponujZabudowe,
} from "../api/wiedza";
import { Blad, Pole, Przycisk, Pusto } from "../ui";
import { PolaModelu, type DaneModelu } from "./PolaModelu";
import { DOWODY_DO_WYBORU, NAZWA_DOWODU } from "../skrzynka/statusy";

/**
 * Silniki: który silnik stoi w której maszynie (§11.2).
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Filtr, gaźnik, świeca i linka pasują do SILNIKA, a kupujący zna wyłącznie
 * model kosiarki. Bez tej pary pytanie „filtr do NAC LS 46-450" nie ma jak
 * trafić na filtr Loncina.
 *
 * ── CO ROBI AUTOMAT, A CZEGO NIE ──────────────────────────────────────────
 * Automat układa KOLEJKĘ: liczy, o które maszyny agenci pytają najczęściej,
 * i pokazuje SUROWE łańcuchy wpisane w pole „Silnik" z licznikiem. Nie rozbija
 * ich na markę i nazwę — „B&S 450E" nie mówi automatowi, czyj to silnik, tak
 * samo jak `FS350 FS400` nie mówiło, czyja to maszyna (§12). Klik na czipie
 * wstawia tekst DO POPRAWKI, nie wysyła go.
 */
export function Silniki() {
  const dane = useSilniki();
  const zaproponuj = useZaproponujZabudowe();
  const rozstrzygnij = useRozstrzygnijZabudowe();
  const wycofaj = useWycofajZabudowe();
  const [blad, setBlad] = useState("");

  const propozycje = dane.data?.propozycje ?? [];
  const luki = dane.data?.luki ?? [];
  const zatwierdzone = dane.data?.zatwierdzone ?? [];

  return <div className="space-y-5">
    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>

    <section aria-label="Czeka na rozstrzygnięcie">
      <h3 className="mb-2 text-sm font-bold">Czeka na rozstrzygnięcie ({propozycje.length})</h3>
      {!dane.isLoading && propozycje.length === 0 &&
        <Pusto ikona={<Cog size={32} />}>Nic nie czeka. Pary biorą się stąd i z zatwierdzonych doborów.</Pusto>}
      <div className="space-y-2">
        {propozycje.map((z) => <PropozycjaPary key={z.id} z={z} trwa={rozstrzygnij.isPending}
          onDecyzja={(decyzja, powod) => { setBlad("");
            rozstrzygnij.mutate({ id: z.id, decyzja, powod },
              { onError: (e) => setBlad((e as Error).message) }); }} />)}
      </div>
    </section>

    <section aria-label="Luki">
      <h3 className="mb-1 text-sm font-bold">Maszyny z doborów, od najczęstszych ({luki.length})</h3>
      <p className="mb-2 text-[11px] text-slate-500">
        Kolejność liczy się z pól wpisanych przez agentów w zakładce Dobór — nie z treści wiadomości klientów.
      </p>
      {!dane.isLoading && luki.length === 0 &&
        <Pusto ikona={<Cog size={32} />}>Żaden dobór nie wskazał jeszcze maszyny.</Pusto>}
      <div className="space-y-3">
        {luki.map((l) => <Luka key={l.klucz} l={l} trwa={zaproponuj.isPending}
          onWyslij={(v) => { setBlad("");
            zaproponuj.mutate(v, { onError: (e) => setBlad((e as Error).message) }); }} />)}
      </div>
    </section>

    {zatwierdzone.length > 0 && <section aria-label="Zatwierdzone">
      <h3 className="mb-2 text-sm font-bold">Zatwierdzone ({zatwierdzone.length})</h3>
      <div className="space-y-1">
        {zatwierdzone.map((z) => <Zatwierdzona key={z.id} z={z} trwa={wycofaj.isPending}
          onWycofaj={(powod) => { setBlad("");
            wycofaj.mutate({ id: z.id, powod }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
      </div>
    </section>}
  </div>;
}

function PropozycjaPary({ z, trwa, onDecyzja }: {
  z: Zabudowa; trwa: boolean; onDecyzja: (d: "zatwierdz" | "odrzuc", powod: string | null) => void;
}) {
  const [powod, setPowod] = useState("");
  const [odrzuca, setOdrzuca] = useState(false);
  return <div className="rounded-lg border p-3">
    <div className="flex flex-wrap items-center gap-2">
      <b>{z.maszyna.etykieta}</b>
      <span className="text-slate-400">→</span>
      <b>{z.silnik.etykieta}</b>
      <span className="ml-auto text-xs text-slate-500">{z.zaproponowal}</span>
    </div>
    <p className="mt-1 text-xs text-slate-600">{NAZWA_DOWODU[z.rodzajDowodu]}: {z.dowodTresc}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk disabled={trwa} onClick={() => onDecyzja("zatwierdz", null)}>Zatwierdź</Przycisk>
      {!odrzuca && <Przycisk wariant="drugi" disabled={trwa} onClick={() => setOdrzuca(true)}>Odrzuć</Przycisk>}
      {odrzuca && <>
        {/* Odrzucenie bez powodu nie mówi autorowi, co poprawić — serwer je odbija. */}
        <Pole className="w-64" aria-label="Powód odrzucenia" value={powod} placeholder="Dlaczego?"
          onChange={(e) => setPowod(e.target.value)} />
        <Przycisk disabled={trwa || !powod.trim()} onClick={() => onDecyzja("odrzuc", powod.trim())}>Odrzuć</Przycisk>
      </>}
    </div>
  </div>;
}

function Zatwierdzona({ z, trwa, onWycofaj }: {
  z: Zabudowa; trwa: boolean; onWycofaj: (powod: string) => void;
}) {
  const [powod, setPowod] = useState("");
  const [wycofuje, setWycofuje] = useState(false);
  return <div className="flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm">
    <span>{z.maszyna.etykieta} <span className="text-slate-400">→</span> <b>{z.silnik.etykieta}</b></span>
    <span className="text-xs text-slate-500">{z.zdanieZrodla}</span>
    {!wycofuje && <Przycisk className="ml-auto" wariant="drugi" disabled={trwa}
      onClick={() => setWycofuje(true)}>Wycofaj</Przycisk>}
    {wycofuje && <>
      {/* Wycofanie gasi CAŁĄ gałąź kandydatów naraz, więc powód jest obowiązkowy. */}
      <Pole className="ml-auto w-64" aria-label="Powód wycofania" value={powod} placeholder="Dlaczego?"
        onChange={(e) => setPowod(e.target.value)} />
      <Przycisk disabled={trwa || !powod.trim()} onClick={() => onWycofaj(powod.trim())}>Wycofaj</Przycisk>
    </>}
  </div>;
}

function Luka({ l, trwa, onWyslij }: {
  l: LukaSilnika; trwa: boolean;
  onWyslij: (v: Parameters<ReturnType<typeof useZaproponujZabudowe>["mutate"]>[0]) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [silnik, setSilnik] = useState<DaneModelu>({ rodzaj: "silnik", marka: "", nazwa: "", wariant: "" });
  const [rodzajDowodu, setRodzajDowodu] = useState<RodzajDowodu>("producent");
  const [tresc, setTresc] = useState("");
  const gotowe = Boolean(silnik.marka.trim() && silnik.nazwa.trim() && tresc.trim());
  const maszyna = [l.marka, l.model, l.wariant].filter(Boolean).join(" ");

  return <div className="rounded-lg border p-3">
    <div className="flex flex-wrap items-center gap-2">
      <b>{maszyna}</b>
      <span className="text-xs text-slate-500">{l.pytan} {l.pytan === 1 ? "dobór" : "doborów"}</span>
      {l.zabudowy.length === 0
        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">brak silnika</span>
        : <span className="text-xs text-slate-600">
            silniki: {l.zabudowy.map((z) => z.silnik.etykieta).join(" · ")}</span>}
      <Przycisk className="ml-auto" wariant="drugi" onClick={() => setOtwarte(!otwarte)}>
        {otwarte ? "Zwiń" : "Dopisz silnik"}</Przycisk>
    </div>

    {l.wpisaneSilniki.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-slate-500">agenci wpisywali:</span>
      {l.wpisaneSilniki.map((s) => <button key={s.tekst} type="button"
        className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] hover:bg-slate-200"
        title="Wstaw do pola Model — do poprawki"
        onClick={() => { setOtwarte(true); setSilnik((p) => ({ ...p, nazwa: s.tekst })); }}>
        {s.tekst} ×{s.ile}</button>)}
    </div>}

    {otwarte && <form className="mt-3 space-y-2" aria-label={`Dopisz silnik do ${maszyna}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!gotowe) return;
        onWyslij({
          maszyna: { rodzaj: "maszyna", marka: l.marka, nazwa: l.model, wariant: l.wariant },
          silnik: { rodzaj: "silnik", marka: silnik.marka.trim(), nazwa: silnik.nazwa.trim(),
            wariant: silnik.wariant.trim() || null },
          rodzajDowodu, dowodTresc: tresc.trim(),
        });
      }}>
      {/* Rodzaj zablokowany na „silnik": na tej liście dopisuje się wyłącznie silniki. */}
      <PolaModelu dane={silnik} onZmiana={setSilnik} zwarte rodzajStaly />
      <div className="flex flex-wrap gap-2">
        <select className="field w-auto" aria-label="Rodzaj dowodu" value={rodzajDowodu}
          onChange={(e) => setRodzajDowodu(e.target.value as RodzajDowodu)}>
          {DOWODY_DO_WYBORU.map((k) => <option key={k} value={k}>{NAZWA_DOWODU[k]}</option>)}
        </select>
        <Pole className="flex-1" aria-label="Dowód" value={tresc} placeholder="Skąd wiadomo? np. tabliczka znamionowa"
          onChange={(e) => setTresc(e.target.value)} />
        <Przycisk type="submit" disabled={trwa || !gotowe}>Zaproponuj</Przycisk>
      </div>
    </form>}
  </div>;
}
