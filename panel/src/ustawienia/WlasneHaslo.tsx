import React, { useEffect, useId, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { HASLO_MIN, useZmienSwojeHaslo } from "../api/ustawienia";
import { useJa } from "../api/rozmowy";
import { Blad, Pole, Przycisk, ile } from "../ui";
import { KartaWgladu } from "../ui/wglad";

/* ── Twoje hasło ───────────────────────────────────────────────────────────
   Hasło ustawione przez admina zna dwóch ludzi, a powinien jeden. Dlatego
   każdy zmienia swoje sam.

   DLA KAŻDEJ ROLI, KTÓRA WIDZI USTAWIENIA. To nie operacja admina: serwer
   bierze konto z sesji, więc tą drogą cudzego hasła nie zmieni.

   FORMULARZ ZA PRZYCISKIEM, jak dane firmy i kod kolektora. Trzy otwarte pola
   hasła przy każdym wejściu do grupy byłyby szumem dla kogoś, kto przyszedł
   do kont (dekalog pkt 2). Przeglądarka wpisywałaby też zapamiętane hasło
   w pole, którego nikt nie otworzył.

   NOWE HASŁO WPISUJE SIĘ DWA RAZY. Literówka w jedynym polu zamyka człowieka
   poza kontem, dopóki admin nie ustawi mu nowego hasła. Przycisk nie świeci,
   dopóki wiadomo, że żądanie skończy się odmową albo pomyłką. Zdanie obok
   mówi dlaczego, bo szarego przycisku nie da się przeczytać (pkt 6).

   Zdanie serwera idzie na ekran bez zmian. „Błędne hasło" mówi dokładnie,
   które pole poprawić, a odpowiedź 400 nie wylogowuje.

   Sesji serwer przy zmianie nie ucina. Opis karty mówi to przed zmianą, bo
   kto zmienia hasło po wycieku, liczy na wylogowanie innych urządzeń. */

/** Pierwsza przeszkoda w kolejności pól; `null` znaczy, że żądanie może przejść. */
export function przeszkodaHasla(stare: string, nowe: string, powtorzone: string): string | null {
  if (stare === "") return "Wpisz obecne hasło.";
  if (nowe === "") return `Wpisz nowe hasło, co najmniej ${HASLO_MIN} znaków.`;
  if (nowe.length < HASLO_MIN) {
    return `Nowe hasło ma ${ile(nowe.length, "znak", "znaki", "znaków")}, a potrzeba co najmniej ${HASLO_MIN}.`;
  }
  if (powtorzone === "") return "Powtórz nowe hasło w trzecim polu.";
  if (powtorzone !== nowe) return "Powtórzone hasło różni się od nowego. Wpisz je jeszcze raz.";
  return null;
}

function PoleHasla({ etykieta, autoComplete, wartosc, onZmiana, autoFocus = false }: {
  etykieta: string; autoComplete: "current-password" | "new-password";
  wartosc: string; onZmiana: (v: string) => void; autoFocus?: boolean;
}) {
  return <label className="flex flex-col gap-1 text-sm">
    <span className="font-semibold text-slate-700">{etykieta}</span>
    <Pole type="password" autoComplete={autoComplete} autoFocus={autoFocus}
      value={wartosc} onChange={(e) => onZmiana(e.target.value)} />
  </label>;
}

export function WlasneHaslo() {
  const zmiana = useZmienSwojeHaslo();
  const login = useJa().data?.user.login ?? null;
  const [otwarte, setOtwarte] = useState(false);
  const [stare, setStare] = useState("");
  const [nowe, setNowe] = useState("");
  const [powtorzone, setPowtorzone] = useState("");
  const [wynik, setWynik] = useState("");
  const idPodpowiedzi = useId();
  const przeszkoda = przeszkodaHasla(stare, nowe, powtorzone);

  /* Zamknięty formularz znika razem z fokusem. Fokus wraca na „Zmień hasło",
     inaczej klawiatura zaczynałaby od początku strony. */
  const ramka = useRef<HTMLDivElement>(null);
  const fokusWraca = useRef(false);
  useEffect(() => {
    if (otwarte || !fokusWraca.current) return;
    fokusWraca.current = false;
    ramka.current?.querySelector("button")?.focus();
  }, [otwarte]);

  /* Pola czyści każde zamknięcie: hasło nie czeka w pamięci strony na kogoś,
     kto usiądzie przy biurku po nas. */
  const zamknij = (co: string) => {
    setStare(""); setNowe(""); setPowtorzone("");
    setWynik(co);
    fokusWraca.current = true;
    setOtwarte(false);
  };

  return <KartaWgladu id="karta-haslo" tytul="Twoje hasło"
    opis="Zmieniasz je sam, bez administratora. Zmiana nie wylogowuje innych urządzeń.">
    {otwarte
      ? <form aria-label="Zmiana hasła" onSubmit={(e) => {
          e.preventDefault();
          if (przeszkoda !== null) return;
          zmiana.mutate({ stare, nowe }, { onSuccess: () => zamknij("Hasło zmienione.") });
        }}>
        {/* Login dla menedżera haseł: bez niego nowe hasło trafia do wpisu
            bez nazwy albo do pytania, które konto zaktualizować. */}
        {login && <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />}
        <div className="grid gap-3 sm:grid-cols-3">
          <PoleHasla etykieta="Obecne hasło" autoComplete="current-password" autoFocus
            wartosc={stare} onZmiana={setStare} />
          <PoleHasla etykieta="Nowe hasło" autoComplete="new-password" wartosc={nowe} onZmiana={setNowe} />
          <PoleHasla etykieta="Powtórz nowe hasło" autoComplete="new-password"
            wartosc={powtorzone} onZmiana={setPowtorzone} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Przycisk wariant="glowny" type="submit" disabled={przeszkoda !== null || zmiana.isPending}
            aria-describedby={przeszkoda !== null ? idPodpowiedzi : undefined}>Zmień hasło</Przycisk>
          <Przycisk type="button" onClick={() => { zmiana.reset(); zamknij(""); }}>Anuluj</Przycisk>
          {przeszkoda !== null && <p id={idPodpowiedzi} className="text-sm text-slate-600">{przeszkoda}</p>}
        </div>
        {zmiana.error && <div className="mt-3"><Blad>{zmiana.error.message}</Blad></div>}
      </form>
      : <div ref={ramka}>
        <Przycisk onClick={() => { setWynik(""); setOtwarte(true); }}><KeyRound size={16} />Zmień hasło</Przycisk>
      </div>}
    {/* Region `status` stoi stale, poza przełącznikiem. Czytnik ogłasza zmianę
        treści regionu, a nie region wstawiony razem z treścią. Fokus stoi
        wtedy na przycisku, więc wynik dociera tylko tą drogą. */}
    <p role="status" className="mt-2 text-sm text-ranga-ok empty:hidden">{wynik}</p>
  </KartaWgladu>;
}
