import React from "react";
import { MessageSquare, UserRound } from "lucide-react";
import type { RozmowaZwrotu, Zwrot } from "../api/typy";
import { LoginKlienta, Skopiuj, czas, ile } from "../ui";
import { PrzyciskHistorii } from "../sprawy/HistoriaKlienta";
import { Link as RouterLink } from "react-router-dom";
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
    <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-naglowek font-bold">
      {nieodebrana
        /* Paczka nieodebrana nie ma zwrotu w Allegro, więc nie ma czego
           otwierać — serwer oddaje wtedy `linkZwrotu = null`. */
        ? (zwrot.externalId.replace(/^nieodebrana:/, "") || "bez numeru")
        /* Numer prowadzi do listy zwrotów Centrum Sprzedaży, wyszukanej po tym
           numerze. Bez adresu zostaje sam tekst: `Link` nie robi odnośnika
           donikąd, bo taki kosztuje kliknięcie i zaufanie do ekranu. */
        : <Link href={zwrot.linkZwrotu}>{zwrot.numer ?? zwrot.externalId}</Link>}
      {/* Oznaczenie stoi PRZY NUMERZE, nie w dowodach: operator ma wiedzieć,
          z czym pracuje, zanim cokolwiek kliknie.

          ZDANIE O NIEODEBRANIU MIESZKA W PODPOWIEDZI (@wydanie). Stało też
          fioletowym wierszem pod nagłówkiem, więc ten sam fakt padał na
          ekranie trzy razy: plakietka, wiersz i sekcja paczki. Plakietka mówi
          go jednym słowem, a wyjaśnienie jest jednym najazdem myszy dalej. */}
      {nieodebrana &&
        <span title="Klient nie zgłosił zwrotu — przesyłka wróciła nieodebrana."
          className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">
          nieodebrana paczka</span>}
    </h2>

    {/* ── PYTANIE KUBEŁKA ZESZŁO Z NAGŁÓWKA (0.214.0) ──────────────────────
        Stało tu „Przyjąć czy odrzucić?" — dokładnie nad przyciskami PRZYJMIJ
        i ODRZUĆ, które pytają o to samo i od razu na to odpowiadają. Decyzja
        właściciela; dekalog ergonomii, punkt 5: nie każ mówić dwa razy tego
        samego. Tak samo w pozostałych kubełkach — „Co z towarem?" stoi nad
        wierszem produktu z klawiszami oceny, „Ile oddać?" nad paskiem wyceny.

        Pytanie ZOSTAJE nad LISTĄ (`ekrany/Zwroty.tsx`) i w podpowiedzi
        zakładki: tam nazywa kubełek, w którym się stoi, i nic go nie
        powtarza. Zniknęła kopia, nie sama informacja. */}
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
      {/* Login jest jedyną daną osobową, którą polityka danych zwrotów
          dopuszcza wprost — imienia Allegro nie podaje wcale.

          STOI ZAWSZE (0.177.0). Do 0.176.0 znikał przy pustym polu, więc na
          ekranie nie było ani loginu, ani śladu po nim, a właściciel szukał go
          i nie znalazł. Puste pole ma powiedzieć, że to Allegro go nie podało,
          a nie zostawiać ekran milczący o kupującym. */}
      {/* Klik na SAMYM LOGINIE kopiuje (0.228.0) — osobna ikona obok była
          drugim celem dotyku dla tej samej czynności. */}
      {zwrot.kupujacyLogin
        ? <LoginKlienta login={zwrot.kupujacyLogin} className="font-semibold text-slate-700" />
        : <span className="text-slate-500">kupujący: Allegro nie podało</span>}
      {/* ODBIORCA I PROFIL (0.486.1) — zgłoszenie właściciela: „potrzebuję
          więcej informacji o kliencie w nagłówku". Login bywa ciągiem cyfr
          (`Client:105505227`), a nazwisko z adresu dostawy mówi, z kim
          rozmawiamy. Wchodzi przez mapowanie od 0.367.0 — nic nowego
          z adresu nie dochodzi. Profil (0.484.0) zbiera resztę: zakupy,
          zwroty, reklamacje — nagłówek nie powtarza go, tylko do niego prowadzi. */}
      {zwrot.odbiorcaNazwa && zwrot.odbiorcaNazwa !== zwrot.kupujacyLogin &&
        <span className="text-slate-600">{zwrot.odbiorcaNazwa}</span>}
      {zwrot.kupujacyLogin &&
        <RouterLink to={`/obsluga/klient/${encodeURIComponent(zwrot.kupujacyLogin)}`}
          title="Profil klienta — zakupy, zwroty, reklamacje i rozmowy"
          className="inline-flex items-center gap-1 text-xs text-sky-700 underline underline-offset-2">
          <UserRound size={12} aria-hidden="true" />profil</RouterLink>}
      {/* Historia kupującego jednym kliknięciem — powód w `sprawy/HistoriaKlienta.tsx`. */}
      {zwrot.kupujacyLogin && <PrzyciskHistorii rodzaj="zwrot" id={zwrot.id} tutaj="tym zwrotem" />}
    </p>

    {/* ── DRUGI ZWROT TEGO ZAMÓWIENIA (0.493.0) ─────────────────────────────
        Decyzja właściciela: klient z paczką nieodebraną zgłasza czasem potem
        odstąpienie w Allegro. Nagłówek mówi to przed kwotą i przyciskiem
        pieniędzy, a odnośnik otwiera drugi zwrot — decyzję, który z nich
        oddaje pieniądze, podejmuje się, patrząc na oba. */}
    {zwrot.drugiZwrot &&
      <p role="alert" className="mt-1 text-xs font-semibold text-ranga-zle">
        To zamówienie ma też {zwrot.drugiZwrot.zrodlo === "nieodebrana"
          ? "paczkę nieodebraną" : "zwrot zgłoszony w Allegro"}{" "}
        <RouterLink to={`/obsluga/zwroty/${zwrot.drugiZwrot.id}`}
          className="font-mono underline underline-offset-2">{zwrot.drugiZwrot.numer}</RouterLink>
        {" "}— pieniądze oddaje się raz.</p>}

    {zwrot.rozmowy.length > 0 && <RozmowaWNaglowku rozmowy={zwrot.rozmowy} />}

    {/* NOTATKA ZESZŁA STĄD W 0.313.0. Przy paczce nieodebranej cytowaliśmy ją
        tutaj, bo nie miała innego miejsca — od tego wydania ma własną sekcję
        w kolumnie dowodów, razem z autorem, godziną i cofnięciem. Zdanie
        powtórzone dwa razy na jednym ekranie każe je czytać dwa razy.
        Z tego samego powodu zeszło stąd zdanie o nieodebraniu (@wydanie) —
        stoi w podpowiedzi plakietki przy numerze. */}
  </header>;
}

