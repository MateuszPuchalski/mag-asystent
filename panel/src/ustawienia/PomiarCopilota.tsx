import React from "react";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import type { PomiarCopilota as Pomiar, Udzial } from "../api/typy";
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
  rozpoznanie_reklamacji: "rozpoznanie reklamacji", pasowanie_siec: "pasowanie z sieci",
  pasowanie_siec_silnik: "pasowanie od silnika", klucz_modelu: "klucz modelu z opisu",
  /* Poranek przed pracą (26 września 2026) ma własne zadania w księdze. */
  szkic_przed_praca: "szkic przed pracą", klasyfikacja_przed_praca: "rozpoznanie przed pracą",
};
const sek = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

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
          {/* Los DANYCH osobno: dobry szkic bywa ze złym modelem i odwrotnie. */}
          {dane.szkice.daneZaproponowane > 0 && <> Dane doboru z rozmowy w <b>{dane.szkice.daneZaproponowane}</b> szkicach:
            {" "}wpisanych {dane.szkice.daneWpisane}, odrzuconych {dane.szkice.daneOdrzucone}.</>}
          {/* Pasowania z rozmowy (przyrost czwarty): właściwa miara to ostatnia liczba —
              czy biuro zatwierdza to, co model widzi. */}
          {dane.szkice.pasowaniaRozpoznane > 0 && <> Pasowania z rozmowy w <b>{dane.szkice.pasowaniaRozpoznane}</b> szkicach:
            {" "}zaproponowanych {dane.szkice.pasowaniaZaproponowane}, odrzuconych {dane.szkice.pasowaniaOdrzucone};
            {" "}biuro zatwierdziło <b>{dane.szkice.pasowaniaZatwierdzonePrzezBiuro}</b>.</>}
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
