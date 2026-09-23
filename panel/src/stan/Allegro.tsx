import React from "react";
import { Link2, Unlink } from "lucide-react";
import { useRozlaczAllegro, useStanAllegro } from "../api/stan";
import { Blad, Przycisk, czas } from "../ui";
import { KartaWgladu } from "../ui/wglad";
import { Potwierdz } from "./Potwierdz";
import { useParowanie } from "./parowanie";

/* ── Konto Allegro (z `biuro.html`, 0.441.0) ────────────────────────────
   Stan połączenia widzi biuro; parowanie i rozłączenie wykonuje admin —
   serwer odmawia pozostałym, a karta nie pokazuje przycisku, który na pewno
   skończy się odmową.

   Biuro trzymało tę kartę ZWINIĘTĄ i otwierało ją samo, gdy konto się
   rozłączyło. Tu karta jest zawsze otwarta i ma trzy linijki: zwijanie
   oszczędzało miejsce na ekranie, na którym stało dziesięć kart, a jego
   pamięć w przeglądarce była osobną rzeczą do utrzymania. */

export function KartaAllegro({ admin }: { admin: boolean }) {
  const stan = useStanAllegro();
  const rozlacz = useRozlaczAllegro();
  const { stan: parowanie, zacznij, przerwij } = useParowanie(() => void stan.refetch());
  const s = stan.data;

  let tresc: React.ReactNode = null;
  if (parowanie.faza === "czeka") {
    tresc = <div className="space-y-2 text-sm">
      <p>Na SWOIM zalogowanym koncie Allegro otwórz{" "}
        <a href={parowanie.link} target="_blank" rel="noopener noreferrer" className="font-semibold underline">link potwierdzenia</a>
        {" "}i przepisz kod:</p>
      <p className="text-tytul font-bold tracking-[0.2em]">{parowanie.userCode}</p>
      {/* Zdanie o blokadzie przeszło z biura znak w znak (0.106.0): endpoint
          parowania stoi na hoście sklepu i liczy go anti-bot. */}
      <p className="text-slate-600">
        Gdy Allegro pokaże stronę blokady, nie klikaj w kółko. Kliknij Przerwij, odczekaj kilkanaście minut
        i otwórz link z innej sieci — najprościej z telefonu po danych komórkowych. Nie otwieraj go przez
        pulpit zdalny na serwerze: wychodzi wtedy adres, który Allegro właśnie zablokowało.</p>
      <div className="flex items-center gap-3">
        <span className="text-slate-600">Czekam na potwierdzenie w Allegro…</span>
        <Przycisk onClick={przerwij}>Przerwij</Przycisk>
      </div>
    </div>;
  } else if (s) {
    const bladParowania = parowanie.faza === "koniec" && <p className="mb-2 text-sm">
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
        {parowanie.wynik === "brak" ? "sesja parowania przepadła"
          : parowanie.wynik === "odmowa" ? "odmowa w Allegro"
            : parowanie.wynik === "wygaslo" ? "kod wygasł" : "parowanie przerwane"}</span>{" "}
      {parowanie.wynik === "brak"
        ? "Najpewniej restart serwera w trakcie — zacznij od nowa."
        : parowanie.tekst ?? "Spróbuj ponownie."}</p>;
    const polacz = admin
      ? <Przycisk wariant="glowny" onClick={() => void zacznij()}><Link2 size={16} />Połącz z Allegro</Przycisk>
      : <span className="text-sm text-slate-600">Parowanie wykonuje administrator.</span>;
    if (s.stan === "dev") {
      tresc = <p className="text-sm">Tryb <b>demo</b> — bez kontaktu z Allegro. Parowanie działa wyłącznie przy pracy na danych Subiekta.</p>;
    } else if (s.stan === "wylaczone") {
      tresc = <p className="text-sm">Funkcja wyłączona — ustaw <b>ALLEGRO_CLIENT_ID</b> i <b>ALLEGRO_CLIENT_SECRET</b> w wertis.env.</p>;
    } else if (s.stan === "polaczone") {
      tresc = <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">połączone</span>
        <span>środowisko <b>{s.srodowisko}</b>{s.wygasa && <> · token ważny do {czas(s.wygasa)} (odświeża się sam)</>}</span>
        {admin && <Potwierdz etykieta={<><Unlink size={16} />Rozłącz</>} pytanie="Odczyt z Allegro przestanie działać."
          tak="Rozłącz konto" trwa={rozlacz.isPending} onTak={() => rozlacz.mutate()} />}
      </div>;
    } else {
      tresc = <div className="space-y-3 text-sm">
        {bladParowania}
        <p><span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
          {s.stan === "zle_srodowisko" ? "token z innego środowiska" : "niepołączone"}</span>{" "}
          {s.stan === "zle_srodowisko" ? "Zmieniono ALLEGRO_SANDBOX — sparuj ponownie." : "Odczyt z Allegro nie zadziała bez konta."}
          {" "}Środowisko <b>{s.srodowisko}</b>.</p>
        {polacz}
      </div>;
    }
  }

  return <KartaWgladu id="karta-allegro" tytul="Konto Allegro">
    {tresc}
    <Blad>{stan.error?.message || rozlacz.error?.message}</Blad>
  </KartaWgladu>;
}
