import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useArkuszLokalizacji, type RaportArkusza, type TrescArkusza } from "../api/stan";
import { paryZArkusza, wierszeZXlsx } from "../lib/xlsx";
import { Blad, Przycisk } from "../ui";
import { Tabela, Td } from "../ui/wglad";
import { KartaZwinieta } from "./KartaZwinieta";
import { Potwierdz } from "../ui/Potwierdz";

/* ── Masowa zmiana lokalizacji z arkusza (z `biuro.html` 0.138.0, 0.441.0) ─
   Stoi POD kolejką zapisów świadomie: to ta kolejka wykona skutek tej karty,
   a sto zadań, które się w niej pojawią, ma być widoczne w tym samym
   spojrzeniu.

   Karta stoi WYŁĄCZNIE u administratora. Serwer odmawia pozostałym już przy
   podglądzie (`routes/lokalizacje-masowe.ts`), więc biuro dostawało kartę,
   której każdy przycisk kończył się odmową. Odmowę dalej wypowiada serwer —
   przeglądarka tylko nie pokazuje drogi, która na pewno się nie uda.

   WYBÓR „ZOSTAW" ŻYJE W STANIE, nie w polach wyboru (0.139.0): każde
   przeliczenie rysuje tabelę od nowa, a zaznaczenia w DOM-ie znikałyby przy
   pierwszym kliknięciu. Zaznaczone znaczy „zdejmij", bo arkusz PODMIENIA
   pole; „zostaw" jest wyjątkiem od tej reguły, nie nową regułą.

   ZWINIĘTA (0.509.0): arkusz wgrywa się raz na jakiś czas, a otwarta karta
   stała z długą instrukcją na drugim miejscu ekranu. Miejsce pod kolejką
   zostaje. Stan wgranego pliku żyje w tym komponencie, nie w ramie, więc
   zwinięcie w połowie przeglądu niczego nie gubi. */

