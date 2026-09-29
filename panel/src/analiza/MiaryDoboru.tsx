import React from "react";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { Liczba } from "../ui/wykres";
import type { MiaryDoboru as Raport, PodstawaWyboru, WynikDoboru } from "../api/typy";
import { NAZWA_PODSTAWY, NAZWA_STANU_DOBORU } from "../skrzynka/statusy";

/* ── Miary doboru (`docs/dobor-od-zera.md` §5.1, §7) ─────────────────────────
   Dobór odpowiada klientowi jedną z czterech odpowiedzi, więc karta liczy
   właśnie je, a przy wybranej części — grupę, z której część przyszła.
   Z tej liczby widać, które grupy kandydatów warto rozwijać, a które nie
   dają części nikomu.

   `n` STOI OBOK każdego udziału. „60%" bez podstawy jest liczbą bez wagi,
   a i tak zostanie przeczytana jako fakt o pracy biura.

   ZERO ZOSTAJE W TABELI. Grupa, z której nikt nie wybrał części, to
   ustalenie, a wypadnięcie jej z listy zamieniłoby je w ciszę.

   Bez osi osobowej: karta mówi, JAK działa dobór, a nie kto pracuje lepiej.
   Ranking ludzi byłby monitoringiem pracowniczym, o który nikt nie prosił. */

const WYNIKI: WynikDoboru[] = ["czesc", "brak", "dopytac", "nie_dotyczy"];
const PODSTAWY: PodstawaWyboru[] = ["numer", "wiedza", "podobne", "reczny"];

/** Udział w procentach. Przy zerowej podstawie kreska, bo 0 z 0 to nie „0%". */
const udzial = (ile: number, z: number) => (z ? `${Math.round((ile / z) * 100)}%` : "—");

export function MiaryDoboru({ dane }: { dane: Raport | undefined }) {
  if (!dane) return null;
  const wynikow = WYNIKI.reduce((s, w) => s + (dane.wyniki[w] ?? 0), 0);
  const czesci = dane.wyniki.czesc ?? 0;
  const tytul = "Dobór — jakie odpowiedzi dostają klienci";
  /* Puste okno jest jednym zdaniem: cztery zera w tabeli niczego nie
     ustalają, a otwarte dziś mówią, czy okno jest puste, czy praca stoi. */
  if (wynikow === 0 && dane.otwarte === 0) return <KartaWgladu tytul={tytul}
    pusta="Żadnego wyniku doboru w tym oknie i nic otwartego." />;
  return <KartaWgladu tytul={tytul}>
    <div className="flex flex-wrap gap-8">
      <Liczba etykieta="wyników doboru" ile={wynikow} />
      <Liczba etykieta="otwartych dziś" ile={dane.otwarte}
        ton={dane.otwarte > 0 ? "text-ranga-uwaga" : ""} />
    </div>

    <div className="mt-4 border-t pt-4">
      <Tabela naglowki={["odpowiedź", "rozmów", `udział z ${wynikow}`]} pusto="">
        {WYNIKI.map((w) => <tr key={w}>
          <Td>{NAZWA_STANU_DOBORU[w]}</Td>
          <Td className={dane.wyniki[w] ? "font-semibold" : ""}>{dane.wyniki[w] ?? 0}</Td>
          <Td>{udzial(dane.wyniki[w] ?? 0, wynikow)}</Td>
        </tr>)}
      </Tabela>
    </div>

    <div className="mt-4 border-t pt-4">
      <Tabela naglowki={["skąd wybrana część", "części", `udział z ${czesci}`]} pusto="">
        {PODSTAWY.map((p) => <tr key={p}>
          <Td>{NAZWA_PODSTAWY[p]}</Td>
          <Td className={dane.podstawy[p] ? "font-semibold" : ""}>{dane.podstawy[p] ?? 0}</Td>
          <Td>{udzial(dane.podstawy[p] ?? 0, czesci)}</Td>
        </tr>)}
      </Tabela>
      <p className="mt-2 text-xs text-slate-600">
        Liczy ostatni wynik każdej rozmowy w oknie. Wybory sprzed nowego doboru mówią o drogach,
        nie o grupach, więc tu nie wchodzą.</p>
    </div>
  </KartaWgladu>;
}
