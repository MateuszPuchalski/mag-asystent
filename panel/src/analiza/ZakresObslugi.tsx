import React from "react";
import type { CzasOdpowiedzi, Powroty, WierszCzasu, WierszPowrotu } from "../api/wglad";
import { Liczba, PasekUdzialu } from "../ui/wykres";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { NAZWA_KATEGORII } from "../skrzynka/statusy";
import type { Kategoria } from "../api/typy";

/* ── Zakres OBSŁUGA KLIENTA (23 września 2026) ───────────────────────────────
   Luka, którą ekran zapisywał wprost: makieta F0 pokazała ten zakres, a nie
   było dla niego źródła danych. Źródłem jest dziś `services/czas-odpowiedzi.ts`
   — czas od pierwszej wiadomości klienta do naszej odpowiedzi, liczony
   z wiadomości, które i tak stoją w bazie.

   MEDIANA I DZIEWIĘĆDZIESIĄTY PERCENTYL, NIE ŚREDNIA. Jedna rozmowa odpisana
   po weekendzie ciągnie średnią tak, że tydzień pracy wygląda jak tydzień
   zaniedbań. Mediana mówi o typowym kliencie, p90 — o tym, na którego
   najczęściej ktoś się skarży.

   KATEGORIE POSORTOWANE PO LICZBIE, pasek pokazuje medianę. Pytanie, z którym
   się tu przychodzi, brzmi „gdzie tracimy czas" — i odpowiada na nie wiersz
   z długim paskiem, a nie wiersz na górze. */

function czasPo(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  const g = Math.floor(min / 60);
  if (g < 24) return `${g} g ${min % 60} min`;
  return `${Math.floor(g / 24)} d ${g % 24} g`;
}

const nazwaKategorii = (k: string) =>
  NAZWA_KATEGORII[k as Kategoria] ?? k;

function TabelaCzasu({ wiersze, naglowek, nazwa }: {
  wiersze: WierszCzasu[]; naglowek: string; nazwa: (k: string) => string;
}) {
  const max = Math.max(0, ...wiersze.map((w) => w.medianaMin ?? 0));
  return <Tabela naglowki={[naglowek, "odpowiedzi", "mediana"]} pusto="Brak odpowiedzi w tym oknie.">
    {wiersze.map((w) => <tr key={w.klucz}>
      <Td>{nazwa(w.klucz)}</Td>
      <Td className="tabular-nums">{w.n}</Td>
      <Td><div className="flex items-center gap-3">
        <span className="w-24 shrink-0 tabular-nums">{czasPo(w.medianaMin)}</span>
        <PasekUdzialu ile={w.medianaMin ?? 0} max={max} etykieta={`mediana ${czasPo(w.medianaMin)}`} />
      </div></Td>
    </tr>)}
  </Tabela>;
}

/* ── BEZ PONOWNEGO PYTANIA (24 września 2026) ────────────────────────────────
   Druga liczba obok czasu, i ważniejsza od niego: czas nagradza szybką złą
   odpowiedź, a ta liczba nie. Reguła stoi w `services/czas-odpowiedzi.ts`.

   UDZIAŁ LICZY SIĘ Z ODPOWIEDZI, KTÓRE MAJĄ WYNIK. Odpowiedź młodsza niż
   tydzień bez powrotu klienta jeszcze go nie ma, więc stoi osobno, zamiast
   poprawiać wynik ostatnich dni. Powrót bez rozpoznania też stoi osobno:
   mógł być podziękowaniem, a wynik ma mówić, ile w nim niepewności. */

const procent = (bez: number, n: number) => (n === 0 ? "—" : `${Math.round((100 * bez) / n)}%`);

function TabelaPowrotow({ wiersze, naglowek, nazwa }: {
  wiersze: WierszPowrotu[]; naglowek: string; nazwa: (k: string) => string;
}) {
  return <Tabela naglowki={[naglowek, "odpowiedzi z wynikiem", "bez ponownego pytania"]}
    pusto="Żadna odpowiedź w tym oknie nie ma jeszcze wyniku.">
    {wiersze.map((w) => <tr key={w.klucz}>
      <Td>{nazwa(w.klucz)}</Td>
      <Td className="tabular-nums">{w.n}</Td>
      <Td><div className="flex items-center gap-3">
        <span className="w-12 shrink-0 tabular-nums">{procent(w.bezPowrotu, w.n)}</span>
        <PasekUdzialu ile={w.bezPowrotu} max={w.n}
          etykieta={`${w.bezPowrotu} z ${w.n} bez ponownego pytania`} />
      </div></Td>
    </tr>)}
  </Tabela>;
}

