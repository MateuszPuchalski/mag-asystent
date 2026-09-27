import React, { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { pobierzPlik } from "../api/klient";
import { FILTR_PUSTY, paramyDziennika, useDziennik, type FiltrDziennika } from "../api/wglad";
import { useAgenci } from "../api/rozmowy";
import { Blad, Karta, Pole, Przycisk, Pusto, dataLokalna, stempel } from "../ui";
import { KLASA_RODZINY, rodzinaZdarzenia } from "../dziennik/rodziny";
import { nazwaZdarzenia } from "../dziennik/nazwy";
import { opisZdarzenia } from "../dziennik/opis";
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

   TRZY FILTRY POD „WIĘCEJ FILTRÓW" (0.514.0). Siedem pól naraz przytłaczało,
   a towar, urządzenie i liczbę wierszy ustawia się rzadko — zwykle szuka się
   po dniu, typie i osobie. Ustawiony filtr nigdy się nie chowa: pola stoją
   na widoku, dopóki któreś odbiega od domyślnego, bo schowany filtr to
   tabela, która kłamie o tym, co pokazuje. */

/* ── PO POLSKU, WARIANT C Z MAKIET (@wydanie) ────────────────────────────
   Decyzja właściciela z 27 września 2026. Tabela została tabelą — w śladzie
   audytowym szuka się konkretu po kolumnach: kto, kiedy, który towar. Zmieniło
   się to, czego nie dało się czytać bez ściągawki:

   - kolumna „Zdarzenie" niesie polską nazwę, a klucz serwera stoi w dymku
     (`dziennik/nazwy.ts`),
   - „Co się stało" zastępuje schowany JSON jednym zdaniem z danych wpisu
     (`dziennik/opis.ts`); surowe dane są w dymku komórki i w CSV,
   - osoba i urządzenie stoją w jednej kolumnie, bo czyta się je razem,
   - okres wybiera się jednym polem zamiast wpisywania dwóch dat,
   - pomiary techniczne (czas skanu, przeliczenia) są schowane, bo potrafiły
     być co trzecim wierszem i zakopywały błędy. Chowa je serwer, więc
     licznik „pokazano N z M" liczy dokładnie to, co widać. */

const LIMITY = [100, 500, 1000];

type Okres = "najnowsze" | "dzis" | "wczoraj" | "tydzien" | "wlasny";

/** Data lokalna sprzed `dni` dni — `dataLokalna` z `ui/`, bo tam mieszkają formaty czasu. */
const dzienTemu = (dni: number) => dataLokalna(new Date(Date.now() - dni * 86_400_000).toISOString());

/** Granice okresu jako daty z pola; „własny" zostawia to, co człowiek wpisał. */
function granice(o: Okres): { od: string; do: string } | null {
  if (o === "najnowsze") return { od: "", do: "" };
  if (o === "dzis") return { od: dzienTemu(0), do: dzienTemu(0) };
  if (o === "wczoraj") return { od: dzienTemu(1), do: dzienTemu(1) };
  if (o === "tydzien") return { od: dzienTemu(6), do: dzienTemu(0) };
  return null;
}

/** Czy któryś z rzadkich filtrów odbiega od domyślnego — wtedy zostają na widoku. */
const dodatkoweUstawione = (f: FiltrDziennika) =>
  f.twId !== FILTR_PUSTY.twId || f.device !== FILTR_PUSTY.device || f.limit !== FILTR_PUSTY.limit;

export function Dziennik() {
  const [szkic, setSzkic] = useState<FiltrDziennika>(FILTR_PUSTY);
  const [filtr, setFiltr] = useState<FiltrDziennika>(FILTR_PUSTY);
  const [okres, setOkres] = useState<Okres>("najnowsze");
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
  const wybierzOkres = (o: Okres) => {
    setOkres(o);
    const g = granice(o);
    if (g) setSzkic((f) => ({ ...f, ...g }));
  };
  const pobierz = () => {
    setBladCsv("");
    pobierzPlik(`/api/events/csv?${paramyDziennika(filtr)}`, "wertis-audyt.csv")
      .catch((e: Error) => setBladCsv(e.message));
  };
  const d = dziennik.data;
  /* Typy w filtrze „Co" po polskiej nazwie, nie po kluczu: alfabet kluczy
     rozrzucał „Odłożenie" i „Odłożenie cofnięte" po dwóch końcach listy. */
  const typy = [...(d?.typy ?? [])].sort((a, b) => nazwaZdarzenia(a).localeCompare(nazwaZdarzenia(b), "pl"));

  return <div className="space-y-3 lg:h-full lg:overflow-y-auto">
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtr dziennika">
      <h1 className="text-tytul mr-2 flex items-center gap-2 self-center font-bold"><FileText size={20} />Dziennik</h1>
      <Etykieta napis="Okres">
        <select className="field" value={okres} onChange={(e) => wybierzOkres(e.target.value as Okres)}>
          <option value="najnowsze">najnowsze</option>
          <option value="dzis">dziś</option>
          <option value="wczoraj">wczoraj</option>
          <option value="tydzien">ostatnie 7 dni</option>
          <option value="wlasny">od–do…</option>
        </select></Etykieta>
      {okres === "wlasny" && <>
        <Etykieta napis="Od"><Pole type="date" value={szkic.od} onChange={(e) => zmien("od", e.target.value)} /></Etykieta>
        <Etykieta napis="Do"><Pole type="date" value={szkic.do} onChange={(e) => zmien("do", e.target.value)} /></Etykieta>
      </>}
      <Etykieta napis="Co">
        <select className="field max-w-64" value={szkic.typ} onChange={(e) => zmien("typ", e.target.value)}>
          <option value="">wszystko</option>
          {typy.map((t) => <option key={t} value={t}>{nazwaZdarzenia(t)}</option>)}
        </select></Etykieta>
      <Etykieta napis="Osoba">
        <select className="field" value={szkic.userRef} onChange={(e) => zmien("userRef", e.target.value)}>
          <option value="">wszystkie</option>
          {(agenci.data?.users ?? []).map((u) => <option key={u.userId} value={String(u.userId)}>{u.name}</option>)}
        </select></Etykieta>
      {/* „Towar", nie „Towar (tw_id)" (0.514.0): agent nie zna nazwy kolumny
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
      {/* Pobranie CSV jest odczytem, ale serwer zapisuje je do śladu — kto
          wynosi dziennik z firmy, sam się w nim znajduje. */}
      <Przycisk className="ml-auto" onClick={pobierz}><Download size={16} />CSV</Przycisk>
    </div>
    <Blad>{bladCsv}</Blad>

    {/* 403 znaczy „ta rola nie ogląda śladu" i jest poprawną odpowiedzią, nie
        awarią — ma być widać to zdanie, nie pustą tabelę. */}
    <Blad>{dziennik.error?.message}</Blad>

    {d && <Karta className="overflow-hidden">
      <p className="flex flex-wrap items-baseline gap-x-3 border-b px-4 py-2 text-sm text-slate-600">
        <span>pokazano <b>{d.wpisy.length}</b> z <b>{d.razem}</b> pasujących wpisów</span>
        {/* Przy wybranym typie pomiary nie są chowane (`paramyDziennika`),
            więc przełącznik nie miałby nic do zrobienia. */}
        {!szkic.typ && <button type="button" onClick={() => zmien("techniczne", !szkic.techniczne)}
          aria-pressed={szkic.techniczne} className="font-semibold text-slate-700 underline-offset-2 hover:underline">
          {szkic.techniczne ? "schowaj pomiary techniczne" : "pokaż pomiary techniczne"}</button>}
      </p>
      {d.wpisy.length === 0
        ? <Pusto waga="lista">Brak wpisów dla tego filtra.</Pusto>
        : <div className="overflow-x-auto">
          <table className={`w-full text-sm ${dziennik.isPlaceholderData ? "opacity-60" : ""}`}>
            <thead><tr className="border-b text-left text-xs text-slate-600">
              <th className="px-4 py-2 font-bold">Czas</th>
              <th className="py-2 pr-3 font-bold">Zdarzenie</th>
              <th className="py-2 pr-3 font-bold">Co się stało</th>
              <th className="py-2 pr-3 font-bold">Kto, czym</th>
              <th className="py-2 pr-4 font-bold">Towar</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.wpisy.map((w) => <tr key={w.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-600">{stempel(w.czas)}</td>
                <td className="py-1.5 pr-3">
                  {/* Klucz w dymku: po nim szuka się w CSV i w kodzie serwera. */}
                  <span title={w.typ} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${KLASA_RODZINY[rodzinaZdarzenia(w.typ)]}`}>
                    {nazwaZdarzenia(w.typ)}</span></td>
                {/* Surowe dane w dymku: opis jest odczytem, dowodem zostaje wpis. */}
                <td className="py-1.5 pr-3 text-slate-700" title={w.payload ?? undefined}>
                  {opisZdarzenia(w.typ, w.payload) || <span className="text-slate-600">—</span>}</td>
                <td className="py-1.5 pr-3">{w.uzytkownik}
                  {w.userRef == null && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">bez konta</span>}
                  {w.device && <span className="whitespace-nowrap text-slate-600"> · {w.device}</span>}</td>
                <td className="py-1.5 pr-4 tabular-nums text-slate-600">
                  {w.twId != null ? <PrzyciskTowaru twId={w.twId}>{w.twId}</PrzyciskTowaru> : "—"}</td>
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
