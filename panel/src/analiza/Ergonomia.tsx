import React from "react";
import type { Ergonomia } from "../api/wglad";
import { Liczba } from "../ui/wykres";
import { liczbaPl } from "./liczby";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Ergonomia w liczbach (zakres PRACA HALI) ────────────────────────────
   Pytanie właściciela: „jak sprawić, żeby kolektor był przyjemny w pracy?".
   Tu odpowiada hala, nie opinia: gdzie jest wolno, gdzie skanuje się dwa
   razy, co serwer odrzuca, który kolektor gubi sieć i ile pracy się poprawia.
   Wzór danych i powód każdej granicy: `server/src/services/ergonomia.ts`.

   KAŻDA TABELA MÓWI, CO Z NIĄ ZROBIĆ, w zdaniu pod nagłówkiem. Liczba bez
   „co dalej" jest ciekawostką, a ta karta ma być listą roboczą.

   ŻADNYCH NAZWISK — per kolektor i per czynność. Karta mierzy narzędzie;
   wydajność ludzi stoi osobno, u administratora, z podstawą prawną.

   Udział powyżej 300 ms, nie średnia: to próg, od którego ludzie skanują
   dwa razy. Średnią jedna przerwa Wi-Fi zawyża tak samo jak sto wolnych
   odpowiedzi, a ta liczba odróżnia oba przypadki. */

/* Tytuły ekranów kolektora — lustro `SCREEN_TITLES` w `core/nav/NavModel.kt`.
   Test czyta tamten plik i pilnuje, że żaden ekran nie zostaje z surową
   nazwą. Nazwa spoza listy (starszy APK, nowy ekran) pokazuje się taka,
   jaka przyszła — lepiej brzydko niż wcale. */
export const NAZWA_EKRANU: Record<string, string> = {
  SPLASH: "Start", HOME: "Skan / szukaj", PRODUCT: "Karta towaru", SCAN_LOC: "Dodanie lokalizacji",
  QUEUE: "Kolejka Sfery", DELIVERY_DOCS: "Dostawy", DELIVERY_LINES: "Dostawa",
  PRZYJECIA: "Rozkładanie zwrotów", KOSZ_LINES: "Kosz zwrotów", KARTONY: "Kartony", KARTON: "Karton",
  LOCATION: "Lokalizacja", SETTINGS: "Ustawienia", PROBLEMS: "Wyjątki", FIELD_TASKS: "Zadania z biura",
  SETUP: "Konta", POLACZENIE: "Połączenie", KOLEKTORY: "Znajdź kolektor",
};

/* Nazwy zdarzeń poprawek słowem — klucze z `CZYNNOSCI` w serwisie. */
export const NAZWA_POPRAWKI: Record<string, string> = {
  putaway_cofniete: "cofnięte odłożenie",
  putaway_qty_fixed: "korekta ilości",
  putaway_polka_zmieniona: "zmiana półki",
  delivery_reopened: "ponowne otwarcie",
  problem_wycofany: "wycofane zgłoszenie",
  kosz_putaway_poprawka: "poprawione odłożenie",
  kosz_putaway_cofniete: "cofnięte odłożenie",
  kosz_pominiecie_cofniete: "cofnięte pominięcie",
  kosz_zakonczenie_cofniete: "cofnięte zakończenie",
  karton_pozycja_usunieta: "usunięta pozycja",
  karton_ilosc: "ilość wpisana ręcznie",
};

const procent = (u: number | null) => (u == null ? "—" : `${liczbaPl(Math.round(u * 1000) / 10)}%`);

/** Udział wolnych odpowiedzi — powyżej jednej na dziesięć czerwień, bo to już odczuwalne. */
const Wolne = ({ ile, udzial }: { ile: number; udzial: number }) =>
  <span className={`tabular-nums ${udzial > 0.1 ? "font-bold text-ranga-zle" : ""}`}>
    {ile} ({procent(udzial)})</span>;

function Sekcja({ tytul, co, children }: { tytul: string; co: string; children: React.ReactNode }) {
  return <section>
    <h3 className="text-sm font-bold">{tytul}</h3>
    <p className="mb-2 text-xs text-slate-600">{co}</p>
    {children}
  </section>;
}

