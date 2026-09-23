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
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <Settings size={18} /><b className="text-naglowek">Ustawienia</b>
      <span className="text-sm text-slate-500">Rzadko zmieniane, wspólne dla wszystkich biurek.
        Pomiary obsługi są w Analizie, stan integracji w Stanie systemu.</span>
    </Karta>

    <DaneFirmy />
    <RegulyStrefy />
    <Konta admin={admin} />
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
  </div>;
}
