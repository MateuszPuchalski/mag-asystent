import React from "react";
import type { GotowoscKlasy, LosSzkicow, PomiarTarcia } from "../api/wglad";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { PasekUdzialu } from "../ui/wykres";
import { czas, ile, odmien } from "../ui";
import { NAZWA_KATEGORII } from "../skrzynka/statusy";

/* ── Pomiary pod decyzje (26 września 2026, 0.532.0) ────────────────────
   Właściciel chce rozstrzygać politykę skrzynki danymi, nie przekonaniem.
   Każda sekcja nosi nazwę DECYZJI, której służy, bo liczba bez pytania
   czyta się jak ocena ludzi. Na wierzchu jedno zdanie na decyzję,
   szczegóły zwinięte — ten sam kształt co reszta Analizy (§26e).

   Nie ma tu osób. Wszystkie cztery liczby mówią o skrzynce, więc czyta je
   całe biuro; rozbicie na ludzi zostaje w „Tarcie według osoby", tylko dla
   administratora. Powód każdej liczby przy `services/tarcie.ts`.

   Barw oceny nie ma z tego samego powodu co w karcie tarcia: żadna z tych
   liczb nie jest dobra ani zła sama z siebie. Rozstrzyga właściciel. */

const procent = (u: number | null) => (u === null ? "—" : `${Math.round(u * 100)}%`);

/** Nazwa klasy dla człowieka; klucze spoza słownika („bez rozpoznania") zostają, jak są. */
const klasa = (k: string) => (NAZWA_KATEGORII as Record<string, string>)[k] ?? k;

function Sekcja({ tytul, naWierzchu, children }: {
  tytul: string; naWierzchu: React.ReactNode; children: React.ReactNode;
}) {
  return <section aria-label={tytul} className="min-w-0">
    <h3 className="font-bold">{tytul}</h3>
    <div className="mt-1">{naWierzchu}</div>
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-slate-600">Szczegóły</summary>
      <div className="mt-2 space-y-2 text-slate-600">{children}</div>
    </details>
  </section>;
}

/** Zdanie na wierzchu — jedno na decyzję, pogrubiona liczba w środku. */
const Zdanie = ({ children }: { children: React.ReactNode }) =>
  <p className="text-naglowek">{children}</p>;

function OknoCofniecia({ o }: { o: PomiarTarcia["oknoCofniecia"] }) {
  const zmierzonych = o.kubelki.reduce((s, k) => s + k.ile, 0) + o.poOknie;
  return <Sekcja tytul="Okno cofnięcia" naWierzchu={o.odczyt
    ? <Zdanie><b>{procent(o.odczyt.udzial)}</b> cofnięć przed {o.odczyt.przedSek} s</Zdanie>
    : <Zdanie>Brak zmierzonych cofnięć w tym oknie.</Zdanie>}>
    <p>Cofniętych <b>{o.cofnietych}</b> z {ile(o.odlozonych, "odłożonej wysyłki", "odłożonych wysyłek",
      "odłożonych wysyłek")} ({procent(o.udzial)}). Gdy prawie wszystkie cofnięcia padają w pierwszych
      sekundach, reszta okna to czekanie klienta bez pożytku.</p>
    {zmierzonych > 0 && <Tabela naglowki={["po ilu sekundach", "cofnięć"]} pusto="">
      {o.kubelki.map((k) => <tr key={k.doSek}>
        <Td>{k.odSek}–{k.doSek} s</Td>
        <Td><PasekUdzialu ile={k.ile} max={zmierzonych} /></Td>
      </tr>)}
    </Tabela>}
    {o.poOknie > 0 && <p>Później niż po 10 s: {o.poOknie}.</p>}
    {o.bezCzasu > 0 && <p>Bez czasu: {o.bezCzasu} — cofnięte, zanim skrzynka zaczęła mierzyć sekundy.
      Liczą się w udziale, nie w rozkładzie.</p>}
  </Sekcja>;
}

const kZn = (l: LosSzkicow) => `${l.bezZmian} z ${l.zeSzkicem}`;

function TarcieSzkicu({ t }: { t: PomiarTarcia["tarcieSzkicu"] }) {
  const z = t.zTwierdzeniami, bez = t.bezTwierdzen;
  return <Sekcja tytul="Tarcie przy szkicu" naWierzchu={z.zeSzkicem + bez.zeSzkicem > 0
    ? <Zdanie>Bez zmian: <b>{procent(z.udzialBezZmian)}</b> szkiców z twierdzeniami do sprawdzenia,
      {" "}<b>{procent(bez.udzialBezZmian)}</b> bez nich</Zdanie>
    : <Zdanie>Brak wysłanych szkiców z policzonymi twierdzeniami.</Zdanie>}>
    <p>„Wyślij bez zmian” staje tylko przy szkicu z twierdzeniami spoza naszej bazy. Gdy obie liczby
      są równe, przycisk nie zmienia tego, jak szkice idą do klienta.</p>
    <p>Z twierdzeniami: {kZn(z)}. Bez twierdzeń: {kZn(bez)}.
      {t.bezDanych > 0 && <> Wcześniejszych szkiców bez tej wiedzy: {t.bezDanych}.</>}</p>
    {t.przedPo
      ? <p>Przed {czas(t.przedPo.granica)} bez zmian szło {procent(t.przedPo.przed.udzialBezZmian)}
        {" "}({kZn(t.przedPo.przed)}), od tej chwili {procent(t.przedPo.po.udzialBezZmian)} ({kZn(t.przedPo.po)}).
        {" "}To porównuje całe wydanie z tarciem, nie samo tarcie — zmieniło też napisy przycisków.</p>
      : <p>Porównania przed i po wejściu tarcia nie da się policzyć: po jednej ze stron nie ma
        żadnego wysłanego szkicu.</p>}
  </Sekcja>;
}