export function KartaErgonomii({ e }: { e: Ergonomia }) {
  const c = e.czasy;
  return <KartaWgladu tytul="Ergonomia w liczbach"
    opis={<>Gdzie kolektor przeszkadza w pracy — per ekran, kolektor i czynność, <b>nigdy per osoba</b>.
      Wolna odpowiedź to powyżej {e.progMs} ms: od tego progu ludzie skanują dwa razy.</>}>
    <div className="flex flex-wrap gap-8">
      <Liczba ile={c.n ? procent(c.udzialPowyzejProgu) : "—"} etykieta={`odpowiedzi wolniejszych niż ${e.progMs} ms`}
        ton={c.udzialPowyzejProgu > 0.1 ? "text-ranga-zle" : ""} />
      <Liczba ile={c.p95 ?? "—"} etykieta="p95 wszystkich żądań" />
      <Liczba ile={c.n} etykieta="zmierzonych żądań" />
    </div>
    {c.n === 0 && <p className="mt-3 text-sm text-slate-600">
      Brak pomiarów czasu z pracy. Kolektory zaczną je wysyłać po aktualizacji aplikacji, paczką co 5 minut.
      Do tego czasu czas mierzy wyłącznie skan na ekranie głównym — tabela niżej.</p>}

    <div className="mt-5 grid gap-6 xl:grid-cols-2">
      <Sekcja tytul="Gdzie jest wolno"
        co="Ekran i trasa z największą liczbą wolnych odpowiedzi. Na górze szuka się przyczyny: ciężkie zapytanie albo słaby zasięg w tej strefie.">
        <Tabela naglowki={["Ekran", "Trasa", "Żądań", "Wolnych", "p95"]} pusto="Brak pomiarów w tym oknie.">
          {c.wgTrasy.map((t) => <tr key={`${t.ekran} ${t.trasa}`}>
            <Td className="font-semibold">{NAZWA_EKRANU[t.ekran] ?? t.ekran}</Td>
            <Td className="font-mono text-xs">{t.trasa}</Td>
            <Td className="tabular-nums">{t.n}</Td>
            <Td><Wolne ile={t.powyzejProgu} udzial={t.udzialPowyzejProgu} /></Td>
            <Td className="whitespace-nowrap text-slate-600">{t.p95 ?? "—"}</Td>
          </tr>)}
        </Tabela>
      </Sekcja>
      <Sekcja tytul="Kolektory z wolnymi odpowiedziami"
        co="Jeden kolektor wyraźnie gorszy od reszty to zwykle jego Wi-Fi albo bateria, nie serwer.">
        <Tabela naglowki={["Kolektor", "Żądań", "Wolnych", "p95"]} pusto="Brak pomiarów w tym oknie.">
          {c.wgKolektora.map((k) => <tr key={k.device ?? "-"}>
            <Td className="font-mono font-bold">{k.etykieta}</Td>
            <Td className="tabular-nums">{k.n}</Td>
            <Td><Wolne ile={k.powyzejProgu} udzial={k.udzialPowyzejProgu} /></Td>
            <Td className="whitespace-nowrap text-slate-600">{k.p95 ?? "—"}</Td>
          </tr>)}
        </Tabela>
      </Sekcja>

      <Sekcja tytul="Najczęstsze odrzucenia"
        co="Każdy wiersz to zdanie, które hala widzi najczęściej. Przepisz je na „zrób X zamiast tego” albo usuń przyczynę na ekranie.">
        <Tabela naglowki={["Trasa", "Kod", "Powód", "Razy", "Kolektorów"]} pusto="Serwer niczego nie odrzucił.">
          {e.odrzucenia.map((o) => <tr key={`${o.trasa} ${o.status} ${o.powod}`}>
            <Td className="font-mono text-xs">{o.trasa}</Td>
            <Td className="tabular-nums text-slate-600">{o.status ?? "—"}</Td>
            <Td>{o.powod}</Td>
            <Td className="tabular-nums font-semibold">{o.ile}</Td>
            <Td className="tabular-nums">{o.urzadzen}</Td>
          </tr>)}
        </Tabela>
      </Sekcja>
      <Sekcja tytul="Poprawki na czynność"
        co="Ile zapisanej pracy trzeba było cofnąć albo poprawić. Wysoki udział to ekran, który prowokuje pomyłkę — nie ludzie, którzy ją robią.">
        <Tabela naglowki={["Czynność", "Wykonane", "Poprawki", "Na 100", "Z czego"]} pusto="Brak pracy w tym oknie.">
          {e.poprawki.map((p) => <tr key={p.czynnosc}>
            <Td className="font-semibold">{p.czynnosc}</Td>
            <Td className="tabular-nums">{p.wykonane}</Td>
            <Td className="tabular-nums">{p.poprawek}</Td>
            <Td className="tabular-nums">{p.udzial == null ? "—" : liczbaPl(Math.round(p.udzial * 1000) / 10)}</Td>
            <Td className="text-xs text-slate-600">{Object.entries(p.rozbicie).filter(([, n]) => n > 0)
              .map(([t, n]) => `${NAZWA_POPRAWKI[t] ?? t}: ${n}`).join(", ") || "—"}</Td>
          </tr>)}
        </Tabela>
      </Sekcja>

      <Sekcja tytul="Przerwy w łączności"
        co="Kolektor na górze gubi sieć najdłużej. Sprawdź jego strefę pracy i punkt dostępowy, zanim podejrzysz aplikację.">
        <Tabela naglowki={["Kolektor", "Przerw", "Razem", "Najdłuższa"]} pusto="Żadnej przerwy dłuższej niż 5 s.">
          {e.przerwy.map((p) => <tr key={p.device ?? "-"}>
            <Td className="font-mono font-bold">{p.etykieta}</Td>
            <Td className="tabular-nums">{p.przerw}</Td>
            <Td className="tabular-nums">{liczbaPl(p.minutRazem)} min</Td>
            <Td className="tabular-nums">{liczbaPl(p.najdluzszaMin)} min</Td>
          </tr>)}
        </Tabela>
      </Sekcja>
      <Sekcja tytul="Skan na ekranie głównym"
        co={`Stary pomiar: tylko skan z ekranu głównego, więc nie rozkładanie. Powtórka to ten sam kod z tego samego kolektora w 2 s — pierwszy skan „nie zadziałał”. p95 wszystkich: ${e.skanGlowny.p95 != null ? `${e.skanGlowny.p95} ms` : "—"}.`}>
        <Tabela naglowki={["Kolektor", "Skanów", "Powtórzonych", "p95"]} pusto="Brak skanów w tym oknie.">
          {e.powtorzoneSkany.map((s) => {
            const t = e.skanGlowny.wgKolektora.find((k) => k.device === s.device);
            return <tr key={s.device ?? "-"}>
              <Td className="font-mono font-bold">{s.etykieta}</Td>
              <Td className="tabular-nums">{s.skanow}</Td>
              <Td><Wolne ile={s.powtorzonych} udzial={s.udzial} /></Td>
              <Td className="tabular-nums text-slate-600">{t?.p95 != null ? `${t.p95} ms` : "—"}</Td>
            </tr>;
          })}
        </Tabela>
      </Sekcja>
    </div>
  </KartaWgladu>;
}
