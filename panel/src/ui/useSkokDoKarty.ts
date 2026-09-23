import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";

/* ── Skok do karty z adresu (0.441.0, wspólny od 0.444.0) ──────────────
   Adres niesie kartę (`?karta=…`), a ekran przewija do elementu
   `#karta-<nazwa>`. Stał w stanie systemu; ustawienia są drugim odbiorcą
   (strefa złota w analizie prowadzi do swoich reguł), a dwie kopie tej
   logiki rozjechałyby się przy pierwszej poprawce.

   Skok na wejściu i JESZCZE RAZ, gdy ucichną pierwsze odczyty. Kotwica
   istnieje od razu, ale karty nad nią rosną, kiedy dochodzą ich dane: skok
   po samym narysowaniu lądował w kolejce zapisów, a nie przy koncie Allegro.
   Przy pierwszym narysowaniu nic jeszcze nie jest „w toku" (zapytania
   startują po nim), więc sam licznik odczytów kłamie — dlatego koniec liczy
   się dopiero po tym, jak ruch był widać.

   Potem skoku już nie ma: odświeżenie co 30 s nie ma szarpać ekranem, który
   człowiek zdążył przewinąć gdzie indziej. */
export function useSkokDoKarty(): string | null {
  const [adres] = useSearchParams();
  const karta = adres.get("karta");
  const wToku = useIsFetching();
  const [ruch, setRuch] = useState(false);
  const [skoczono, setSkoczono] = useState<string | null>(null);
  useEffect(() => { if (wToku > 0) setRuch(true); }, [wToku]);
  useEffect(() => {
    if (!karta || skoczono === karta || wToku > 0) return;
    document.getElementById(`karta-${karta}`)?.scrollIntoView({ block: "start" });
    if (ruch) setSkoczono(karta);
  }, [karta, wToku, ruch, skoczono]);
  return karta;
}
