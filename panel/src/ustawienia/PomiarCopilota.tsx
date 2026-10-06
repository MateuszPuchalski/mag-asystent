import React from "react";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import type { PomiarCopilota as Pomiar, RodzajPropozycji, Udzial, WierszPomiaruPrzeplywu } from "../api/typy";
import { Liczba } from "./PokrycieSygnatur";
import { NAZWA_KATEGORII } from "../skrzynka/statusy";

/* ── Pomiar Copilota (§14, etap F) ───────────────────────────────────────────
   Diagnostyka mieszka ZA ZĘBATKĄ (0.168.0): ekran pracy niesie to, co woła
   o reakcję, a to jest tabela, którą czyta się raz na tydzień.

   Ta karta istnieje po to, żeby decyzja „zejdź na tańszy model" zapadła na
   liczbach. Dlatego pilnuje trzech rzeczy, których pojedynczy procent nie
   powiedziałby:

   PIERWSZA: `n`, przedział i NIEOZNACZONE stoją obok każdej precyzji
   i czułości (specyfikacja z 20 września 2026: „counts and uncertainty
   intervals"). Trzy trafienia na trzy to przedział 44–100 %, i dokładnie
   tyle ta liczba wtedy wie. Agent częściej poprawia pomyłkę, niż potwierdza
   trafienie — próbka jest skrzywiona z założenia i ekran ma to powiedzieć.

   DRUGA: udział cache. Minimalny cache'owalny prefiks zależy od modelu
   (512–4096 tokenów), a nasza instrukcja ma ich około ośmiuset. Cache może
   się nie włączyć PO CICHU; zero w tej rubryce jest jedynym objawem.

   TRZECIA: nieudane wywołania. One też kosztują, a klasyfikacji nie dają —
   licznik samych klasyfikacji zgubiłby dokładnie tę część rachunku.        */

/**
 * Udział jako „k z n · p % (dolna–górna %)". Bez `n` i przedziału procent
 * udawałby pomiar; kreska znaczy „nie było z czego liczyć", nie zero.
 */
function udzial(u: Udzial | null): string {
  if (!u) return "—";
  const pr = (x: number) => Math.round(x * 100);
  return `${u.k} z ${u.n} · ${pr(u.p)} % (${pr(u.dolna)}–${pr(u.gorna)} %)`;
}

/** Dolary na złotówki dla oka. Kurs orientacyjny — rachunek wystawia dostawca. */
const zl = (usd: number) => `${(usd * 4).toFixed(2)} zł`;

/* ── Czas czekania na Copilota (26 września 2026, 0.532.0) ──────────────
   Księga zapisywała czas każdego wywołania od początku, a nikt go nie
   czytał. Agent czeka na szkic przy otwartej rozmowie, więc to koszt
   w sekundach obok kosztu w złotych. Mediana mówi o zwykłym czekaniu,
   p90 o tym, które agent zapamięta. Nazwy zadań po ludzku, bo klucz
   z księgi to głos programisty. */
const NAZWA_ZADANIA: Record<string, string> = {
  szkic: "szkic odpowiedzi", klasyfikacja: "rozpoznanie kategorii", pytanie: "pytanie do Copilota",
  rozpoznanie_reklamacji: "rozpoznanie reklamacji",
  /* Tych trzech zadań nikt już nie zleca, ale wiersze księgi z okna pomiaru
     dalej je niosą, a koszt bez nazwy byłby kosztem bez przyczyny. */
  pasowanie_siec: "pasowanie z sieci",
  pasowanie_siec_silnik: "pasowanie od silnika", klucz_modelu: "klucz modelu z opisu",
  /* Poranek przed pracą (26 września 2026) ma własne zadania w księdze. */
  szkic_przed_praca: "szkic przed pracą", klasyfikacja_przed_praca: "rozpoznanie przed pracą",
};
const sek = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

/* ── Przepływy kategorii: tryb cienia i na żywo ──────────────────────────
   Automat zapisuje, co BY zrobił, a agent albo wysyłka to rozstrzyga. Żywe
   wykonanie włącza się per kategoria i per rodzaj, więc tabela ma dokładnie
   ten przekrój. Zgodność liczy tylko rozstrzygnięte: propozycja bez werdyktu
   nie jest ani zgodą, ani sprzeciwem. `n` stoi obok procentu, bo dwie zgody
   na dwie to nie jest powód do włączenia automatu.

   Zdanie „Na żywo: …" stoi NAD tabelą, bo to odpowiedź na pierwsze pytanie
   właściciela: co dziś odpisuje bez człowieka. Kolumna „wysłane same" mówi,
   ile razy to się stało, a zgodność obok — czy dobrze. */
