import React, { useState } from "react";
import { useKolizje, useRozstrzygnijKolizje, type KolizjaKodu } from "../api/stan";
import { Blad, Pole, Przycisk, czas } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Kolizje kodów kreskowych (z `biuro.html` 0.360.0, 0.441.0) ──────────
   Jeden kod na kilku kartotekach zatrzymuje pracę w alejce. Do 0.358.0 ta
   lista była dziennikiem bez wyjścia: biuro i hala widziały ten sam problem,
   a żadna strona nie mogła drugiej nic powiedzieć.

   DWA RODZAJE DECYZJI, bo hala reaguje na nie ODWROTNIE. `poprawione` znaczy
   „kolizja zniknie", więc kolejne trafienie dowodzi, że poprawka nie
   zadziałała. `dopuszczone` znaczy „zostanie i ma zostać" — wybieraj po
   symbolu. Serwer liczy trafienia PO decyzji, więc nieudana poprawka
   ujawnia się sama, bez niczyjej oceny.

   Błąd zapisu stoi pod tabelą, nie w `alert()` jak w biurze: okno
   przeglądarki znika po kliknięciu i zabiera ze sobą treść błędu. */

type Rodzaj = "poprawione" | "dopuszczone";

/* Opis mówi HALI, co z decyzji wynika, bo to ona zobaczy skutek na ekranie
   wyjątków. Biuro klika, ale odbiorcą decyzji jest magazynier. */
const OPIS: Record<Rodzaj, string> = {
  poprawione: "Kartoteki naprawione — kolizja ma zniknąć. Kolejne trafienie pokaże się jako nieudana poprawka.",
  dopuszczone: "Ten kod stoi na kilku kartotekach zgodnie z prawdą. Hala ma wybierać po symbolu i nie zgłaszać go drugi raz.",
};

function Decyzja({ k }: { k: KolizjaKodu }) {
  const r = k.rozstrzygniecie;
  if (!r) return <span className="text-slate-600">—</span>;
  return <div>
    <b>{r.rodzaj === "poprawione" ? "Poprawione" : "Dopuszczone"}</b>
    <div className="text-xs text-slate-600">{r.przez ?? "biuro"} · {czas(r.at)}</div>
    {r.notatka && <div className="text-xs text-slate-600">{r.notatka}</div>}
    {/* Trafienia po obiecanej poprawce to jedyny sygnał BŁĘDU w tej tabeli —
        liczba, nie opinia. Przy `dopuszczone` nie znaczą nic złego. */}
    {r.rodzaj === "poprawione" && k.trafienPoDecyzji > 0 &&
      <span className="mt-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
        poprawka nie zadziałała — {k.trafienPoDecyzji}× po decyzji</span>}
  </div>;
}

export function KartaKolizji() {
  const kolizje = useKolizje();
  const rozstrzygnij = useRozstrzygnijKolizje();
  const [forma, setForma] = useState<{ ean: string; rodzaj: Rodzaj } | null>(null);
  const [notatka, setNotatka] = useState("");
  const [blad, setBlad] = useState("");

  const zapisz = () => {
    if (!forma) return;
    setBlad("");
    rozstrzygnij.mutate({ ...forma, notatka: notatka.trim() }, {
      onSuccess: () => { setForma(null); setNotatka(""); },
      onError: (e) => setBlad(e.message),
    });
  };

  return <KartaWgladu id="karta-kody" tytul="Kody kreskowe"
    opis="Jeden kod na kilku kartotekach zatrzymuje pracę w alejce. Licznik to liczba zatrzymań — ta lista mówi, które poprawić najpierw.">
    <Tabela naglowki={["Kod", "Zatrzymań", "Rozstrzygnięte dokumentem", "Kartoteki", "Ostatnio", "Decyzja biura"]}
      pusto="Brak kolizji — każdy kod wskazuje jedną kartotekę.">
      {(kolizje.data ?? []).map((k) => <tr key={k.ean}>
        <Td className="font-semibold tabular-nums">{k.ean}</Td>
        <Td className="tabular-nums">{k.hits}×</Td>
        <Td className="tabular-nums text-slate-600">{k.autoResolved}×</Td>
        <Td className="text-slate-600">{k.twIds.join(", ")}</Td>
        <Td className="whitespace-nowrap text-slate-600">{czas(k.lastSeen)}</Td>
        <Td>
          <Decyzja k={k} />
          {forma?.ean === k.ean
            ? <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); zapisz(); }}>
                <p className="text-xs text-slate-700">{OPIS[forma.rodzaj]}</p>
                <Pole className="w-full" autoFocus value={notatka} onChange={(e) => setNotatka(e.target.value)}
                  placeholder="notatka — opcjonalnie" aria-label="Notatka do decyzji" />
                <div className="flex gap-2">
                  <Przycisk wariant="glowny" type="submit" className="!px-2.5 !py-1 !text-xs" disabled={rozstrzygnij.isPending}>
                    Zapisz {forma.rodzaj}</Przycisk>
                  <Przycisk type="button" className="!px-2.5 !py-1 !text-xs" onClick={() => setForma(null)}>Anuluj</Przycisk>
                </div>
              </form>
            : <div className="mt-2 flex gap-2">
                {(["poprawione", "dopuszczone"] as const).map((r) =>
                  <Przycisk key={r} className="!px-2.5 !py-1 !text-xs"
                    onClick={() => { setForma({ ean: k.ean, rodzaj: r }); setNotatka(""); setBlad(""); }}>
                    {r === "poprawione" ? "Poprawione" : "Dopuszczone"}</Przycisk>)}
              </div>}
        </Td>
      </tr>)}
    </Tabela>
    <Blad>{blad || kolizje.error?.message}</Blad>
  </KartaWgladu>;
}
