import React, { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { pobierzPlik } from "../api/klient";
import { useImportZbiorek, useKandydaci, useStanSellasist, type WynikImportuZbiorek } from "../api/wglad";
import { Blad, Przycisk, czas, dzienMiesiac } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Strefa złota — kandydaci do przeniesienia (0.440.0) ────────────────
   Towary z górnych 15% rotacji, które stoją poza strefą złotą. Dane bierzemy
   ze zbiórek, które serwer sam przepisuje z Sellasist, gdy integracja stoi.
   Wgranie CSV zostaje drogą zapasową: na czas bez integracji i na okres
   sprzed niej. Ten sam okres wgrany drugi raz niczego nie zdubluje.
   Kandydat dostaje też adnotację na karcie towaru w kolektorze.

   STAN AUTOMATU STOI NAD LISTĄ. Pusta lista kandydatów nie mówi, czy
   zbiórki przestały płynąć, czy rotacja się nie zmieniła. Data ostatniego
   udanego przebiegu i liczby z siedmiu dób rozstrzygają to bez zgadywania.

   REGUŁY STOJĄ ZA ZĘBATKĄ PANELU (od 0.444.0, wcześniej w `/biuro`).
   Zdanie o nich jest drogowskazem, nie ozdobą: pusta lista bez niego wygląda
   na awarię, a nie na brak reguł. Dlatego prowadzi wprost do karty reguł
   (`?karta=strefa`), zamiast opisywać, gdzie kliknąć. */

/** Doba magazynu `RRRR-MM-DD` czytana w południe — strefa nie przesunie jej na sąsiednią. */
const doba = (d: string) => dzienMiesiac(`${d}T12:00:00`);

/* Stan drogi automatycznej. Bez integracji jedno ciche zdanie: CSV jest wtedy
   jedynym źródłem, a karta mówi, co włącza automat. Błąd odczytu stanu nie
   zasłania kandydatów, bo ci przychodzą osobną trasą. */
function ZbiorkiSellasist() {
  const stan = useStanSellasist();
  const s = stan.data;
  if (stan.error) return <Blad>{(stan.error as Error).message}</Blad>;
  if (!s) return null;
  if (!s.wlaczony) return <p className="mb-3 text-sm text-slate-600">
    Jedynym źródłem zbiórek jest wgrany CSV. Automat z Sellasist włącza się kluczami
    {" "}<code>SELLASIST_KONTO</code> i <code>SELLASIST_API_KEY</code> w <code>wertis.env</code>.</p>;
  return <section aria-label="Zbiórki z Sellasist" className="mb-4 space-y-2">
    <p className="text-sm text-slate-700">
      Zbiórki płyną same z Sellasist; CSV zostaje na wypadek przerwy.
      {" "}Ostatni udany przebieg: <b>{s.ostatniSukcesAt ? czas(s.ostatniSukcesAt) : "jeszcze żadnego"}</b>
      {s.wKolejce > 0 && <> · czeka na szczegóły: {s.wKolejce}</>}</p>
    <Blad>{s.blad}</Blad>
    <Tabela naglowki={["Doba", "Zebrane zamówienia", "Spakowane zamówienia"]}
      pusto="Sellasist nie oddał jeszcze żadnej doby.">
      {s.dni.map((d) => <tr key={d.data}>
        <Td className="tabular-nums">{doba(d.data)}</Td>
        <Td className="tabular-nums">{d.zebranych}</Td>
        <Td className="tabular-nums">{d.spakowanych}</Td>
      </tr>)}
    </Tabela>
  </section>;
}

export function Strefa() {
  const kandydaci = useKandydaci(true);
  const wgraj = useImportZbiorek();
  const plik = useRef<HTMLInputElement | null>(null);
  const [wynik, setWynik] = useState<WynikImportuZbiorek | null>(null);
  const [blad, setBlad] = useState("");
  const r = kandydaci.data;

  const wyslij = async (f: File) => {
    setWynik(null); setBlad("");
    try { setWynik(await wgraj.mutateAsync(await f.text())); }
    /* Serwer odrzuca plik, w którym poznał mniej niż połowę symboli — i mówi
       dlaczego. To zdanie trafia na ekran w całości. */
    catch (e) { setBlad(`Import odrzucony: ${(e as Error).message}`); }
  };

  return <KartaWgladu tytul="Strefa złota — kandydaci do przeniesienia"
    opis="Towary z górnych 15% rotacji, które stoją poza strefą złotą. Zbiórki przychodzą z Sellasist, gdy integracja działa; CSV zbiórek to droga zapasowa, a ten sam okres wgrany drugi raz niczego nie zdubluje."
    akcje={<>
      <Przycisk disabled={wgraj.isPending} onClick={() => plik.current?.click()}><Upload size={16} />Wgraj CSV zbiórek</Przycisk>
      <input ref={plik} type="file" accept=".csv,text/csv" hidden aria-label="Plik CSV zbiórek"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void wyslij(f);
          e.target.value = ""; // ten sam plik wybrany drugi raz też ma odpalić `change`
        }} />
      <Przycisk onClick={() => pobierzPlik("/api/biuro/zbiorki/kandydaci/csv", "wertis-strefa-kandydaci.csv")
        .catch((e: Error) => setBlad(e.message))}><Download size={16} />CSV</Przycisk>
    </>}>
    <ZbiorkiSellasist />
    {wgraj.isPending && <p className="mb-2 text-sm text-slate-600">Wysyłam plik…</p>}
    {wynik && <p className="mb-2 text-sm text-slate-700">
      Wgrano {wynik.wierszy} wierszy{wynik.okres ? ` (${wynik.okres.od} – ${wynik.okres.do})` : ""}: nowych {wynik.nowych},
      duplikatów {wynik.pominietychDuplikatow}, niedopasowanych {wynik.niedopasowanych}
      {wynik.przykladyNiedopasowanych.length > 0 && ` (np. ${wynik.przykladyNiedopasowanych.slice(0, 5).join(", ")})`}
      {wynik.odrzuconychWierszy > 0 && ` · uciętych wierszy: ${wynik.odrzuconychWierszy}`}.</p>}
    <Blad>{blad || kandydaci.error?.message}</Blad>
    {r && <>
      <p className="mb-2 text-sm text-slate-600">{r.okno
        ? `Dane ${r.okno.od} – ${r.okno.do} (${r.okno.dni} dni) · próg górnych 15%: ${r.prog} zbiórek · już w strefie: ${r.juzWStrefie} · regał bez reguły: ${r.bezReguly}`
        : "Brak danych — wgraj CSV zbiórek."}</p>
      <Tabela naglowki={["Symbol", "Nazwa", "Zbiórki", "Na dzień", "Obecny adres", "Dokąd"]}
        pusto="Nie ma kandydatów — szybka rotacja stoi tam, gdzie ma stać.">
        {r.kandydaci.map((k) => <tr key={k.twId}>
          <Td className="font-semibold">{k.sym}</Td>
          <Td>{k.nazwa}</Td>
          <Td className="tabular-nums">{k.zbiorki}</Td>
          <Td className="tabular-nums">{k.zbiorekNaDzien}</Td>
          <Td>{k.adres ?? "—"}</Td>
          <Td>poziom {k.poziomy}</Td>
        </tr>)}
      </Tabela>
    </>}
    <p className="mt-3 text-sm text-slate-600">
      Które poziomy regałów są „złote", ustawia się w ustawieniach biura —{" "}
      <Link to="/obsluga/ustawienia?karta=strefa" className="font-semibold underline">reguły strefy złotej</Link>.</p>
  </KartaWgladu>;
}
