import React from "react";
import { PackageX } from "lucide-react";
import type { Zwrot } from "../api/typy";
import { Przycisk } from "../ui";

/**
 * Uzasadnienie odmowy, gdy klient nie odesłał paczki (0.505.0). Jedno zdanie,
 * bo idzie do Allegro jako powód `REFUND_REJECTED` i do werdyktu u nas —
 * a klient przeczyta je w swoim zwrocie.
 */
export const POWOD_NIE_ODESLAL =
  "Kupujący nie odesłał towaru w terminie 14 dni od zgłoszenia odstąpienia.";

/**
 * Gotowa odmowa dla zwrotu, którego paczka nie wyszła od klienta (0.505.0).
 *
 * Zgłoszenie właściciela przy 5ZRQ/2026, decyzja „zrób obie": odmowa jednym
 * ruchem, z kodem i powodem wypełnionymi. `O` otwiera pole powodu, bo odmowa
 * jest nieodwracalna (§25a.5), a powód bywa za każdym razem inny. Tu fakt
 * jest jeden i sprawdzalny — czternaście dni bez numeru listu — więc pole
 * powodu dodawałoby klawisz bez decyzji.
 *
 * Stoi w miejscu przycisku „Wszystko OK", który przy takim zwrocie znika.
 */
export function NieOdeslany({ zwrot, trwa, blad, onOdmow }: {
  zwrot: Zwrot;
  trwa: boolean;
  blad: string;
  onOdmow: () => void;
}) {
  if (!zwrot.sygnaly.includes("nie_odeslany")) return null;
  return <div className="border-b border-red-200 bg-red-50 p-4">
    <p className="flex items-center gap-2 text-sm font-semibold text-ranga-zle">
      <PackageX size={16} aria-hidden="true" />
      Klient zgłosił zwrot, ale przez 14 dni nie nadał paczki — pieniądze się nie należą.</p>
    <Przycisk wariant="glowny" disabled={trwa} onClick={onOdmow} className="mt-2">
      <kbd className="rounded border border-black/20 px-1 text-xs">N</kbd>
      {trwa ? "Odmawiam…" : "Odrzuć i odmów wypłaty w Allegro"}
    </Przycisk>
    <p className="mt-1 text-xs text-slate-600">Powód dla klienta: „{POWOD_NIE_ODESLAL}"</p>
    {blad && <p role="alert" className="mt-1 text-xs text-red-700">{blad}</p>}
  </div>;
}