export function KartaArkusza({ otworz = false }: { otworz?: boolean }) {
  const arkusz = useArkuszLokalizacji();
  const plik = useRef<HTMLInputElement | null>(null);
  const [tresc, setTresc] = useState<TrescArkusza | null>(null);
  const [raport, setRaport] = useState<RaportArkusza | null>(null);
  const [zostaw, setZostaw] = useState<Map<string, Set<string>>>(new Map());
  const [zapisano, setZapisano] = useState<RaportArkusza | null>(null);
  const [komunikat, setKomunikat] = useState("");
  const [blad, setBlad] = useState("");

  const doWyslania = (m: Map<string, Set<string>>) =>
    Object.fromEntries([...m].filter(([, k]) => k.size).map(([s, k]) => [s, [...k]]));

  const przelicz = (t: TrescArkusza, m: Map<string, Set<string>>) => {
    setBlad("");
    arkusz.mutate({ tresc: t, zachowaj: doWyslania(m), zastosuj: false }, {
      onSuccess: (r) => setRaport(r),
      onError: (e) => setBlad(e.message),
    });
  };

  const wczytaj = async (f: File) => {
    setRaport(null); setZapisano(null); setBlad(""); setKomunikat(`Czytam ${f.name}…`);
    try {
      /* CSV jedzie na serwer TEKSTEM: parser CSV jest tam już napisany
         i przetestowany. Drugi w przeglądarce byłby drugim miejscem do
         poprawiania tego samego błędu. */
      const t: TrescArkusza = /\.csv$/i.test(f.name)
        ? { csv: await f.text() }
        : { wiersze: paryZArkusza(await wierszeZXlsx(await f.arrayBuffer())) };
      /* Nowy plik = nowe wybory. Zaznaczenia z poprzedniego dotyczyły innych
         wierszy i po cichu przeniosłyby się na te same symbole. */
      const m = new Map<string, Set<string>>();
      setTresc(t); setZostaw(m); setKomunikat("");
      przelicz(t, m);
    } catch (e) {
      setTresc(null); setKomunikat(""); setBlad((e as Error).message);
    }
  };

  const przelacz = (symbol: string, kod: string, zdejmij: boolean) => {
    if (!tresc) return;
    const m = new Map(zostaw);
    const k = new Set(m.get(symbol) ?? []);
    if (zdejmij) k.delete(kod); else k.add(kod);
    m.set(symbol, k);
    setZostaw(m);
    przelicz(tresc, m);
  };

  const hurtem = (zostawWszystkie: boolean) => {
    if (!tresc || !raport) return;
    const m = new Map<string, Set<string>>();
    if (zostawWszystkie) for (const z of raport.doZmiany) if (z.znikaja.length) m.set(z.symbol, new Set(z.znikaja));
    setZostaw(m);
    przelicz(tresc, m);
  };

  const zastosuj = () => {
    if (!tresc) return;
    setBlad("");
    arkusz.mutate({ tresc, zachowaj: doWyslania(zostaw), zastosuj: true }, {
      onSuccess: (r) => { setZapisano(r); setRaport(null); setTresc(null); },
      onError: (e) => setBlad(e.message),
    });
  };

  const r = raport;
  return <KartaZwinieta id="karta-arkusz" tytul="Masowa zmiana lokalizacji" otworz={otworz}
    opis="Tylko administrator. Wyeksportuj kartoteki z Subiekta, popraw kolumnę Lokalizacja i wgraj plik (.xlsx albo .csv). Arkusz podmienia całe pole adresu; nic nie idzie do Subiekta przed kliknięciem Zastosuj."
    akcje={<>
      <Przycisk disabled={arkusz.isPending} onClick={() => plik.current?.click()}><Upload size={16} />Wgraj arkusz</Przycisk>
      <input ref={plik} type="file" hidden aria-label="Plik arkusza lokalizacji"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void wczytaj(f);
          e.target.value = ""; // ten sam plik wybrany drugi raz też ma odpalić `change`
        }} />
      {r && r.doZmiany.length > 0 && <Potwierdz etykieta="Zastosuj"
        pytanie={`Zmian: ${r.doZmiany.length}. Każda pojedzie do bazy firmy i nie ma cofnięcia jednym kliknięciem.`}
        tak="Zapisz do Subiekta" trwa={arkusz.isPending} onTak={zastosuj} />}
    </>}>
    {komunikat && <p className="text-sm text-slate-600">{komunikat}</p>}
    <Blad>{blad}</Blad>
    {zapisano && <p className="text-sm"><b>Zakolejkowano {zapisano.zakolejkowano ?? 0} zmian.</b> Wykonuje je kolejka zapisów wyżej.</p>}
    {r && <>
      <p className="text-sm text-slate-700">
        Wierszy w arkuszu: <b>{r.wierszy}</b> · do zmiany: <b>{r.doZmiany.length}</b> · bez zmian: {r.bezZmian}
        {/* Liczniki TYLKO niezerowe — pusty licznik przy pierwszym wgraniu
            byłby pytaniem bez powodu. */}
        {r.wKolejce > 0 && ` · już czeka w kolejce: ${r.wKolejce}`}
        {r.nieznane.length > 0 && ` · nieznane symbole: ${r.nieznane.length}`}
        {r.odrzucone.length > 0 && ` · odrzucone: ${r.odrzucone.length}`}</p>
      {/* Osiemdziesiąt wierszy odklikanych po jednym to nie jest opcja, więc
          obok wyboru per wiersz stoi ten sam wybór dla całego pliku. */}
      {r.doZmiany.some((z) => z.znikaja.length) && <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        Obecne adresy spoza arkusza:
        <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={() => hurtem(false)}>Zdejmij wszystkie</Przycisk>
        <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={() => hurtem(true)}>Zostaw wszystkie</Przycisk></p>}
      <div className={`mt-3 ${arkusz.isPending ? "opacity-60" : ""}`}>
        {r.doZmiany.length === 0
          ? <p className="text-sm text-slate-600">{r.wKolejce
            ? "Wszystkie zmiany z tego arkusza już czekają w kolejce — nie kolejkujemy ich drugi raz."
            : "Żaden wiersz nie zmienia adresu — arkusz mówi to samo, co Subiekt."}</p>
          : <Tabela naglowki={["Symbol", "Nazwa", "Było", "Będzie", "Zdjąć obecne"]} pusto="">
            {r.doZmiany.map((z) => <tr key={z.symbol}>
              <Td className="font-semibold">{z.symbol}</Td>
              <Td>{z.nazwa}</Td>
              <Td className="text-slate-600">{z.przed || "—"}</Td>
              <Td className="font-semibold">{z.po}</Td>
              <Td>{z.znikaja.length === 0 ? <span className="text-slate-600">—</span>
                : <span className="flex flex-wrap gap-2">{z.znikaja.map((kod) =>
                  <label key={kod} className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!z.zachowane.includes(kod)} disabled={arkusz.isPending}
                      onChange={(e) => przelacz(z.symbol, kod, e.target.checked)} />{kod}</label>)}</span>}</Td>
            </tr>)}
          </Tabela>}
      </div>
    </>}
    {/* Odrzucone i nieznane Z NAZWY, nie samą liczbą: to lista do poprawienia
        w arkuszu, a „5 błędów" nie mówi, których wierszy szukać. */}
    {(r ?? zapisano) && (r ?? zapisano)!.odrzucone.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-bold">Odrzucone wiersze</h3>
      <ul className="mt-1 text-sm">{(r ?? zapisano)!.odrzucone.map((o) =>
        <li key={o.symbol}><b>{o.symbol}</b> — {o.powod}</li>)}</ul></div>}
    {(r ?? zapisano) && (r ?? zapisano)!.nieznane.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-bold">Symbole spoza kartoteki</h3>
      <p className="text-sm text-slate-600">{(r ?? zapisano)!.nieznane.join(", ")}</p></div>}
  </KartaZwinieta>;
}
