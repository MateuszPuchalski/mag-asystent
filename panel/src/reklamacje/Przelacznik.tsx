import type { KubelekReklamacji } from "../api/typy";
import { FiltrSegmentowy } from "../ui";
import { KUBELKI } from "./Kolejka";

/* ── Pozostałe kubełki: wąski rząd pod kaflami ───────────────────────────────
   Kafle 2×2 niosą pracę: do decyzji, do odpowiedzi i po terminie. Tu stoją
   widoki, które pracą nie są: Bez ruchu, Rozstrzygnięte i Wszystkie. Dlatego
   drobne pigułki, nie kafle — ręka po nie sięga rzadko.

   PIGUŁKA JEST TA SAMA CO W SICIE (`FiltrSegmentowy`). Jeden kształt wyboru
   w panelu, więc oko nie uczy się drugiego.

   BRAK LICZBY TO KRESKA, NIE ZERO. Przy awarii serwera pigułka mówi „—”, bo
   „0” agent czyta jako „nic nie czeka” (`panel/CLAUDE.md`). */

/** Widoki w rzędzie, w kolejności czytania; `null` to „Wszystkie”. */
const POZOSTALE: Array<KubelekReklamacji | null> = ["bez_ruchu", "zamknieta", null];

/** Klawisz skrótu liczy się z `KUBELKI`, jak w nasłuchu ekranu. */
const klawisz = (k: KubelekReklamacji | null) =>
  k === null ? KUBELKI.length + 1 : KUBELKI.findIndex((x) => x.id === k) + 1;

/** `FiltrSegmentowy` chce klucza-napisu, a „Wszystkie” to brak kubełka. */
const WSZYSTKIE = "wszystkie";

export function PozostaleKubelki({ wybrany, liczniki, wszystkich, onWybierz }: {
  wybrany: KubelekReklamacji | null;
  /** `undefined` = nie wiemy; wtedy każda pigułka mówi „—”. */
  liczniki?: Partial<Record<KubelekReklamacji, number>>;
  wszystkich?: number;
  onWybierz: (k: KubelekReklamacji | null) => void;
}) {
  const pozycje = POZOSTALE.map((k) => {
    const opis = k === null ? null : KUBELKI.find((x) => x.id === k)!;
    const n = k === null ? wszystkich : liczniki?.[k];
    return {
      klucz: k ?? WSZYSTKIE,
      etykieta: opis?.etykieta ?? "Wszystkie",
      ile: n === undefined ? "—" as const : n,
      podpowiedz: `${opis?.pytanie ?? "Każda sprawa z kolejki."} (klawisz ${klawisz(k)})`,
    };
  });
  return <div role="group" aria-label="Pozostałe kubełki" className="flex flex-wrap gap-1.5">
    <FiltrSegmentowy<string> wybrany={wybrany ?? WSZYSTKIE} pozycje={pozycje}
      onWybierz={(k) => onWybierz(k === WSZYSTKIE ? null : k as KubelekReklamacji)} />
  </div>;
}
