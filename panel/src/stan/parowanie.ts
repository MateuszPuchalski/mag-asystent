import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/klient";

/* ── Parowanie konta Allegro — jedna pętla (z `biuro.html`, 0.441.0) ─────
   Trzy gwarancje przeniesione z biura, każda z własną blizną:

   1. JEDNA PĘTLA. Drugi klik nie startuje drugiej — dwie pętle to podwojony
      rytm żądań do allegro.pl, a endpoint parowania stoi na tym samym hoście
      co sklep i liczy go anti-bot (0.106.0).
   2. RYTM DYKTUJE SERWER (`nastepnyPollMs`): rośnie z czasem czekania, żeby
      zostawiona zakładka nie pytała co trzy sekundy przez godzinę.
   3. `brak` KOŃCZY PĘTLĘ. Sesja parowania żyje w pamięci procesu serwera;
      restart ją zjada. Do 0.113.0 `brak` kręcił się jak `czekam` i przycisk
      POŁĄCZ był martwy aż do przeładowania strony (0.114.0).

   PRZERWIJ nie wysyła żądania i nie musi: bez pytania z przeglądarki serwer
   do Allegro nic nie wysyła, a kod sam wygaśnie. */

export type FazaParowania =
  | { faza: "nic" }
  | { faza: "czeka"; userCode: string; link: string }
  | { faza: "koniec"; wynik: "brak" | "odmowa" | "wygaslo" | "blad"; tekst?: string };

export function useParowanie(poKoncu: () => void) {
  const [stan, setStan] = useState<FazaParowania>({ faza: "nic" });
  const trwa = useRef(false);
  const zegar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const koniec = useRef(poKoncu);
  koniec.current = poKoncu;

  const stop = useCallback(() => {
    trwa.current = false;
    if (zegar.current) clearTimeout(zegar.current);
    zegar.current = null;
  }, []);
  /* Wyjście z ekranu gasi pętlę — inaczej pytałaby dalej zza innej zakładki. */
  useEffect(() => stop, [stop]);

  const pytaj = useCallback(async () => {
    if (!trwa.current) return;
    try {
      const d = await api<{ stan: string; nastepnyPollMs?: number }>("/api/biuro/allegro/parowanie");
      if (!trwa.current) return;
      if (d.stan === "czekam") {
        zegar.current = setTimeout(pytaj, d.nastepnyPollMs ?? 5000);
        return;
      }
      stop();
      if (d.stan === "polaczone") setStan({ faza: "nic" });
      else setStan({ faza: "koniec", wynik: d.stan === "brak" || d.stan === "odmowa" ? d.stan : "wygaslo" });
      koniec.current();
    } catch (e) {
      stop();
      setStan({ faza: "koniec", wynik: "blad", tekst: (e as Error).message });
      koniec.current();
    }
  }, [stop]);

  const zacznij = useCallback(async () => {
    if (trwa.current) return;
    trwa.current = true;
    try {
      const d = await api<{ userCode: string; link: string }>("/api/biuro/allegro/parowanie", { method: "POST" });
      if (!trwa.current) return;
      setStan({ faza: "czeka", userCode: d.userCode, link: d.link });
      void pytaj();
    } catch (e) {
      stop();
      setStan({ faza: "koniec", wynik: "blad", tekst: (e as Error).message });
    }
  }, [pytaj, stop]);

  const przerwij = useCallback(() => { stop(); setStan({ faza: "nic" }); koniec.current(); }, [stop]);

  return { stan, zacznij, przerwij };
}
