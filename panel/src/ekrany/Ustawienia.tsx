import React from "react";
import { Settings } from "lucide-react";
import { usePokrycieSygnatur, usePokrycieWiedzy, useZdrowie } from "../api/rozmowy";
import { useCopilot, usePomiarCopilota } from "../api/copilot";
import { Karta } from "../ui";
import { StanIntegracji } from "../skrzynka/StanIntegracji";
import { PokrycieSygnatur } from "../ustawienia/PokrycieSygnatur";
import { PokrycieWiedzy } from "../ustawienia/PokrycieWiedzy";
import { PomiarCopilota } from "../ustawienia/PomiarCopilota";

/* ── Ustawienia obsługi klienta (0.168.0) ────────────────────────────────────
   Decyzja właściciela: stan integracji schodzi ze Skrzynki za zębatkę.

   Skrzynka jest ekranem PRACY — kolejka rozmów i odpowiedź. Trzynastowierszowa
   tabela z `/api/health` opisuje TŁO tej pracy: agent czyta ją raz na tydzień,
   a pion pod kolejką zabierała na każdym otwarciu ekranu. To ten sam podział,
   który biuro ma od 0.76.0: praca na pasku, konfiguracja za zębatką.

   CO ZOSTAJE NA WIERZCHU — i to jest granica tej zmiany: pigułka
   synchronizacji w nagłówku, widoczna z każdej zakładki, oraz trwały alarm
   nad kolejką rozmów. Zasada 10 projektu brzmi „awaria integracji musi być
   widoczna", a §21 żąda trwałego alarmu. Za zębatkę schodzi TABELA, nie
   alarm: skrzynka stała już raz 62 przebiegi (0.152.0), bo powodu nie było
   gdzie zobaczyć, i drugi raz tego nie kupujemy.

   Ekran nie ma dziś nic poza tą kartą i to jest w porządku — USTAWIENIA
   w biurze zaczynały tak samo. Miejsce jest, więc następne ustawienie obsługi
   trafi tutaj, zamiast dokładać się do ekranu pracy. */
export function Ustawienia() {
  const zdrowie = useZdrowie();
  const sygnatury = usePokrycieSygnatur();
  const wiedza = usePokrycieWiedzy();
  /* Pomiar ciągniemy dopiero po wejściu na ten ekran — na skrzynce byłby
     zapytaniem po nic. Przy wyłączonym Copilocie nie ciągniemy go wcale:
     tabela zer nie mówi „wyłączony", tylko „nikt tego nie używa". */
  const copilot = useCopilot();
  const pomiar = usePomiarCopilota(copilot.data?.wlaczony === true);

  /* Własny scroller — rama panelu nie przewija za ekrany (patrz `main.tsx`). */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <Settings size={18} /><b className="mr-auto">Ustawienia</b>
      {/* Zdanie mówi wprost, że ten ekran niczego nie zmienia: reguła „zero
          zapisu przy patrzeniu" obowiązuje panel tak samo jak biuro. */}
      <span className="text-sm text-slate-500">Tło pracy obsługi · sam odczyt</span>
    </Karta>

    <StanIntegracji zdrowie={zdrowie.data} odczyt={zdrowie.dataUpdatedAt} />
    <PokrycieSygnatur dane={sygnatury.data} />
    <PokrycieWiedzy dane={wiedza.data} />
    <PomiarCopilota dane={pomiar.data} />
  </div>;
}
