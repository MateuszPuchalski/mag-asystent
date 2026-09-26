import React, { useState } from "react";
import { Settings } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useJa } from "../api/rozmowy";
import { useTagi, useZmienTag } from "../api/tagi";
import { Karta } from "../ui";
import { useSkokDoKarty } from "../ui/useSkokDoKarty";
import { DaneFirmy } from "../ustawienia/DaneFirmy";
import { RegulyStrefy } from "../ustawienia/RegulyStrefy";
import { Konta } from "../ustawienia/Konta";
import { SlownikTagow } from "../ustawienia/SlownikTagow";
import { LogoDostawcow } from "../ustawienia/LogoDostawcow";
import { KluczeWlasciciela, Konfiguracja } from "../ustawienia/Konfiguracja";
import { Aktualizacja } from "../ustawienia/Aktualizacja";
import { NowyKolektor } from "../ustawienia/NowyKolektor";

/* ── USTAWIENIA (0.168.0, ustawienia biura od 0.444.0) ────────────────────
   Za zębatką, bo zmienia się tu rzadko — cel biura z §7: praca na górnym
   rzędzie, wgląd na dolnym, ustawienia za zębatką.

   PIĘĆ GRUP ZAMIAST JEDNEGO ZWOJU (@wydanie). Osiem kart stało jedna pod
   drugą, a trzydzieści pięć decyzji właściciela — termin zwrotu, sufit
   szkiców Copilota, magazyn odpadu — mieszkało na dnie, w karcie
   „Konfiguracja serwera", pod nazwą klucza w pliku. Szukało się ich tam,
   gdzie się o nich myśli: termin zwrotu przy zwrotach. Grupy układają
   ustawienia według tego, NA CO wpływają:

     Firma                — to, co wychodzi na papier do dostawcy
     Magazyn              — strefa złota, magazyny, dokumenty, zdjęcia
     Ludzie i urządzenia  — konta i nowy kolektor: ta sama chwila w firmie
     Obsługa klienta      — tagi, zwroty, Allegro, Copilot
     Serwer               — wersja, automat, kopie; na dnie klucze instalatora

   Kosztuje to jedno kliknięcie więcej niż zwój (dekalog pkt 2). Płaci się
   nim raz, a oszczędza szukanie klucza po nazwie z pliku przy każdej
   zmianie. Każda grupa mówi pod nazwą, co w niej jest, żeby wybór nie
   wymagał pamiętania (pkt 5).

   GRUPA W ADRESIE (`?grupa=`). Odświeżenie zostaje w tej samej grupie,
   a głęboki link `?karta=strefa` z Analizy otwiera grupę, w której ta
   karta stoi, i dopiero wtedy do niej skacze.

   Otwarcie ekranu i zmiana grupy nic nie zapisują — każda zmiana stoi za
   przyciskiem. */

type IdGrupy = "firma" | "magazyn" | "ludzie" | "obsluga" | "serwer";

const GRUPY: Array<{ id: IdGrupy; nazwa: string; opis: string; admin?: true }> = [
  { id: "firma", nazwa: "Firma", opis: "Protokoły i logo dostawców" },
  { id: "magazyn", nazwa: "Magazyn", opis: "Strefa złota, magazyny, dokumenty, zdjęcia" },
  { id: "ludzie", nazwa: "Ludzie i urządzenia", opis: "Konta, sesje, nowy kolektor" },
  { id: "obsluga", nazwa: "Obsługa klienta", opis: "Tagi, zwroty, Allegro, Copilot" },
  { id: "serwer", nazwa: "Serwer", opis: "Wersja, automat, kopie, zaawansowane", admin: true },
];

/** Karta z głębokiego linku → grupa, w której stoi. */
const GRUPA_KARTY: Record<string, IdGrupy> = {
  firma: "firma", logo: "firma", strefa: "magazyn", konta: "ludzie", kolektor: "ludzie",
  tagi: "obsluga", konfiguracja: "serwer", aktualizacja: "serwer",
};

export function Ustawienia() {
  const ja = useJa();
  const admin = ja.data?.user.role === "admin";
  const biuro = ja.data?.user.role === "biuro";
  const tagi = useTagi();
  const zmienTag = useZmienTag();
  const [bladTagu, setBladTagu] = useState("");
  const [adres, setAdres] = useSearchParams();
  /* Strefa złota w analizie prowadzi tu `?karta=strefa`. */
  const karta = useSkokDoKarty();

  const widoczne = GRUPY.filter((g) => !g.admin || admin);
  const zAdresu = adres.get("grupa") ?? (karta ? GRUPA_KARTY[karta] : undefined);
  const grupa: IdGrupy = widoczne.find((g) => g.id === zAdresu)?.id ?? "firma";

  /* Własny scroller — rama panelu nie przewija za ekrany (patrz `main.tsx`). */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <Settings size={18} /><b className="text-naglowek">Ustawienia</b>
    </Karta>

    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <nav aria-label="Grupy ustawień" className="flex flex-wrap gap-1 lg:sticky lg:top-0 lg:w-64 lg:shrink-0 lg:flex-col">
        {widoczne.map((g) => {
          const ta = g.id === grupa;
          return <button key={g.id} type="button" aria-current={ta ? "page" : undefined}
            onClick={() => setAdres({ grupa: g.id }, { replace: true })}
            className={`flex min-h-12 flex-col items-start rounded-lg border px-3 py-2 text-left ${
              ta ? "border-wertis-ink bg-white" : "border-transparent hover:bg-white"}`}>
            <span className="font-bold">{g.nazwa}</span>
            <span className="text-sm text-slate-600">{g.opis}</span>
          </button>;
        })}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        {grupa === "firma" && <>
          <DaneFirmy />
          {/* Pod danymi firmy, bo jego lista rośnie z każdym dostawcą. */}
          <LogoDostawcow />
        </>}
        {grupa === "magazyn" && <>
          <RegulyStrefy />
          <KluczeWlasciciela admin={admin} grupy={["magazyn", "zdjecia"]} />
        </>}
        {grupa === "ludzie" && <>
          <Konta admin={admin} biuro={biuro} />
          {/* Obok kont: nowa osoba i nowe urządzenie to ta sama chwila w firmie. */}
          <NowyKolektor biuro={admin || biuro} />
        </>}
        {grupa === "obsluga" && <>
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
          <KluczeWlasciciela admin={admin} grupy={["zwroty", "allegro", "copilot", "sfera"]} />
        </>}
        {grupa === "serwer" && <>
          <Aktualizacja admin={admin} />
          <KluczeWlasciciela admin={admin} grupy={["serwer"]} />
          {/* Na dnie: patrzy się tu przy awarii albo po wdrożeniu, nie co dzień. */}
          <Konfiguracja admin={admin} />
        </>}
      </div>
    </div>
  </div>;
}
