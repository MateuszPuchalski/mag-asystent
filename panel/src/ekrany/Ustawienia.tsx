import React, { useState } from "react";
import { Settings } from "lucide-react";
import { useJa } from "../api/rozmowy";
import { useTagi, useZmienTag } from "../api/tagi";
import { Karta } from "../ui";
import { useSkokDoKarty } from "../ui/useSkokDoKarty";
import { DaneFirmy } from "../ustawienia/DaneFirmy";
import { RegulyStrefy } from "../ustawienia/RegulyStrefy";
import { Konta } from "../ustawienia/Konta";
import { SlownikTagow } from "../ustawienia/SlownikTagow";
import { LogoDostawcow } from "../ustawienia/LogoDostawcow";
import { Konfiguracja } from "../ustawienia/Konfiguracja";
import { Aktualizacja } from "../ustawienia/Aktualizacja";
import { NowyKolektor } from "../ustawienia/NowyKolektor";

/* ── USTAWIENIA (0.168.0, ustawienia biura od 0.444.0) ────────────────────
   Za zębatką, bo zmienia się tu rzadko — cel biura z §7: praca na górnym
   rzędzie, wgląd na dolnym, ustawienia za zębatką.

   0.444.0 WNIOSŁA TU USTAWIENIA Z `biuro.html` — ostatni widok, który tam
   mieszkał: dane firmy do protokołów, reguły strefy złotej, konta i sesje
   oraz logo dostawców. Odeszły stąd pomiary obsługi (do Analizy → Obsługa
   klienta): to wyniki, nie ustawienia, i na ekranie „rzadko zmieniane"
   zasłaniały sześcioma kartami te dwie rzeczy, które da się tu zmienić.
   Stan integracji odszedł wcześniej, w 0.441.0, do stanu systemu.

   KOLEJNOŚĆ Z MAKIETY: od tego, co wychodzi na papier do dostawcy, przez
   magazyn i ludzi, do słowników. Logo stoi na końcu, bo jego lista rośnie
   z każdym nowym dostawcą, a wszystko nad nią ma stałą wysokość.

   Otwarcie ekranu nic nie zapisuje — każda zmiana stoi za przyciskiem. */
export function Ustawienia() {
  const ja = useJa();
  const admin = ja.data?.user.role === "admin";
  const tagi = useTagi();
  const zmienTag = useZmienTag();
  const [bladTagu, setBladTagu] = useState("");
  /* Strefa złota w analizie prowadzi tu `?karta=strefa`. */
  useSkokDoKarty();

  /* Własny scroller — rama panelu nie przewija za ekrany (patrz `main.tsx`). */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    {/* Zdanie o tym, gdzie mieszkają pomiary i stan integracji, zeszło
        (@wydanie), bo mówiło o innych ekranach, nie o tym. Agent czytał je
        przy każdym wejściu, a pomagało raz — przy pierwszym szukaniu. */}
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <Settings size={18} /><b className="text-naglowek">Ustawienia</b>
    </Karta>

    <DaneFirmy />
    <RegulyStrefy />
    <Konta admin={admin} biuro={ja.data?.user.role === "biuro"} />
    {/* Obok kont: nowa osoba i nowe urządzenie to ta sama chwila w firmie. */}
    <NowyKolektor biuro={admin || ja.data?.user.role === "biuro"} />
    <SlownikTagow tagi={tagi.data?.tagi ?? []} trwa={zmienTag.isPending} blad={bladTagu}
      onNazwa={(tagId, nazwa) => {
        setBladTagu("");
        zmienTag.mutate({ tagId, nazwa },
          { onError: (e) => setBladTagu((e as Error).message) });
      }}
      onAktywny={(tagId, aktywny) => {
        setBladTagu("");
        zmienTag.mutate({ tagId, aktywny },
          { onError: (e) => setBladTagu((e as Error).message) });
      }} />
    <LogoDostawcow />
    {/* Na końcu: patrzy się tu przy awarii albo po wdrożeniu, nie co dzień.
        Biuro jej nie widzi wcale — patrz nagłówek karty. */}
    <Konfiguracja admin={admin} />
    {/* Pod konfiguracją: tam się patrzy, co serwer ma, tu — na czym chodzi. */}
    <Aktualizacja admin={admin} />
  </div>;
}
