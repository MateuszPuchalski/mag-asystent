import { wczytajPlik } from "../zdjecia/obraz";
import { zakodujWLimicie } from "../zdjecia/obrobka";

/* ── ZDJĘCIE DO ZGŁOSZENIA ────────────────────────────────────────────────
   Zrzut ekranu z monitora 2560 px jako PNG waży kilka megabajtów, a serwer
   przyjmuje najwyżej 1024 kB na zdjęcie. Zmniejszamy więc w przeglądarce:
   dłuższy bok 1600 px i JPEG około 0,8, co daje zwykle 200–400 kB.

   Wczytanie i zmniejszenie bierze `wczytajPlik` z edytora zdjęć kartotek.
   Obraca też zdjęcie z telefonu według EXIF-u, a druga kopia tego rachunku
   rozjechałaby się z pierwszą przy pierwszej poprawce.

   Jakość schodzi niżej tylko wtedy, gdy 0,8 nie mieści się w limicie.
   Ostra fotografia regału bywa cięższa niż zrzut ekranu tej samej wielkości. */

const LIMIT = 1024 * 1024;
const JAKOSCI = [0.8, 0.7, 0.6, 0.5] as const;

/** Gotowe zdjęcie: adres `data:` do miniatury i do wysyłki naraz. */
export async function przygotujZdjecie(plik: Blob): Promise<string> {
  const { kanwa } = await wczytajPlik(plik);
  const w = await zakodujWLimicie((q) => {
    const adres = kanwa.toDataURL("image/jpeg", q);
    return adres.slice(adres.indexOf(",") + 1);
  }, LIMIT, JAKOSCI);
  if (!w.miesciSie) throw new Error("To zdjęcie jest za duże nawet po zmniejszeniu. Wybierz mniejsze albo wytnij fragment.");
  return `data:image/jpeg;base64,${w.base64}`;
}
