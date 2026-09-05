import React from "react";
import type { Zwrot } from "../api/typy";
import { Skopiuj } from "../ui";
import { KUBELKI } from "./Kolejka";
import { Link } from "./Link";

/* ── Nagłówek sprawy (0.207.0) ───────────────────────────────────────────────
   Wydzielony z `ekrany/Zwroty.tsx` razem z przeprowadzką numeru i loginu.
   Powód jest ten sam co przy `Decyzje` i `Dowody`: nagłówek niesie własne
   reguły — nieodebrana paczka, brak numeru, brak loginu — a te da się
   sprawdzić testem dopiero wtedy, gdy stoją osobno od całego ekranu.

   TOŻSAMOŚĆ ZWROTU NALEŻY DO NAGŁÓWKA. Do 0.206.0 numer stał w dwóch
   miejscach naraz — jako tytuł i jako wiersz w sekcji ZWROT po prawej —
   a login kupującego tylko po prawej, czyli po drugiej stronie ekranu od
   nazwiska sprawy. To pierwsze, co się czyta, i jedyne, co się przepisuje. */

export function Naglowek({ zwrot }: { zwrot: Zwrot }) {
  const nieodebrana = zwrot.zrodlo === "nieodebrana";

  return <header className="shrink-0 border-b border-slate-200 p-4">
    <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
      {nieodebrana
        /* Paczka nieodebrana nie ma zwrotu w Allegro, więc nie ma czego
           otwierać — serwer oddaje wtedy `linkZwrotu = null`. */
        ? (zwrot.externalId.replace(/^nieodebrana:/, "") || "bez numeru")
        /* Numer prowadzi do listy zwrotów Centrum Sprzedaży, wyszukanej po tym
           numerze. Bez adresu zostaje sam tekst: `Link` nie robi odnośnika
           donikąd, bo taki kosztuje kliknięcie i zaufanie do ekranu. */
        : <Link href={zwrot.linkZwrotu}>{zwrot.numer ?? zwrot.externalId}</Link>}
      {/* Oznaczenie stoi PRZY NUMERZE, nie w dowodach: operator ma wiedzieć,
          z czym pracuje, zanim cokolwiek kliknie. */}
      {nieodebrana &&
        <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">
          nieodebrana paczka</span>}
    </h2>

    {/* Pytanie bierze się z kubełka WYBRANEGO zwrotu, nie z zakładki listy.
        Te dwie rzeczy rozjeżdżają się przy wejściu z paska adresu, a wtedy
        nagłówek pytałby o co innego niż klawisze. */}
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
      <span>{KUBELKI.find((k) => k.id === zwrot.kubelek)?.pytanie}</span>
      <span aria-hidden className="text-slate-300">·</span>
      {/* Login jest jedyną daną osobową, którą polityka danych zwrotów
          dopuszcza wprost — imienia Allegro nie podaje wcale.

          STOI ZAWSZE (0.177.0). Do 0.176.0 znikał przy pustym polu, więc na
          ekranie nie było ani loginu, ani śladu po nim, a właściciel szukał go
          i nie znalazł. Puste pole ma powiedzieć, że to Allegro go nie podało,
          a nie zostawiać ekran milczący o kupującym. */}
      {zwrot.kupujacyLogin
        ? <span className="inline-flex items-center gap-1 break-all font-semibold text-slate-700">
            {zwrot.kupujacyLogin}
            <Skopiuj tekst={zwrot.kupujacyLogin} tytul="Kopiuj login kupującego" />
          </span>
        : <span className="text-slate-400">kupujący: Allegro nie podało</span>}
    </p>

    {nieodebrana && <p className="mt-1 text-xs text-violet-800">
      Klient nie zgłosił zwrotu — przesyłka wróciła nieodebrana.
      {zwrot.notatka ? ` „${zwrot.notatka}"` : ""}</p>}
  </header>;
}