const RODZAJ_PRZEPLYWU: Record<RodzajPropozycji, string> = {
  wyslij: "wysłałby odpowiedź", krok: "zleciłby hali", pilne: "oznaczyłby pilne",
};

/** „k z n · p %"; kreska przy n = 0, bo zero rozstrzygnięć to brak pomiaru, nie 0 %. */
export function zgodnoscPrzeplywu(w: Pick<WierszPomiaruPrzeplywu, "zgod" | "sprzeciwow">): string {
  const n = w.zgod + w.sprzeciwow;
  if (n === 0) return "—";
  return `${w.zgod} z ${n} · ${Math.round((w.zgod / n) * 100)} %`;
}

const nazwaKategorii = (k: string) => (NAZWA_KATEGORII as Record<string, string>)[k] ?? k;

function PrzeplywyKategorii({ wiersze, naZywo }: { wiersze: WierszPomiaruPrzeplywu[]; naZywo: string[] }) {
  /* „Nic nie wykonało się samo" liczymy z wysłanych, nie z włącznika:
     kategoria wyłączona po tygodniu na żywo zostawia w oknie pomiaru
     wysyłki, które naprawdę poszły. */
  const wyslanych = wiersze.reduce((s, w) => s + w.wyslanychNaZywo, 0);
  return <section className="mt-4 border-t pt-4 text-sm" aria-label="Przepływy kategorii">
    <h3 className="font-bold">Przepływy kategorii</h3>
    <p className="text-slate-800">{naZywo.length
      ? `Na żywo: ${naZywo.map(nazwaKategorii).join(", ")}.`
      : "Na żywo: nic — wszystkie kategorie w cieniu."}</p>
    <p className="mb-2 text-slate-600">Co automat by zrobił albo zrobił sam i czy agent się z nim zgodził.
      {wyslanych === 0 && " Nic z tego nie wykonało się samo."}</p>
    <Tabela naglowki={["kategoria", "automat", "propozycji", "wysłane same", "zgód", "sprzeciwów",
      "bez werdyktu", "zgodność"]}
      pusto="Automat jeszcze nic nie zaproponował.">
      {wiersze.map((w) => <tr key={`${w.kategoria} ${w.rodzaj}`}>
        <Td>{nazwaKategorii(w.kategoria)}</Td>
        <Td>{RODZAJ_PRZEPLYWU[w.rodzaj] ?? w.rodzaj}</Td>
        <Td className="tabular-nums">{w.propozycji}</Td>
        {/* Kreska poza wysyłką: krok i pilne na żywo nie istnieją, a zero
            sugerowałoby, że mogłyby się zdarzyć. */}
        <Td className="tabular-nums">{w.rodzaj === "wyslij" ? w.wyslanychNaZywo : "—"}</Td>
        <Td className="tabular-nums">{w.zgod}</Td>
        <Td className="tabular-nums">{w.sprzeciwow}</Td>
        <Td className="tabular-nums">{w.bezWerdyktu}</Td>
        <Td className="tabular-nums">{zgodnoscPrzeplywu(w)}</Td>
      </tr>)}
    </Tabela>
  </section>;
}