function KartyPowrotow({ p }: { p: Powroty }) {
  return <>
    <KartaWgladu tytul="Bez ponownego pytania"
      opis={`Po naszej odpowiedzi klient nie pisał już w tej rozmowie przez ${p.oknoDni} dni. `
        + "Podziękowanie się nie liczy. Mierzy skutek, nie szybkość."}>
      <div className="flex flex-wrap gap-8">
        {/* Bez „okno N dni" (0.512.0) — okno zakresu stoi w nagłówku Analizy.
            „Młodsze niż N dni" niżej zostaje: to INNE okno, czas na powrót klienta. */}
        <Liczba ile={procent(p.bezPowrotu, p.n)} etykieta={`z ${p.n} odpowiedzi z wynikiem`} />
        <Liczba ile={p.wrocilo} etykieta={p.wrociloBezRozpoznania
          ? `klient wrócił · ${p.wrociloBezRozpoznania} bez rozpoznania, mogło być podziękowanie`
          : "klient wrócił"} />
        <Liczba ile={p.czeka} etykieta={`młodsze niż ${p.oknoDni} dni, jeszcze bez wyniku`} />
      </div>
    </KartaWgladu>
    <KartaWgladu tytul="Bez ponownego pytania według kategorii"
      opis="Gdzie odpowiedź najczęściej nie kończy sprawy.">
      <TabelaPowrotow wiersze={p.wgKategorii} naglowek="kategoria" nazwa={nazwaKategorii} />
    </KartaWgladu>
    {p.wgOsoby && <KartaWgladu tytul="Bez ponownego pytania według osoby"
      opis="Autor wysyłki z WERTIS; odpowiedź z panelu Allegro stoi jako „z Allegro”.">
      <TabelaPowrotow wiersze={p.wgOsoby} naglowek="kto" nazwa={(k) => k} />
    </KartaWgladu>}
  </>;
}

export function ZakresObslugi({ a }: { a: CzasOdpowiedzi }) {
  return <>
    <KartaWgladu tytul="Czas odpowiedzi klientowi"
      opis="Od pierwszej wiadomości klienta do naszej odpowiedzi. Autoodpowiedź się nie liczy.">
      <div className="flex flex-wrap gap-8">
        {/* Okno podaje nagłówek Analizy — tu bez powtórki (0.512.0). */}
        <Liczba ile={a.ogolem.n} etykieta="odpowiedzi" />
        <Liczba ile={czasPo(a.ogolem.medianaMin)} etykieta="mediana" />
        <Liczba ile={czasPo(a.ogolem.p90Min)} etykieta="9 na 10 odpowiedzi szybciej niż" />
        {/* Skrzynka układa się domyślnie od najdłużej czekającego klienta,
            więc to jest dokładnie lista, którą ta liczba liczy. */}
        <Liczba doPracy="/obsluga/skrzynka" ile={a.czekaTeraz.n} etykieta={a.czekaTeraz.najdluzejMin !== null
          ? `ostatnie słowo klienta teraz · najdłużej ${czasPo(a.czekaTeraz.najdluzejMin)}`
          : "ostatnie słowo klienta teraz"}
          ton={a.czekaTeraz.n > 0 ? "text-ranga-uwaga" : ""} />
      </div>
    </KartaWgladu>
    <KartyPowrotow p={a.powroty} />
    <KartaWgladu tytul="Według kategorii"
      opis="Kategoria z rozpoznania wiadomości, na którą odpowiadaliśmy.">
      <TabelaCzasu wiersze={a.wgKategorii} naglowek="kategoria" nazwa={nazwaKategorii} />
    </KartaWgladu>
    {/* Rozbicie na ludzi przychodzi WYŁĄCZNIE administratorowi (0.431.0) —
        dla biura serwer go nie liczy, więc karty nie ma w drzewie. */}
    {a.wgOsoby && <KartaWgladu tytul="Według osoby"
      opis="Autor wysyłki z WERTIS. Odpowiedź z panelu Allegro stoi jako „z Allegro”.">
      <TabelaCzasu wiersze={a.wgOsoby} naglowek="kto" nazwa={(k) => k} />
    </KartaWgladu>}
  </>;
}
