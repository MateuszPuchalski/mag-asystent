import React from "react";
import { Truck } from "lucide-react";
import type { ZamowienieRozmowy } from "../api/typy";
import { useSprawdzPrzesylkeRozmowy } from "../api/rozmowy";
import { Przycisk, Skopiuj, czas } from "../ui";
import { odchyleniePrzesylki } from "./kokpit";
import { ODNOSNIK } from "./odnosniki";
import { paczkaDoSprawdzenia } from "./soczewki-reguly";
import { STATUS_PACZKI } from "./statusy";

/**
 * Gdzie jest paczka zamówienia rozmowy. „Gdzie moja paczka" to najczęstsze
 * pytanie skrzynki, a agent szedł po odpowiedź do panelu Allegro.
 *
 * JEDEN BLOK, JEDNA REGUŁA. Ten sam stan paczki wyglądał w dwóch miejscach
 * inaczej: soczewka dawała pełny przycisk przy starym stanie, a karta
 * zamówienia zawsze ciche „sprawdź". Agent porównywał dwie linijki, które
 * mówiły to samo innymi słowami. Próg świeżości jest lustrem serwera
 * (`paczkaDoSprawdzenia`), więc panel i szkic pytają Allegro w tej samej chwili.
 *
 * SPRAWDZENIE TO KLIKNIĘCIE. Pytanie o paczkę to dwa żądania u Allegro,
 * a otwarcie rozmowy nie zapisuje niczego. Pełny przycisk staje, gdy stan
 * jest nieznany albo stary — wtedy to następny krok agenta. Przy świeżym
 * albo doręczonym stanie zostaje ciche „sprawdź", bo magazyn bywa szybszy niż
 * pół godziny, a paczka „doręczona" bywa sporna.
 *
 * Blok stoi w kolumnie dokładnie w jednym miejscu: w soczewce, w ramie
 * „Wymaga Ciebie" albo w wierszu „Zamówienie". Regułę wyboru trzyma
 * `paczkaWyzej` w `kokpit.ts`.
 */
export function Paczka({ zamowienie, rozmowaId }: { zamowienie: ZamowienieRozmowy; rozmowaId: number }) {
  const sprawdz = useSprawdzPrzesylkeRozmowy();
  const p = zamowienie.przesylka;
  /* Serwer odmawia sprawdzenia zamówienia, którego nie ma w bazie, więc
     przycisk dałby tylko błąd. Zdanie mówi, kiedy to się zmieni. */
  if (!p) {
    return <div role="group" aria-label="Paczka zamówienia" className="space-y-1.5 text-sm">
      <p className="text-slate-600">Zamówienia jeszcze nie pobraliśmy — paczkę sprawdzisz
        po najbliższej synchronizacji.</p>
    </div>;
  }
  const doSprawdzenia = paczkaDoSprawdzenia(p, Date.now());
  const pytaj = () => sprawdz.mutate({ id: rozmowaId });
  /* Metoda dostawy stoi przy stanie paczki, bo odpowiada na to samo pytanie:
     „kurier czy paczkomat" pada razem z „gdzie jest". */
  const stan = [zamowienie.pobrane?.dostawaMetoda, p.sprawdzonoAt && `stan z ${czas(p.sprawdzonoAt)}`]
    .filter(Boolean).join(" · ");
  /* Rola grupy, bo nazwy `div` bez roli czytnik ekranu nie ogłasza, a blok
     stoi w trzech miejscach kolumny i agent ma go rozpoznać w każdym. */
  return <div role="group" aria-label="Paczka zamówienia" className="space-y-1.5 text-sm">
    <p className={`font-semibold ${p.dostarczonoAt ? "text-ranga-ok"
      : odchyleniePrzesylki(p) ? "text-ranga-uwaga" : "text-slate-900"}`}>
      {p.sprawdzonoAt === null ? "Nie pytaliśmy jeszcze Allegro o tę paczkę."
        : p.waybill === null ? "Allegro nie ma numeru przesyłki — paczka nienadana albo nadana poza Allegro."
        : p.dostarczonoAt ? `Paczka doręczona ${czas(p.dostarczonoAt)}.`
        : p.status ? `Paczka: ${STATUS_PACZKI[p.status] ?? p.status}.`
        : "Paczka nadana, przewoźnik nie podał jeszcze statusu."}</p>
    {/* Numer przesyłki kopiuje się tym samym przyciskiem co numer zamówienia:
        agent wkleja go klientowi albo w okno przewoźnika, nie przepisuje. */}
    {p.waybill && <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-700">
      <Truck size={13} className="shrink-0 text-slate-500" aria-hidden />
      <span>{p.przewoznik ?? "przewoźnik nieznany"}</span>
      <span className="font-mono">{p.waybill}</span>
      <Skopiuj tekst={p.waybill} tytul="Kopiuj numer przesyłki" />
    </p>}
    {stan && <p className="text-xs text-slate-600">{stan}
      {!doSprawdzenia && p.sprawdzonoAt && <>{" · "}<button type="button" disabled={sprawdz.isPending}
        onClick={pytaj} className={ODNOSNIK}>{sprawdz.isPending ? "pytam…" : "sprawdź"}</button></>}</p>}
    {doSprawdzenia && <Przycisk className="text-xs" disabled={sprawdz.isPending} onClick={pytaj}>
      <Truck size={14} />{sprawdz.isPending ? "Pytam Allegro…"
        : p.sprawdzonoAt ? "Sprawdź ponownie" : "Sprawdź paczkę"}</Przycisk>}
    {sprawdz.error && <p className="text-xs text-ranga-zle">{(sprawdz.error as Error).message}</p>}
  </div>;
}