/**
 * Najnowsza rozmowa o tym zakupie — w nagłówku, nie tylko w dowodach (0.486.1).
 *
 * Zgłoszenie właściciela: „szczególnie jeśli jest jakaś konwersacja
 * dotycząca tego zwrotu". Lista rozmów stała na dole kolumny dowodów, jako
 * sam temat i data — nie mówiła, czy klient czeka na nas ani co napisał.
 * A to jest pierwsze, co trzeba wiedzieć, zanim podejmie się decyzję
 * o zwrocie: klient bywa w tej samej sprawie w pół zdania.
 *
 * JEDNA ROZMOWA, NAJNOWSZA. Reszta zostaje w dowodach — od @wydanie jako
 * przystanki drogi w sekcji „Ten zakup u nas"; nagłówek mówi tylko, ile ich jest. „Czeka na odpowiedź" niesie niebieski, nie bursztyn —
 * to wezwanie do ruchu, a nie ostrzeżenie o błędzie.
 */
function RozmowaWNaglowku({ rozmowy }: { rozmowy: RozmowaZwrotu[] }) {
  const r = rozmowy[0]!;
  return <RouterLink to={`/obsluga/skrzynka/${r.id}`}
    className={`mt-2 block rounded-lg border px-3 py-2 text-sm hover:bg-white ${r.odKlienta
      ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <MessageSquare size={14} aria-hidden="true" className="shrink-0 text-slate-600" />
      <b className="text-slate-800">{r.temat?.trim() || "Rozmowa bez tematu"}</b>
      {r.odKlienta
        ? <span className="rounded bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-800">
            czeka na odpowiedź</span>
        : <span className="text-slate-600">odpisaliśmy</span>}
      <span className="ml-auto tabular-nums text-slate-600">{czas(r.ostatniaAt)}</span>
    </span>
    {r.ostatniaTresc && <p className="mt-1 line-clamp-2 text-slate-800">
      <span className="font-semibold text-slate-600">{r.odKlienta ? "Klient: " : "My: "}</span>
      „{r.ostatniaTresc}”</p>}
    {rozmowy.length > 1 && <span className="mt-1 block text-xs text-slate-600">
      i {ile(rozmowy.length - 1, "inna rozmowa", "inne rozmowy", "innych rozmów")} o tym zakupie — w „Ten zakup u nas”</span>}
  </RouterLink>;
}
