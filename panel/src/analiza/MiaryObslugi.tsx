import React from "react";
import {
  useEskalacja, usePokrycieSygnatur, usePokrycieWiedzy, useSkutecznoscDoboru, useWiedzaAutomat,
} from "../api/rozmowy";
import { useCopilot, usePomiarCopilota } from "../api/copilot";
import { PokrycieSygnatur } from "../ustawienia/PokrycieSygnatur";
import { PokrycieWiedzy } from "../ustawienia/PokrycieWiedzy";
import { PomiarCopilota } from "../ustawienia/PomiarCopilota";
import { SkutecznoscDoboru } from "../ustawienia/SkutecznoscDoboru";
import { Eskalacja } from "../ustawienia/Eskalacja";
import { WiedzaAutomat } from "../ustawienia/WiedzaAutomat";

/* ── Miary obsługi (w analizie od 0.444.0) ─────────────────────────────
   Sześć kart stało za zębatką od 0.168.0, bo ekran ustawień był wtedy
   jedynym miejscem „tła pracy". To nie są ustawienia: niczego tu się nie
   zmienia, a na każdą z nich patrzy się jak na wynik. Makieta ustawień
   mówi to wprost — „pomiary obsługi przeszły do Analizy".

   Komponenty zostały w `ustawienia/`: przeniesienie plików nic nie
   zmienia w zachowaniu, a każda z tych kart ma własny test obok siebie.

   KOMPONENT MONTUJE SIĘ WYŁĄCZNIE W ZAKRESIE „OBSŁUGA KLIENTA", więc jego
   odczyty biegną tylko wtedy — ta sama zasada co dla pozostałych zakresów:
   nie pobiera się danych, na które nikt nie patrzy. */
export function MiaryObslugi({ dni }: { dni: number }) {
  const sygnatury = usePokrycieSygnatur();
  const wiedza = usePokrycieWiedzy();
  /* Przy wyłączonym Copilocie pomiaru nie ciągniemy wcale: tabela zer nie
     mówi „wyłączony", tylko „nikt tego nie używa". */
  const copilot = useCopilot();
  const pomiar = usePomiarCopilota(copilot.data?.wlaczony === true);
  /* Dobór liczy się z OKNA ZAKRESU — tego samego, które rządzi czasem
     odpowiedzi nad nim. Dwa selektory okna na jednym ekranie to dwie
     decyzje o tym samym (dekalog pkt 5). */
  const skutecznosc = useSkutecznoscDoboru(dni);
  const eskalacja = useEskalacja();
  const automat = useWiedzaAutomat();

  return <>
    <PokrycieSygnatur dane={sygnatury.data} />
    <PokrycieWiedzy dane={wiedza.data} />
    {/* Zaraz POD pokryciem wiedzy: tamta karta mówi, ile czeka w kolejce,
        ta — co z kolejki wyszło bez człowieka. Jedno czytanie, dwa stany. */}
    <WiedzaAutomat wpisy={automat.data} />
    <PomiarCopilota dane={pomiar.data} />
    <SkutecznoscDoboru dane={skutecznosc.data} dni={dni} />
    {/* Eskalacja POD skutecznością doboru: tamta mierzy naszą pracę, ta jej
        skutek u klienta. Razem odpowiadają na pytanie „czy to działa". */}
    <Eskalacja miesiace={eskalacja.data?.miesiace} />
  </>;
}
