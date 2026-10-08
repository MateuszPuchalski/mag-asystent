import { ExternalLink } from "lucide-react";
import type { Zamowienie } from "../api/typy";
import { dzienMiesiac } from "../ui";
import type { StanZakupu } from "./zakup";

/* ── PROŚBA O ANULOWANIE: ZAMÓWIENIE POD RĘKĄ ───────────────────────────────
   Decyzja właściciela z 8 października 2026: przy rozmowie rozpoznanej jako
   anulowanie odnośnik do zamówienia ma stać w rozmowie jako przycisk. Powód:
   opłacone zamówienie trzeba anulować i oddać pieniądze w Allegro, a agent
   ma tam trafić jednym kliknięciem, zanim paczka wyjdzie z magazynu.

   Obok przycisku stoi zdanie o płatności, bo to ono mówi, czy po anulowaniu
   trzeba oddać pieniądze. Płatność bierzemy z `stanZakupu`, tej samej reguły
   co kroki karty, żeby karta i to zdanie nie mogły się rozjechać.

   Przycisk jest drugorzędny (`btn-secondary`). Bursztyn należy do „Wyślij",
   a przycisk wyjścia do Allegro nie ma prawa z nim konkurować.

   ZERO ZAPISU. Przycisk prowadzi poza panel i niczego tu nie zmienia.      */

/** Zdanie o płatności i jego ton. Czysta funkcja, test stoi obok. */
export function zdaniePlatnosci(
  zam: Zamowienie | null, stan: StanZakupu | null,
): { tekst: string; ton: "zle" | "ok" | "nic" } {
  if (!zam || !stan) {
    return { tekst: "Treść zamówienia jeszcze nie pobrana. Płatność sprawdź w Allegro.", ton: "nic" };
  }
  if (stan.anulowane) return { tekst: "Zamówienie jest już anulowane w Allegro.", ton: "nic" };
  const krok = stan.kroki.find((k) => k.klucz === "oplacone");
  /* „Nieznane" przy płatności stawia `stanZakupu` wyłącznie pobraniu.
     Klient płaci przy odbiorze, więc o zwrocie mówi dopiero doręczenie. */
  if (krok?.stan === "nieznane") {
    const doreczone = stan.kroki.some((k) => k.klucz === "dostarczone" && k.stan === "tak");
    return doreczone
      ? { tekst: "Za pobraniem i już doręczone. Pobranie zapłacone, zwrot sprawdź w Allegro.", ton: "zle" }
      : { tekst: "Za pobraniem. Klient płaci przy odbiorze, więc przed doręczeniem nie ma czego oddawać.", ton: "ok" };
  }
  if (krok?.stan === "tak") {
    const kiedy = krok.at ? ` ${dzienMiesiac(krok.at)}` : "";
    return { tekst: `Opłacone${kiedy}. Po anulowaniu oddaj pieniądze w Allegro.`, ton: "zle" };
  }
  return { tekst: "Nieopłacone. Zwrot pieniędzy nie będzie potrzebny.", ton: "ok" };
}

const TON = { zle: "font-semibold text-ranga-zle", ok: "text-slate-700", nic: "text-slate-600" } as const;

export function Anulowanie({ link, zam, stan }: {
  link: string | null;
  zam: Zamowienie | null;
  stan: StanZakupu | null;
}) {
  const p = zdaniePlatnosci(zam, stan);
  return <div role="group" aria-label="Prośba o anulowanie"
    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2 text-xs">
    {link
      ? <a href={link} target="_blank" rel="noopener noreferrer" className="btn-secondary px-3 py-1.5 text-xs">
          Otwórz zamówienie do anulowania <ExternalLink size={12} aria-hidden="true" /></a>
      : <span className="text-slate-600">Odnośnika do zamówienia jeszcze nie ma.</span>}
    <span className={TON[p.ton]}>{p.tekst}</span>
  </div>;
}
