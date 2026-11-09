import React from "react";
import { useEskalacja, usePokrycieSygnatur } from "../api/rozmowy";
import { useCopilot, usePomiarCopilota } from "../api/copilot";
import { PokrycieSygnatur } from "../ustawienia/PokrycieSygnatur";
import { PomiarCopilota } from "../ustawienia/PomiarCopilota";
import { Eskalacja } from "../ustawienia/Eskalacja";

/* ── Miary obsługi ─────────────────────────────────────────────────────
   To nie są ustawienia: niczego tu się nie zmienia, a na każdą z nich
   patrzy się jak na wynik — dlatego stoją w Analizie.

   Komponenty mieszkają w `ustawienia/`, a każda z tych kart ma własny test
   obok siebie.

   KOMPONENT MONTUJE SIĘ WYŁĄCZNIE W ZAKRESIE „OBSŁUGA KLIENTA", więc jego
   odczyty biegną tylko wtedy — ta sama zasada co dla pozostałych zakresów:
   nie pobiera się danych, na które nikt nie patrzy. */
export function MiaryObslugi() {
  const sygnatury = usePokrycieSygnatur();
  /* Przy wyłączonym Copilocie pomiaru nie ciągniemy wcale: tabela zer nie
     mówi „wyłączony", tylko „nikt tego nie używa". */
  const copilot = useCopilot();
  const pomiar = usePomiarCopilota(copilot.data?.wlaczony === true);
  const eskalacja = useEskalacja();

  return <>
    <PokrycieSygnatur dane={sygnatury.data} />
    <PomiarCopilota dane={pomiar.data} />
    {/* Eskalacja POD pomiarem Copilota: tamten mierzy naszą pracę, ta jej
        skutek u klienta. Razem odpowiadają na pytanie „czy to działa". */}
    <Eskalacja miesiace={eskalacja.data?.miesiace} />
  </>;
}
