import React, { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useKolejka, useRuchKolejki, type ZadanieKolejki } from "../api/stan";
import { Blad, Przycisk } from "../ui";
import { Liczba } from "../ui/wykres";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { Potwierdz } from "./Potwierdz";

/* ── Kolejka zapisów do Subiekta (z `biuro.html`, 0.441.0) ───────────────
   Jedyna rzecz w stanie systemu, przez którą stan w Subiekcie może się nie
   zgadzać z tym, co zrobiła hala — dlatego stoi na górze (0.427.0).

   Miejsce, w którym problem WIDAĆ, jest miejscem, w którym da się go
   naprawić (0.111.0): PONÓW przy błędzie i ANULUJ przy oczekującym wołają te
   same trasy co kolektor. Biuro pisało jeszcze „ponawia się je na
   kolektorze — ta strona tylko czyta", choć od 0.111.0 to nie była prawda;
   to zdanie nie przeszło. */

const STATUS: Record<string, [string, string]> = {
  error: ["błąd", "bg-red-100 text-ranga-zle"],
  done: ["zapisane", "bg-emerald-100 text-ranga-ok"],
  waiting_for_doc: ["czeka na dokument", "bg-amber-100 text-ranga-uwaga"],
  /* Anulowane NIE jest „w drodze" — bursztyn obiecywałby zapis, który
     świadomie wycofano. Szare i po sprawie. */
  cancelled: ["anulowane", "bg-slate-100 text-slate-600"],
};

function Status({ s }: { s: string }) {
  const [slowo, klasa] = STATUS[s] ?? ["w drodze", "bg-amber-100 text-ranga-uwaga"];
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-bold ${klasa}`}>{slowo}</span>;
}

export function KartaKolejki() {
  const kolejka = useKolejka();
  const ruch = useRuchKolejki();
  const [wynik, setWynik] = useState("");
  const [blad, setBlad] = useState("");
  const s = kolejka.data?.summary;
  /* Najpierw błędy, potem reszta, najwyżej dwadzieścia wierszy: to podgląd
     stanu, a nie pełna kolejka — ta ma sto pozycji i nikt jej nie przewija. */
  const wiersze = [...(kolejka.data?.items ?? [])]
    .sort((a, b) => (a.status === "error" ? 0 : 1) - (b.status === "error" ? 0 : 1)).slice(0, 20);

  const rusz = (z: ZadanieKolejki, r: "retry" | "cancel") => {
    setWynik(""); setBlad("");
    ruch.mutate({ id: z.id, ruch: r }, {
      onSuccess: () => setWynik(r === "retry" ? "Zadanie wróciło do kolejki." : "Zadanie anulowane — zapis do Subiekta nie nastąpi."),
      onError: (e) => setBlad(e.message),
    });
  };

  return <KartaWgladu id="karta-kolejka" tytul="Zapisy do Subiekta"
    opis="Zadanie w błędzie znaczy, że hala zrobiła swoje, a do bazy firmy nic nie weszło. Ponawia się je tutaj albo na kolektorze — ta sama trasa.">
    <div className="flex flex-wrap gap-8">
      <Liczba ile={s?.error ?? "—"} etykieta="w błędzie · wymaga reakcji" ton={(s?.error ?? 0) > 0 ? "text-ranga-zle" : ""} />
      <Liczba ile={s?.pending ?? "—"} etykieta="czeka na workera" />
      <Liczba ile={s?.done ?? "—"} etykieta="zapisane (ostatnie 100)" />
    </div>
    {wynik && <p className="mt-3 text-sm text-ranga-ok">{wynik}</p>}
    <Blad>{blad || kolejka.error?.message}</Blad>
    <div className="mt-4">
      <Tabela naglowki={["Godz.", "Zadanie", "Szczegół", "Status", ""]} pusto="Kolejka pusta — wszystko zapisane.">
        {wiersze.map((z) => <tr key={z.id}>
          <Td className="tabular-nums text-slate-600">{z.time}</Td>
          <Td className="font-semibold">{z.label}</Td>
          <Td>{z.detail}{z.errMsg && <div className="text-xs text-ranga-zle">{z.errMsg}</div>}</Td>
          <Td><Status s={z.status} /></Td>
          <Td className="whitespace-nowrap">
            {/* PONÓW bez pytania: błąd już się stał, ponowienie niczego nie
                psuje. ANULUJ pyta, bo po nim zapis do Subiekta NIE nastąpi. */}
            {z.status === "error" && <Przycisk className="!px-2.5 !py-1 !text-xs" disabled={ruch.isPending}
              onClick={() => rusz(z, "retry")}><RotateCcw size={14} />Ponów</Przycisk>}
            {z.status === "pending" && <Potwierdz maly etykieta="Anuluj" pytanie="Zapis nie nastąpi."
              tak="Anuluj zadanie" trwa={ruch.isPending} onTak={() => rusz(z, "cancel")} />}
          </Td>
        </tr>)}
      </Tabela>
    </div>
  </KartaWgladu>;
}
