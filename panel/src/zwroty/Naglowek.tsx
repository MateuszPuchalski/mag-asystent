import { MessageSquare, UserRound } from "lucide-react";
import type { RozmowaZwrotu, Zwrot } from "../api/typy";
import { LoginKlienta, czas, ile } from "../ui";
import { PrzyciskHistorii } from "../sprawy/HistoriaKlienta";
import { Link as RouterLink } from "react-router-dom";
import { Link } from "./Link";

/* ── Nagłówek sprawy ─────────────────────────────────────────────────────────
   Osobno od `ekrany/Zwroty.tsx`, jak `Decyzje` i `Dowody`: nagłówek niesie własne
   reguły — nieodebrana paczka, brak numeru, brak loginu — a te da się
   sprawdzić testem dopiero wtedy, gdy stoją osobno od całego ekranu.

   TOŻSAMOŚĆ ZWROTU NALEŻY DO NAGŁÓWKA: numer i login stoją raz, przy
   nazwisku sprawy. To pierwsze, co się czyta, i jedyne, co się przepisuje. */

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

          ZDANIE O NIEODEBRANIU MIESZKA W PODPOWIEDZI. Plakietka mówi fakt
          jednym słowem, a wyjaśnienie jest jednym najazdem myszy dalej. */}
      {nieodebrana &&
        <span title="Klient nie zgłosił zwrotu — przesyłka wróciła nieodebrana."
          className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">
          nieodebrana paczka</span>}
    </h2>

    {/* ── BEZ PYTANIA KUBEŁKA W NAGŁÓWKU ───────────────────────────────────
        „Przyjąć czy odrzucić?" stałoby nad przyciskami PRZYJMIJ i ODRZUĆ,
        które pytają o to samo. Decyzja właściciela; dekalog ergonomii,
        punkt 5. Pytanie stoi nad LISTĄ (`ekrany/Zwroty.tsx`) i w podpowiedzi
        zakładki. */}
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
      {/* Login jest jedyną daną osobową, którą polityka danych zwrotów
          dopuszcza wprost — imienia Allegro nie podaje wcale.

          STOI ZAWSZE. Puste pole ma powiedzieć, że to Allegro go nie podało,
          a nie zostawiać ekran milczący o kupującym. */}
      {/* Klik na SAMYM LOGINIE kopiuje — osobna ikona obok była
          drugim celem dotyku dla tej samej czynności. */}
      {zwrot.kupujacyLogin
        ? <LoginKlienta login={zwrot.kupujacyLogin} className="font-semibold text-slate-700" />
        : <span className="text-slate-500">kupujący: Allegro nie podało</span>}
      {/* ODBIORCA I PROFIL — zgłoszenie właściciela: „potrzebuję
          więcej informacji o kliencie w nagłówku". Login bywa ciągiem cyfr
          (`Client:105505227`), a nazwisko z adresu dostawy mówi, z kim
          rozmawiamy. Wchodzi przez mapowanie — nic nowego z adresu nie
          dochodzi. Profil zbiera resztę: zakupy,
          zwroty, reklamacje — nagłówek nie powtarza go, tylko do niego prowadzi. */}
      {zwrot.odbiorcaNazwa && zwrot.odbiorcaNazwa !== zwrot.kupujacyLogin &&
        <span className="text-slate-600">{zwrot.odbiorcaNazwa}</span>}
      {zwrot.kupujacyLogin &&
        <RouterLink to={`/obsluga/klient/${encodeURIComponent(zwrot.kupujacyLogin)}`}
          title="Profil klienta — zakupy, zwroty, reklamacje i rozmowy"
          className="inline-flex items-center gap-1 text-xs text-sky-700 underline underline-offset-2">
          <UserRound size={12} aria-hidden="true" />profil</RouterLink>}
      {/* Historia kupującego jednym kliknięciem — powód w `sprawy/HistoriaKlienta.tsx`. */}
      {zwrot.kupujacyLogin && <PrzyciskHistorii rodzaj="zwrot" id={zwrot.id} />}
    </p>

    {/* ── DRUGI ZWROT TEGO ZAMÓWIENIA ───────────────────────────────────────
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

    {/* Notatka ma własną sekcję w kolumnie dowodów, a zdanie o nieodebraniu
        stoi w podpowiedzi plakietki. Zdanie powtórzone na jednym ekranie
        każe je czytać dwa razy. */}
  </header>;
}

/**
 * Najnowsza rozmowa o tym zakupie — w nagłówku, nie tylko w dowodach.
 *
 * Zgłoszenie właściciela: „szczególnie jeśli jest jakaś konwersacja
 * dotycząca tego zwrotu". Czy klient czeka na nas i co napisał, to pierwsze,
 * co trzeba wiedzieć, zanim podejmie się decyzję o zwrocie: klient bywa w tej samej sprawie w pół zdania.
 *
 * JEDNA ROZMOWA, NAJNOWSZA. Reszta stoi jako przystanki paska drogi klienta
 * pod nagłówkiem; nagłówek mówi tylko, ile ich
 * jest. „Czeka na odpowiedź" niesie niebieski, nie bursztyn — to wezwanie
 * do ruchu, a nie ostrzeżenie o błędzie.
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
      i {ile(rozmowy.length - 1, "inna rozmowa", "inne rozmowy", "innych rozmów")} o tym zakupie — na pasku drogi poniżej</span>}
  </RouterLink>;
}
