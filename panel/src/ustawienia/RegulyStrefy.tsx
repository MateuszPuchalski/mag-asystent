import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useStrefa, useZapiszStrefe, type RegulaStrefy as Regula } from "../api/ustawienia";
import { Blad, Pole, Przycisk } from "../ui";
import { KartaWgladu } from "../ui/wglad";

/* ── Reguły strefy złotej (z `biuro.html`, 0.444.0) ─────────────────────
   Które poziomy regałów są „złote" (75–140 cm — bez schylania i bez
   drabiny). Reguła obejmuje całą alejkę ALBO zakres regałów; walidację
   robi serwer (`bladReguly`) i jego zdanie stoi pod tabelą bez przeróbek,
   bo on wie, która reguła i dlaczego.

   ZAPIS PODMIENIA KOMPLET, jak trasa. Wiersz całkiem pusty jest pomijany,
   więc usunięcie to krzyżyk albo wyczyszczenie pól.

   PUSTY KOMPLET BLOKUJEMY PRZED WYSŁANIEM, a nie po odmowie: serwer i tak
   go odrzuci, ale jego „podaj co najmniej jedną regułę" nie mówi, CZEMU.
   A powód jest ważny — bez reguł żaden towar nie dostaje adnotacji strefy,
   bo regał bez reguły to „nie wiem", nie „nie". */

const PUSTA: Regula = { alejka: "", od: "", do: "", poziomy: "" };
const niepusta = (r: Regula) => !!(r.alejka.trim() || r.od.trim() || r.do.trim() || r.poziomy.trim());

export function RegulyStrefy() {
  const strefa = useStrefa();
  const zapis = useZapiszStrefe();
  const [reguly, setReguly] = useState<Regula[]>([]);
  const [wynik, setWynik] = useState("");

  useEffect(() => { if (strefa.data) setReguly(strefa.data.reguly); }, [strefa.data]);

  const zmien = (i: number, pole: keyof Regula, v: string) =>
    setReguly((rs) => rs.map((r, j) => (j === i ? { ...r, [pole]: v } : r)));
  const doZapisu = reguly.map((r) => ({
    alejka: r.alejka.trim(), od: r.od.trim(), do: r.do.trim(), poziomy: r.poziomy.trim(),
  })).filter(niepusta);

  const komorka = (i: number, pole: keyof Regula, etykieta: string, przyklad: string, max: number, szer: string) =>
    <td className="py-1.5 pr-3">
      <Pole className={szer} aria-label={`${etykieta}, reguła ${i + 1}`} placeholder={przyklad} maxLength={max}
        value={reguly[i][pole]} onChange={(e) => zmien(i, pole, e.target.value)} />
    </td>;

  return <KartaWgladu id="karta-strefa" tytul="Reguły strefy złotej"
    opis={<>Które poziomy regałów są „złote” (75–140 cm — bez schylania i bez drabiny). Reguła obejmuje całą alejkę
      albo zakres regałów, nie oba naraz. Zapis podmienia komplet i od razu przelicza kandydatów, których pokazuje{" "}
      <Link to="/obsluga/analiza" className="font-semibold underline">Analiza → Praca hali</Link>.</>}>
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead><tr className="border-b text-left text-xs text-slate-600">
          {["Alejka", "Regał od", "Regał do", "Poziomy", ""].map((n) => <th key={n} className="py-1.5 pr-3 font-bold">{n}</th>)}
        </tr></thead>
        <tbody>
          {reguly.map((_r, i) => <tr key={i}>
            {komorka(i, "alejka", "Alejka", "A", 1, "w-16")}
            {komorka(i, "od", "Regał od", "D01", 3, "w-20")}
            {komorka(i, "do", "Regał do", "D05", 3, "w-20")}
            {komorka(i, "poziomy", "Poziomy", "2,3", 20, "w-28")}
            <td className="py-1.5">
              <Przycisk className="!px-2 !py-1" aria-label={`Usuń regułę ${i + 1}`}
                onClick={() => setReguly((rs) => rs.filter((_x, j) => j !== i))}><X size={14} /></Przycisk>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Przycisk onClick={() => setReguly((rs) => [...rs, { ...PUSTA }])}><Plus size={16} />Reguła</Przycisk>
      <Przycisk wariant="glowny" disabled={zapis.isPending || !strefa.data || doZapisu.length === 0}
        onClick={() => {
          setWynik("");
          zapis.mutate(doZapisu, {
            onSuccess: (d) => setWynik(`Zapisano ${d.regul} — kandydaci policzą się od nowa przy następnym wejściu do analizy.`),
          });
        }}>Zapisz reguły</Przycisk>
      {doZapisu.length === 0 && strefa.data &&
        <span className="text-sm text-ranga-uwaga">Bez reguł żaden towar nie dostanie adnotacji strefy — zostaw co najmniej jedną.</span>}
      {wynik && <span className="text-sm text-ranga-ok">{wynik}</span>}
    </div>
    <Blad>{strefa.error?.message || zapis.error?.message}</Blad>
  </KartaWgladu>;
}
