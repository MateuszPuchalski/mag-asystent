import React, { useState } from "react";
import { Cog } from "lucide-react";
import type { AliasSilnika, LukaSilnika, RodzajDowodu, Zabudowa } from "../api/typy";
import {
  useDodajAliasSilnika, useRozstrzygnijZabudowe, useSilniki, useUsunAliasSilnika, useWycofajZabudowe,
  useZaproponujZabudowe,
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
 *
 * ── SŁOWNIK SILNIKÓW (0.238.0) ────────────────────────────────────────────
 * Most między tekstem a modelem jest LUDZKI: biuro zapisuje, że „B&S 450E"
 * znaczy silnik Briggs & Stratton 450E. Czip z aliasem wypełnia formularz
 * modelem ze słownika (o jedno przepisywanie mniej); czip bez aliasu otwiera
 * formularz z zaznaczonym „zapamiętaj w słowniku", bo człowiek, który właśnie
 * wpisuje markę i nazwę, MÓWI, co ten tekst znaczy. Automat nadal nie zgaduje.
 */
export function Silniki() {
  const dane = useSilniki();
  const zaproponuj = useZaproponujZabudowe();
  const rozstrzygnij = useRozstrzygnijZabudowe();
  const wycofaj = useWycofajZabudowe();
  const dodajAlias = useDodajAliasSilnika();
  const usunAlias = useUsunAliasSilnika();
  const [blad, setBlad] = useState("");

  const propozycje = dane.data?.propozycje ?? [];
  const luki = dane.data?.luki ?? [];
  const zatwierdzone = dane.data?.zatwierdzone ?? [];
  const aliasy = dane.data?.aliasy ?? [];
  const naBlad = { onError: (e: unknown) => setBlad((e as Error).message) };

  return <div className="space-y-5">
    <Blad>{blad || (dane.error as Error | null)?.message}</Blad>

    <section aria-label="Czeka na rozstrzygnięcie">
      <h3 className="mb-2 text-naglowek font-bold">Czeka na rozstrzygnięcie ({propozycje.length})</h3>
      {!dane.isLoading && propozycje.length === 0 &&
        <Pusto ikona={Cog}>Nic nie czeka. Pary biorą się stąd i z zatwierdzonych doborów.</Pusto>}
      <div className="space-y-2">
        {propozycje.map((z) => <PropozycjaPary key={z.id} z={z} trwa={rozstrzygnij.isPending}
          onDecyzja={(decyzja, powod) => { setBlad("");
            rozstrzygnij.mutate({ id: z.id, decyzja, powod },
              { onError: (e) => setBlad((e as Error).message) }); }} />)}
      </div>
    </section>

    <section aria-label="Luki">
      <h3 className="mb-1 text-naglowek font-bold">Maszyny z doborów, od najczęstszych ({luki.length})</h3>
      <p className="mb-2 text-podpis text-slate-500">
        Kolejność liczy się z pól wpisanych przez agentów w zakładce Dobór — nie z treści wiadomości klientów.
      </p>
      {!dane.isLoading && luki.length === 0 &&
        <Pusto ikona={Cog}>Żaden dobór nie wskazał jeszcze maszyny.</Pusto>}
      <div className="space-y-3">
        {luki.map((l) => <Luka key={l.klucz} l={l} trwa={zaproponuj.isPending || dodajAlias.isPending}
          onWyslij={(v, alias) => { setBlad("");
            /* Dwa zapisy, dwie trasy o jednym celu każda: alias mówi, co znaczy
               tekst; zabudowa — co stoi w maszynie. Niezależne od siebie. */
            if (alias) dodajAlias.mutate(alias, naBlad);
            zaproponuj.mutate(v, naBlad); }} />)}
      </div>
    </section>

    <section aria-label="Słownik silników">
      <h3 className="mb-1 text-naglowek font-bold">Słownik silników ({aliasy.length})</h3>
      <p className="mb-2 text-podpis text-slate-500">
        Co znaczy tekst wpisywany w pole „Silnik". Dopasowanie dokładne po zwinięciu pisowni — bez zgadywania literówek.
      </p>
      <div className="space-y-1">
        {aliasy.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-2 rounded border px-3 py-1.5 text-sm">
          <span>„{a.tekst}" <span className="text-slate-500">=</span> <b>{a.silnik.etykieta}</b></span>
          <span className="text-xs text-slate-500">{a.dodal}</span>
          <Przycisk className="ml-auto" wariant="drugi" disabled={usunAlias.isPending}
            onClick={() => { setBlad(""); usunAlias.mutate({ id: a.id }, naBlad); }}>Usuń</Przycisk>
        </div>)}
      </div>
      <NowyAlias trwa={dodajAlias.isPending}
        onDodaj={(v) => { setBlad(""); dodajAlias.mutate(v, naBlad); }} />
    </section>

    {zatwierdzone.length > 0 && <section aria-label="Zatwierdzone">
      <h3 className="mb-2 text-naglowek font-bold">Zatwierdzone ({zatwierdzone.length})</h3>
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
      <span className="text-slate-500">→</span>
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
    <span>{z.maszyna.etykieta} <span className="text-slate-500">→</span> <b>{z.silnik.etykieta}</b></span>
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

type NowyAliasSilnika = Parameters<ReturnType<typeof useDodajAliasSilnika>["mutate"]>[0];

/** Formularz słownika: tekst z pola + model silnika. Rodzaj zablokowany na „silnik". */
function NowyAlias({ trwa, onDodaj }: { trwa: boolean; onDodaj: (v: NowyAliasSilnika) => void }) {
  const [otwarte, setOtwarte] = useState(false);
  const [tekst, setTekst] = useState("");
  const [silnik, setSilnik] = useState<DaneModelu>({ rodzaj: "silnik", marka: "", nazwa: "", wariant: "" });
  const gotowe = Boolean(tekst.trim() && silnik.marka.trim() && silnik.nazwa.trim());
  /* Zwinięty: główna droga do słownika to czip przy luce (tekst już tam jest).
     Ten formularz służy wpisom z wyprzedzeniem i nie ma stać zawsze otwarty
     obok formularza zabudowy — dwa razy „Marka" i „Model" na jednym ekranie. */
  if (!otwarte) return <Przycisk className="mt-2" wariant="drugi" onClick={() => setOtwarte(true)}>Dodaj alias</Przycisk>;
  return <form className="mt-2 space-y-2 rounded-lg border p-3" aria-label="Dodaj alias silnika"
    onSubmit={(e) => {
      e.preventDefault();
      if (!gotowe) return;
      onDodaj({ tekst: tekst.trim(), silnik: { rodzaj: "silnik", marka: silnik.marka.trim(),
        nazwa: silnik.nazwa.trim(), wariant: silnik.wariant.trim() || null } });
      setTekst(""); setSilnik({ rodzaj: "silnik", marka: "", nazwa: "", wariant: "" }); setOtwarte(false);
    }}>
    <Pole aria-label="Tekst z pola Silnik" value={tekst} placeholder="Tekst, jaki wpisują agenci, np. B&S 450E"
      onChange={(e) => setTekst(e.target.value)} />
    <PolaModelu dane={silnik} onZmiana={setSilnik} zwarte rodzajStaly />
    <Przycisk type="submit" disabled={trwa || !gotowe}>Dodaj do słownika</Przycisk>
  </form>;
}

const zModelu = (m: AliasSilnika["silnik"]): DaneModelu =>
  ({ rodzaj: "silnik", marka: m.marka, nazwa: m.nazwa, wariant: m.wariant ?? "" });

function Luka({ l, trwa, onWyslij }: {
  l: LukaSilnika; trwa: boolean;
  onWyslij: (v: Parameters<ReturnType<typeof useZaproponujZabudowe>["mutate"]>[0], alias: NowyAliasSilnika | null) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [silnik, setSilnik] = useState<DaneModelu>({ rodzaj: "silnik", marka: "", nazwa: "", wariant: "" });
  const [rodzajDowodu, setRodzajDowodu] = useState<RodzajDowodu>("producent");
  const [tresc, setTresc] = useState("");
  /* Tekst czipu BEZ aliasu, od którego otwarto formularz: przy „Zaproponuj"
     trafi do słownika, chyba że człowiek odznaczy. `null` = formularz otwarty
     z ręki albo z czipu, który słownik już zna. */
  const [tekstAliasu, setTekstAliasu] = useState<string | null>(null);
  const [zapamietaj, setZapamietaj] = useState(true);
  const gotowe = Boolean(silnik.marka.trim() && silnik.nazwa.trim() && tresc.trim());
  const maszyna = [l.marka, l.model, l.wariant].filter(Boolean).join(" ");

  return <div className="rounded-lg border p-3">
    <div className="flex flex-wrap items-center gap-2">
      <b>{maszyna}</b>
      <span className="text-xs text-slate-500">{l.pytan} {l.pytan === 1 ? "dobór" : "doborów"}</span>
      {l.zabudowy.length === 0
        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-podpis text-amber-800">brak silnika</span>
        : <span className="text-xs text-slate-600">
            silniki: {l.zabudowy.map((z) => z.silnik.etykieta).join(" · ")}</span>}
      <Przycisk className="ml-auto" wariant="drugi" onClick={() => setOtwarte(!otwarte)}>
        {otwarte ? "Zwiń" : "Dopisz silnik"}</Przycisk>
    </div>

    {l.wpisaneSilniki.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1">
      <span className="text-podpis text-slate-500">agenci wpisywali:</span>
      {l.wpisaneSilniki.map((s) => s.silnik
        /* Czip ZE słownika: model wchodzi do formularza gotowy — zostaje dowód. */
        ? <button key={s.tekst} type="button"
            className="rounded bg-emerald-50 px-1.5 py-0.5 text-podpis text-emerald-900 hover:bg-emerald-100"
            title="Ze słownika — wypełnia formularz tym silnikiem"
            onClick={() => { setOtwarte(true); setSilnik(zModelu(s.silnik!)); setTekstAliasu(null); }}>
            {s.tekst} ×{s.ile} = {s.silnik.etykieta}</button>
        : <button key={s.tekst} type="button"
            className="rounded bg-slate-100 px-1.5 py-0.5 text-podpis hover:bg-slate-200"
            title="Wstaw do pola Model — do poprawki"
            onClick={() => { setOtwarte(true); setSilnik((p) => ({ ...p, nazwa: s.tekst })); setTekstAliasu(s.tekst); }}>
            {s.tekst} ×{s.ile}</button>)}
    </div>}

    {otwarte && <form className="mt-3 space-y-2" aria-label={`Dopisz silnik do ${maszyna}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!gotowe) return;
        const model = { rodzaj: "silnik" as const, marka: silnik.marka.trim(), nazwa: silnik.nazwa.trim(),
          wariant: silnik.wariant.trim() || null };
        onWyslij({
          maszyna: { rodzaj: "maszyna", marka: l.marka, nazwa: l.model, wariant: l.wariant },
          silnik: model, rodzajDowodu, dowodTresc: tresc.trim(),
        }, tekstAliasu && zapamietaj ? { tekst: tekstAliasu, silnik: model } : null);
      }}>
      {/* Rodzaj zablokowany na „silnik": na tej liście dopisuje się wyłącznie silniki. */}
      <PolaModelu dane={silnik} onZmiana={setSilnik} zwarte rodzajStaly />
      {tekstAliasu && <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={zapamietaj} onChange={(e) => setZapamietaj(e.target.checked)} />
        zapamiętaj w słowniku: „{tekstAliasu}" = ten silnik
      </label>}
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
