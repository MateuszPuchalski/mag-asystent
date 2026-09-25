import React, { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { pobierzPlik } from "../api/klient";
import { FILTR_PUSTY, paramyDziennika, useDziennik, type FiltrDziennika } from "../api/wglad";
import { useAgenci } from "../api/rozmowy";
import { Blad, Karta, Pole, Przycisk, Pusto, stempel } from "../ui";
import { KLASA_RODZINY, rodzinaZdarzenia } from "../dziennik/rodziny";
import { PrzyciskTowaru } from "../towar/Szuflada";

/* ── DZIENNIK (0.440.0) ─────────────────────────────────────────────────
   Przeniesiony z DZIENNIKA w `biuro.html`. Ślad audytowy: każdy skan, każda
   decyzja i każdy błąd — z osobą, urządzeniem i czasem. Wgląd, nie praca:
   ekran nie zmienia niczego, a pobranie CSV sam serwer zapisuje do śladu.

   FILTR DZIAŁA OD RAZU, BEZ „SZUKAJ" (dekalog pkt 1). W biurze filtry czekały
   na przycisk, więc każda zmiana kosztowała dwa ruchy, a zapomniany przycisk
   zostawiał pod nowym filtrem stare wiersze — tabela kłamała o tym, co
   pokazuje. Tu pola tekstowe czekają ćwierć sekundy, jak szukanie w archiwum
   dostaw, a listy i daty działają od razu.

   FILTRY W JEDNYM RZĘDZIE NAD TABELĄ, nie w karcie: rządzą całym ekranem,
   a stojąc w środku karty wyglądały jak jeszcze jeden wiersz treści.

   TRZY FILTRY POD „WIĘCEJ FILTRÓW" (@wydanie). Siedem pól naraz przytłaczało,
   a towar, urządzenie i liczbę wierszy ustawia się rzadko — zwykle szuka się
   po dniu, typie i osobie. Ustawiony filtr nigdy się nie chowa: pola stoją
   na widoku, dopóki któreś odbiega od domyślnego, bo schowany filtr to
   tabela, która kłamie o tym, co pokazuje. */

const LIMITY = [100, 500, 1000];

/** Czy któryś z rzadkich filtrów odbiega od domyślnego — wtedy zostają na widoku. */
const dodatkoweUstawione = (f: FiltrDziennika) =>
  f.twId !== FILTR_PUSTY.twId || f.device !== FILTR_PUSTY.device || f.limit !== FILTR_PUSTY.limit;

export function Dziennik() {
  const [szkic, setSzkic] = useState<FiltrDziennika>(FILTR_PUSTY);
  const [filtr, setFiltr] = useState<FiltrDziennika>(FILTR_PUSTY);
  useEffect(() => { const t = setTimeout(() => setFiltr(szkic), 250); return () => clearTimeout(t); }, [szkic]);
  const dziennik = useDziennik(filtr);
  /* Lista kont to wygoda, nie warunek: rola bez dostępu do niej (403) zostawia
     filtr osoby pusty, a dziennik działa dalej — tak samo jak w biurze. */
  const agenci = useAgenci();
  const [bladCsv, setBladCsv] = useState("");
  const [wiecej, setWiecej] = useState(false);
  const ustawione = dodatkoweUstawione(szkic);
  const widacWiecej = wiecej || ustawione;

  const zmien = <K extends keyof FiltrDziennika>(k: K, v: FiltrDziennika[K]) => setSzkic((f) => ({ ...f, [k]: v }));
  const pobierz = () => {
    setBladCsv("");
    pobierzPlik(`/api/events/csv?${paramyDziennika(filtr)}`, "wertis-audyt.csv")
      .catch((e: Error) => setBladCsv(e.message));
  };
  const d = dziennik.data;

  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <FileText size={18} /><b className="text-naglowek">Dziennik</b>
      <span className="mr-auto text-sm text-slate-500">
        Każdy skan, każda decyzja i każdy błąd — z osobą, urządzeniem i czasem.</span>
      {/* Pobranie CSV jest odczytem, ale serwer zapisuje je do śladu — kto
          wynosi dziennik z firmy, sam się w nim znajduje. */}
      <Przycisk onClick={pobierz}><Download size={16} />CSV</Przycisk>
    </Karta>
    <Blad>{bladCsv}</Blad>

    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtr dziennika">
      <Etykieta napis="Od"><Pole type="date" value={szkic.od} onChange={(e) => zmien("od", e.target.value)} /></Etykieta>
      <Etykieta napis="Do"><Pole type="date" value={szkic.do} onChange={(e) => zmien("do", e.target.value)} /></Etykieta>
      <Etykieta napis="Typ">
        <select className="field" value={szkic.typ} onChange={(e) => zmien("typ", e.target.value)}>
          <option value="">wszystkie</option>
          {(d?.typy ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select></Etykieta>
      <Etykieta napis="Osoba">
        <select className="field" value={szkic.userRef} onChange={(e) => zmien("userRef", e.target.value)}>
          <option value="">wszystkie</option>
          {(agenci.data?.users ?? []).map((u) => <option key={u.userId} value={String(u.userId)}>{u.name}</option>)}
        </select></Etykieta>
      {/* „Towar", nie „Towar (tw_id)" (@wydanie): agent nie zna nazwy kolumny
          w bazie, a numer kartoteki widzi w kolumnie „Towar" tej samej tabeli. */}
      {widacWiecej && <>
        <Etykieta napis="Towar">
          <Pole className="w-28" inputMode="numeric" value={szkic.twId} onChange={(e) => zmien("twId", e.target.value)} /></Etykieta>
        <Etykieta napis="Urządzenie">
          <Pole className="w-36" value={szkic.device} onChange={(e) => zmien("device", e.target.value)} /></Etykieta>
        <Etykieta napis="Wierszy">
          <select className="field" value={szkic.limit} onChange={(e) => zmien("limit", Number(e.target.value))}>
            {LIMITY.map((l) => <option key={l} value={l}>{l}</option>)}
          </select></Etykieta>
      </>}
      {/* Przełącznik znika, gdy rzadki filtr jest ustawiony: zwinąć się go
          i tak nie da, a przycisk, który nic nie robi, to jeszcze jedna decyzja. */}
      {!ustawione && <Przycisk type="button" aria-expanded={widacWiecej} onClick={() => setWiecej(!widacWiecej)}>
        {widacWiecej ? "Mniej filtrów" : "Więcej filtrów"}</Przycisk>}
    </div>

    {/* 403 znaczy „ta rola nie ogląda śladu" i jest poprawną odpowiedzią, nie
        awarią — ma być widać to zdanie, nie pustą tabelę. */}
    <Blad>{dziennik.error?.message}</Blad>

    {d && <Karta className="overflow-hidden">
      <p className="border-b px-4 py-2 text-sm text-slate-600">
        pokazano <b>{d.wpisy.length}</b> z <b>{d.razem}</b> pasujących wpisów</p>
      {d.wpisy.length === 0
        ? <Pusto waga="lista">Brak wpisów dla tego filtra.</Pusto>
        : <div className="overflow-x-auto">
          <table className={`w-full text-sm ${dziennik.isPlaceholderData ? "opacity-60" : ""}`}>
            <thead><tr className="border-b text-left text-xs text-slate-600">
              <th className="px-4 py-2 font-bold">Czas</th>
              <th className="py-2 pr-3 font-bold">Typ</th>
              <th className="py-2 pr-3 font-bold">Osoba</th>
              <th className="py-2 pr-3 font-bold">Urządzenie</th>
              <th className="py-2 pr-3 font-bold">Towar</th>
              <th className="py-2 pr-4 font-bold">Szczegóły</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.wpisy.map((w) => <tr key={w.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-600">{stempel(w.czas)}</td>
                <td className="py-1.5 pr-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KLASA_RODZINY[rodzinaZdarzenia(w.typ)]}`}>
                    {w.typ}</span></td>
                <td className="py-1.5 pr-3">{w.uzytkownik}
                  {w.userRef == null && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">bez konta</span>}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{w.device || "—"}</td>
                <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                  {w.twId != null ? <PrzyciskTowaru twId={w.twId}>{w.twId}</PrzyciskTowaru> : "—"}</td>
                {/* 160 znaków jak w biurze: szczegół ma podpowiedzieć, co się
                    stało, a całość i tak jest w CSV. Zwinięte (@wydanie), bo
                    surowy JSON w każdym wierszu zagłuszał czas, typ i osobę —
                    po nich się czyta dziennik, szczegół otwiera się raz na sto. */}
                <td className="py-1.5 pr-4">{w.payload
                  ? <details><summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-900">szczegóły</summary>
                    <code className="break-all text-xs text-slate-700">{w.payload.slice(0, 160)}</code></details>
                  : <span className="text-slate-600">—</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </Karta>}
  </div>;
}

function Etykieta({ napis, children }: { napis: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">{napis}{children}</label>;
}