export function PomiarCopilota({ dane }: { dane: Pomiar | undefined }) {
  if (!dane) return null;
  /* Zero udziału cache przy niezerowej liczbie wywołań to objaw, nie stan
     spoczynku: cache nie włączył się, bo prefiks instrukcji jest krótszy niż
     minimum modelu albo coś go rozbija. */
  const cacheMilczy = dane.wywolan > 0 && dane.tokeny.cacheOdczyt === 0;
  const czekanie = dane.wgZadania.find((z) => z.zadanie === "szkic" && z.medianaMs !== null);
  const zCzasem = dane.wgZadania.filter((z) => z.medianaMs !== null);
  /* Rama wspólna z resztą analizy (0.519.0). Na wierzchu zostały trzy
     rzeczy, na których zapada decyzja o modelu: wywołania, nieudane
     i rachunek. Zeszły z ekranu (0.519.0): podpis „tokeny liczone od
     pierwszego wywołania", trzy kafelki tokenów i zdanie o prefiksie
     instrukcji — to głos programisty, nie agenta, a rachunek w złotych mówi
     o tokenach wszystko, co biuru potrzebne. Jedyny objaw tamtej diagnozy,
     udział cache, stoi w szczegółach i dostaje ton „uwaga". */
  return <KartaWgladu tytul="Copilot — rozpoznawanie kategorii">
    <div className="flex flex-wrap gap-8">
      <Liczba etykieta="wywołań" ile={dane.wywolan} />
      <Liczba etykieta="nieudanych" ile={dane.bledow}
        ton={dane.bledow > 0 ? "text-ranga-uwaga" : ""} />
    </div>

    <p className="mt-4 border-t pt-4 text-sm text-slate-600">
      Rachunek: <b>{dane.kosztUsd.toFixed(2)} USD</b> ({zl(dane.kosztUsd)}).
      {/* Jedno zdanie o czekaniu na wierzchu — o szkicu, bo na niego agent
          czeka przy otwartej rozmowie. Reszta zadań w szczegółach. */}
      {czekanie && <> Na szkic czeka się zwykle <b>{sek(czekanie.medianaMs)}</b>,
        {" "}co dziesiąty dłużej niż <b>{sek(czekanie.p90Ms)}</b>.</>}
    </p>

    {/* Przepływy NA WIERZCHU, nie w szczegółach: to jedyna tabela tej karty,
        na której zapada decyzja o włączeniu automatu w danej kategorii. */}
    <PrzeplywyKategorii wiersze={dane.przeplyw} naZywo={dane.naZywo} />

    {/* Decyzje, szkice i tabela precyzji zwinięte (0.519.0): to raport
        czytany raz na tydzień, a otwarty zajmował pół ekranu analizy. */}
    <details className="mt-4 border-t pt-4 text-sm">
      <summary className="cursor-pointer text-slate-600">Szczegóły</summary>

      <p className="mt-3 text-slate-600">
        Udział cache: <b className={cacheMilczy ? "text-ranga-uwaga" : ""}>{dane.udzialCache === null
          ? "—" : `${Math.round(dane.udzialCache * 100)} %`}</b>.
      </p>

      {(() => {
        const k = dane.klasyfikacja;
        return <p className="mt-3 border-t pt-3 text-slate-600" aria-label="Decyzje klasyfikatora">
          Decyzje (słownik {k.taksonomia}): <b>{k.decyzji}</b> — z modelu {k.wgZrodla.MODEL},
          {" "}ze struktury Allegro {k.wgZrodla.ALLEGRO_MAPPING}, zastępczych {k.wgZrodla.FALLBACK}.
          {" "}Nieudanych <b>{k.wgStatusu.FAILED ?? 0}</b>, do przejrzenia {k.wgStatusu.NEEDS_REVIEW ?? 0},
          {" "}wymaga człowieka {k.wymagaCzlowieka}.
          {/* Etykiety i tabela niżej dotyczą JEDNEGO klasyfikatora: precyzja zlana
              z Claude i Jeva nie mówiłaby nic o żadnym z nich. */}
          {k.biezacy && <>{" "}Etykiety i tabela dotyczą klasyfikatora
            {" "}<b>{k.biezacy.model}</b> ({k.biezacy.promptWersja}).</>}
          {" "}Etykiet człowieka: <b>{k.oznaczonych}</b> (w tym poprawek {k.poprawionych}),
          {" "}bez etykiety: <b>{k.nieoznaczonych}</b>.
          {/* Próg podany JAWNIE, bo „wygląda dobrze" to nie jest decyzja o modelu. */}
          {k.oznaczonych < 50 && <span className="text-slate-500"> Poniżej pięćdziesięciu etykiet
            liczby niżej jeszcze nic nie rozstrzygają.</span>}
          {/* Zgodność mapowania OSOBNO: specyfikacja każe ją mierzyć oddzielnie,
              bo wąskie mapowanie omija model i nie ma go w tabeli niżej. */}
          {" "}Zgodność struktury Allegro z etykietą: <b>{udzial(k.mapowanie)}</b>.
        </p>;
      })()}

      {/* SZKICE OSOBNO (0.231.0). Jeden szkic kosztuje kilkadziesiąt razy więcej
          niż etykieta, więc zlany rachunek mówiłby „klasyfikacja zdrożała".

          MIARĄ JEST LOS PRZY WYSYŁCE (22 września 2026, decyzja właściciela).
          Do tej wersji karta liczyła „użytych" z kliknięć „Wstaw" i „Zastąp",
          a wstawiony szkic bywał potem przepisany — liczba mówiła o kliknięciu,
          nie o tym, co dostał klient. Zostają: bez zmian, z poprawką i odrzucone,
          czyli jedyny ślad, że agent napisał sam. */}
      {(() => {
        const sz = dane.wgZadania.find((z) => z.zadanie === "szkic");
        if (!sz && dane.szkice.ile === 0) return null;
        return <p className="mt-3 border-t pt-3 text-slate-600" aria-label="Szkice odpowiedzi">
          Szkice odpowiedzi: <b>{sz?.wywolan ?? 0}</b> wywołań
          {sz && sz.bledow > 0 && <>, <b className="text-ranga-uwaga">{sz.bledow}</b> nieudanych</>},
          {" "}rachunek <b>{(sz?.kosztUsd ?? 0).toFixed(2)} USD</b> ({zl(sz?.kosztUsd ?? 0)}).
          {" "}Wysłanych ze szkicu: bez zmian <b>{dane.szkice.wyslanychBezZmian}</b>,
          {" "}z poprawką <b>{dane.szkice.wyslanychPoprawionych}</b>;
          {" "}odrzuconych <b>{dane.szkice.odrzuconych}</b>.
        </p>;
      })()}

      {/* SZKICE PRZED PRACĄ OSOBNO (26 września 2026). Poranek ma własny limit
          i własne zadania w księdze. Zlany z wierszem wyżej nie powiedziałby,
          ile kosztuje gotowa kolejka w poniedziałek, a o to pyta właściciel
          przy decyzji o limicie. Wiersz znika, dopóki poranek nie płacił. */}
      {(() => {
        const s = dane.wgZadania.find((z) => z.zadanie === "szkic_przed_praca");
        const k = dane.wgZadania.find((z) => z.zadanie === "klasyfikacja_przed_praca");
        if (!s && !k) return null;
        const usd = (s?.kosztUsd ?? 0) + (k?.kosztUsd ?? 0);
        const bledow = (s?.bledow ?? 0) + (k?.bledow ?? 0);
        return <p className="mt-3 border-t pt-3 text-slate-600" aria-label="Szkice przed pracą">
          Przed pracą: <b>{s?.wywolan ?? 0}</b> szkiców i <b>{k?.wywolan ?? 0}</b> rozpoznań
          {bledow > 0 && <>, <b className="text-ranga-uwaga">{bledow}</b> nieudanych</>},
          {" "}rachunek <b>{usd.toFixed(2)} USD</b> ({zl(usd)}).
        </p>;
      })()}
      {zCzasem.length > 0 && <div className="mt-3 border-t pt-3" aria-label="Czas czekania na Copilota">
        <Tabela naglowki={["zadanie", "wywołań", "zwykle", "co dziesiąte dłużej niż"]} pusto="">
          {zCzasem.map((z) => <tr key={z.zadanie}>
            <Td>{NAZWA_ZADANIA[z.zadanie] ?? z.zadanie}</Td>
            <Td className="tabular-nums">{z.wywolan}</Td>
            <Td className="tabular-nums">{sek(z.medianaMs)}</Td>
            <Td className="tabular-nums">{sek(z.p90Ms)}</Td>
          </tr>)}
        </Tabela>
      </div>}

      {/* Porównanie klasyfikatorów: zgodność modelu z etykietą człowieka,
          każdy osobno. Dopiero ta tabela rozstrzyga, który rozpoznaje lepiej. */}
      {dane.klasyfikacja.klasyfikatory.length > 1 && <div className="mt-3 border-t pt-3"
        aria-label="Porównanie klasyfikatorów">
        <Tabela naglowki={["klasyfikator", "decyzji", "etykiet", "zgodność z etykietą"]} pusto="">
          {dane.klasyfikacja.klasyfikatory.map((k) => <tr key={`${k.model} ${k.promptWersja}`}>
            <Td>{k.model} ({k.promptWersja})</Td>
            <Td className="tabular-nums">{k.decyzji}</Td>
            <Td className="tabular-nums">{k.oznaczonych}</Td>
            <Td>{udzial(k.zgodnosc)}</Td>
          </tr>)}
        </Tabela>
      </div>}

      {/* Tabela wspólna z resztą analizy (0.519.0) zamiast własnej, pisanej
          wersalikami. */}
      {dane.klasyfikacja.wgKategorii.length > 0 && <div className="mt-3 border-t pt-3">
        <Tabela naglowki={["kategoria", "przewidzianych", "precyzja", "czułość"]} pusto="">
          {dane.klasyfikacja.wgKategorii.map((k) => <tr key={k.kategoria}>
            <Td>{NAZWA_KATEGORII[k.kategoria] ?? k.kategoria}</Td>
            <Td>{k.przewidzianych}</Td><Td>{udzial(k.precyzja)}</Td><Td>{udzial(k.czulosc)}</Td>
          </tr>)}
        </Tabela>
      </div>}
    </details>
  </KartaWgladu>;
}