/* Tydzień to próg ze specyfikacji autowysyłki z 20 września 2026: dowody
   z tygodnia pracy, bramka per klasa i wyłącznik. Karta podaje tylko
   dowody — samej autowysyłki nie ma. */
const DNI_DOWODU = 7;

function Gotowosc({ g }: { g: GotowoscKlasy[] }) {
  const najlepsza = g.find((x) => x.udzial);
  return <Sekcja tytul="Gotowość do autowysyłki" naWierzchu={najlepsza?.udzial
    ? <Zdanie>Najmocniej: {klasa(najlepsza.kategoria)} — co najmniej <b>{procent(najlepsza.udzial.dolna)}</b>
      {" "}szkiców bez zmian{najlepsza.dni < DNI_DOWODU && <>, ale z {ile(najlepsza.dni, "dnia", "dni", "dni")}</>}</Zdanie>
    : <Zdanie>Brak wysłanych szkiców w tym oknie.</Zdanie>}>
    <p>„Co najmniej” to dolna granica przedziału 95%: trzy z trzech to jeszcze tylko 44%.
      Autowysyłka wymaga dowodów z tygodnia pracy w danej kategorii.</p>
    <Tabela naglowki={["kategoria", "bez zmian", "co najmniej", "dni z danymi"]} pusto="Brak szkiców w tym oknie.">
      {g.map((k) => <tr key={k.kategoria}>
        <Td>{klasa(k.kategoria)}</Td>
        <Td className="tabular-nums">{k.bezZmian} z {k.zeSzkicem}</Td>
        <Td className="tabular-nums">{procent(k.udzial?.dolna ?? null)}</Td>
        <Td className="tabular-nums">{k.dni}</Td>
      </tr>)}
    </Tabela>
  </Sekcja>;
}

function Pominiecia({ p }: { p: PomiarTarcia["pominiecia"] }) {
  /* Licznik, który nigdy nie ruszył, nie ma prawa pokazać zera jak pomiaru:
     „0 pominiętych" czytałoby się jak wynik, a to brak zgłoszeń ze skrzynki. */
  return <Sekcja tytul="Pominięcia" naWierzchu={p.odKiedy === null
    ? <Zdanie>Skrzynka nie zgłosiła jeszcze żadnego pominięcia.</Zdanie>
    : <Zdanie><b>{p.pominiec}</b>
      {" "}{odmien(p.pominiec, "pominięta rozmowa", "pominięte rozmowy", "pominiętych rozmów")}
      {" "}przy {ile(p.wyslanych, "wysyłce", "wysyłkach", "wysyłkach")}</Zdanie>}>
    <p>Pominięcie to rozmowa otwarta i zostawiona bez odpowiedzi, zakończenia, odłożenia i notatki.
      Licznik zna tylko dzień i kategorię — nie wie, kto ani która rozmowa.</p>
    <Tabela naglowki={["dzień", "pominięte", "wysłane"]} pusto="Brak pominięć i wysyłek w tym oknie.">
      {p.wgDnia.map((d) => <tr key={d.dzien}>
        <Td className="tabular-nums">{d.dzien}</Td>
        <Td className="tabular-nums">{d.pominiec}</Td>
        <Td className="tabular-nums">{d.wyslanych}</Td>
      </tr>)}
    </Tabela>
    <Tabela naglowki={["kategoria", "pominięte", "wysłane"]} pusto="">
      {p.wgKategorii.map((k) => <tr key={k.kategoria}>
        <Td>{klasa(k.kategoria)}</Td>
        <Td className="tabular-nums">{k.pominiec}</Td>
        <Td className="tabular-nums">{k.wyslanych}</Td>
      </tr>)}
    </Tabela>
  </Sekcja>;
}

export function PomiaryDecyzji({ t }: { t: PomiarTarcia }) {
  return <KartaWgladu tytul="Pomiary pod decyzje"
    opis="Cztery pytania o zasady skrzynki, każde z jedną liczbą. Żadna nie mówi o ludziach i żadna nie jest oceną.">
    <div className="grid gap-6 md:grid-cols-2">
      <OknoCofniecia o={t.oknoCofniecia} />
      <TarcieSzkicu t={t.tarcieSzkicu} />
      <Gotowosc g={t.gotowosc} />
      <Pominiecia p={t.pominiecia} />
    </div>
  </KartaWgladu>;
}
