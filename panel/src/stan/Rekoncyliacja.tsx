import React from "react";
import { Download, SearchCheck } from "lucide-react";
import { useRekoncyliacja, type Rekoncyliacja, type RodzajRozjazdu } from "../api/stan";
import { Blad, Przycisk, czas, dataLokalna } from "../ui";
import { Tabela, Td } from "../ui/wglad";
import { KartaZwinieta } from "./KartaZwinieta";

/* ── Rekoncyliacja (z `biuro.html`, 0.441.0) ────────────────────────────
   Czy Subiekt ma to, co zapisaliśmy. Liczona NA ŻĄDANIE — powód przy
   `useRekoncyliacja`.

   NAZWY WSZYSTKICH DZIEWIĘCIU RODZAJÓW. Biuro znało cztery pierwsze, a serwer
   od 0.2xx dokładał kolejne: kosze i zwroty. Rozjazd spoza słownika wychodził
   na ekran surowym kluczem w rodzaju `zwrot_rozliczony_bez_korekty`.
   `Record<RodzajRozjazdu, …>` każe kompilatorowi upomnieć się o każdy nowy
   rodzaj z unii serwera, a test sprawdza, że unia jest ta sama.

   ZWINIĘTA (0.509.0): sprawdzenie na żądanie, którego wynik zwykle brzmi
   „bez rozjazdów", a nocny przebieg liczy to samo codziennie. */

export const NAZWA_ROZJAZDU: Record<RodzajRozjazdu, string> = {
  lokalizacja: "adres w Subiekcie",
  zadanie_w_bledzie: "zadanie w błędzie",
  utknelo_w_buforze: "utknęło w buforze",
  mm_czeka: "MM czeka na wykonanie",
  kosz_czeka_na_korekte: "kosz czeka na korektę",
  kosz_bez_powrotu: "kosz bez powrotu MM",
  zwrot_bez_przelewu: "zwrot bez przelewu",
  zwrot_po_terminie: "zwrot po terminie",
  zwrot_rozliczony_bez_korekty: "zwrot rozliczony bez korekty",
};

/**
 * CSV składany na miejscu: rekoncyliacja nie ma trasy eksportu, a plik
 * z nocnego przebiegu leży na serwerze, do którego biuro nie ma dostępu.
 * BOM na początku — bez niego Excel PL rozjeżdża polskie znaki.
 */
export function csvRozjazdow(r: Rekoncyliacja): string {
  const pole = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linie = [["rodzaj", "klucz", "opis", "od_kiedy"].join(";"),
    ...r.rozjazdy.map((x) => [x.rodzaj, x.klucz, x.opis, x.odKiedy ?? ""].map(pole).join(";"))];
  return "\uFEFF" + linie.join("\r\n") + "\r\n";
}

function pobierzCsv(r: Rekoncyliacja) {
  const url = URL.createObjectURL(new Blob([csvRozjazdow(r)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `wertis-rozjazdy-${dataLokalna(r.at)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function KartaRekoncyliacji({ otworz = false }: { otworz?: boolean }) {
  const rek = useRekoncyliacja();
  const r = rek.data;
  return <KartaZwinieta id="karta-rekoncyliacja" tytul="Rekoncyliacja" otworz={otworz}
    opis="Porównuje adresy w Subiekcie z ostatnim udanym zapisem i wyławia sprawy, o których wszyscy zapomnieli. Pusty wynik to wynik dobry."
    akcje={<>
      <Przycisk disabled={rek.isFetching} onClick={() => void rek.refetch()}><SearchCheck size={16} />
        {rek.isFetching ? "Sprawdzam…" : "Sprawdź teraz"}</Przycisk>
      {r && r.rozjazdy.length > 0 && <Przycisk onClick={() => pobierzCsv(r)}><Download size={16} />CSV</Przycisk>}
    </>}>
    <Blad>{rek.error?.message}</Blad>
    {!r
      ? <p className="text-sm text-slate-600">Nie sprawdzano w tym otwarciu ekranu. Nocny przebieg liczy to samo codziennie.</p>
      : <>
        <p className="mb-2 text-sm text-slate-600">Sprawdzono {czas(r.at)}: {r.sprawdzono.kartotek} kartotek i {r.sprawdzono.zadan} zadań.</p>
        <Tabela naglowki={["Rodzaj", "Czego dotyczy", "Opis", "Od kiedy"]} pusto="Bez rozjazdów.">
          {r.rozjazdy.map((x, i) => <tr key={`${x.rodzaj}-${x.klucz}-${i}`}>
            <Td><span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
              {NAZWA_ROZJAZDU[x.rodzaj] ?? x.rodzaj}</span></Td>
            <Td className="font-semibold">{x.klucz}</Td>
            <Td>{x.opis}</Td>
            <Td className="whitespace-nowrap text-slate-600">{czas(x.odKiedy)}</Td>
          </tr>)}
        </Tabela>
      </>}
  </KartaZwinieta>;
}
