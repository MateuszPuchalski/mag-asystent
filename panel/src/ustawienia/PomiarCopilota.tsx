import React from "react";
import { Karta } from "../ui";
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

export function PomiarCopilota({ dane }: { dane: Pomiar | undefined }) {
  if (!dane) return null;
  const proc = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
  return <Karta className="overflow-hidden">
    <header className="flex items-baseline gap-2 border-b p-4">
      <b className="text-naglowek mr-auto">Copilot — rozpoznawanie kategorii</b>
      <span className="text-xs text-slate-500">tokeny liczone od pierwszego wywołania</span>
    </header>

    <div className="flex flex-wrap gap-8 p-4">
      <Liczba etykieta="wywołań" ile={dane.wywolan} />
      <Liczba etykieta="nieudanych" ile={dane.bledow}
        ton={dane.bledow > 0 ? "text-ranga-uwaga" : ""} />
      <Liczba etykieta="tokenów wejścia" ile={dane.tokeny.wej} />
      <Liczba etykieta="tokenów wyjścia" ile={dane.tokeny.wyj} />
      <Liczba etykieta="z cache" ile={dane.tokeny.cacheOdczyt} />
    </div>

    <p className="border-t p-4 text-sm text-slate-600">
      Rachunek: <b>{dane.kosztUsd.toFixed(2)} USD</b> ({zl(dane.kosztUsd)}).
      {" "}Udział cache: <b>{dane.udzialCache === null
        ? "—" : `${Math.round(dane.udzialCache * 100)} %`}</b>.
      {/* Zero przy niezerowej liczbie wywołań to objaw, nie stan spoczynku. */}
      {dane.wywolan > 0 && dane.tokeny.cacheOdczyt === 0 &&
        <span className="font-semibold text-ranga-uwaga"> Cache się nie włączył —
          prefiks instrukcji jest krótszy niż minimum modelu albo coś go rozbija.</span>}
    </p>

    {(() => {
      const k = dane.klasyfikacja;
      return <p className="border-t p-4 text-sm text-slate-600" aria-label="Decyzje klasyfikatora">
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
        Miarą szkicu nie jest trafność, tylko los: wstawiony albo zastąpiony
        znaczy, że agent go użył; odrzucony — że napisał sam. */}
    {(() => {
      const sz = dane.wgZadania.find((z) => z.zadanie === "szkic");
      if (!sz && dane.szkice.ile === 0) return null;
      const uzyte = dane.szkice.wstawionych + dane.szkice.zastapionych;
      const ocenionych = uzyte + dane.szkice.odrzuconych;
      return <p className="border-t p-4 text-sm text-slate-600" aria-label="Szkice odpowiedzi">
        Szkice odpowiedzi: <b>{sz?.wywolan ?? 0}</b> wywołań
        {sz && sz.bledow > 0 && <>, <b className="text-ranga-uwaga">{sz.bledow}</b> nieudanych</>},
        {" "}rachunek <b>{(sz?.kosztUsd ?? 0).toFixed(2)} USD</b> ({zl(sz?.kosztUsd ?? 0)}).
        {" "}Użytych: <b>{proc(uzyte, ocenionych)}</b> z {ocenionych} ocenionych
        {" "}(wstawionych {dane.szkice.wstawionych}, zastąpionych {dane.szkice.zastapionych},
        {" "}odrzuconych {dane.szkice.odrzuconych}).
        {/* Los PRZY WYSYŁCE (22 września 2026): specyfikacja mierzy, ile
            szkiców poszło bez zmian, a ile z poprawką — to mówi więcej niż
            samo „wstawiony", bo wstawiony szkic bywa potem przepisany. */}
        {dane.szkice.wyslanychBezZmian + dane.szkice.wyslanychPoprawionych > 0 && <> Wysłanych
          ze szkicu: bez zmian <b>{dane.szkice.wyslanychBezZmian}</b>,
          {" "}z poprawką <b>{dane.szkice.wyslanychPoprawionych}</b>.</>}
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

    {dane.klasyfikacja.wgKategorii.length > 0 && <div className="border-t p-4">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-slate-500">
          <th className="pb-1">kategoria</th><th className="pb-1">przewidzianych</th>
          <th className="pb-1">precyzja</th><th className="pb-1">czułość</th>
        </tr></thead>
        <tbody>{dane.klasyfikacja.wgKategorii.map((k) => <tr key={k.kategoria} className="border-t">
          <td className="py-1">{NAZWA_KATEGORII[k.kategoria] ?? k.kategoria}</td>
          <td>{k.przewidzianych}</td><td>{udzial(k.precyzja)}</td><td>{udzial(k.czulosc)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </Karta>;
}
