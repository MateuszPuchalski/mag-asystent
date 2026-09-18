import React from "react";
import { UserCheck } from "lucide-react";
import { Przycisk } from "../ui";

/* ── Kto prowadzi sprawę — pasek w ŚRODKOWEJ kolumnie (0.392.0) ──────────────
   Do 0.391.0 „Prowadzi" i przycisk „Prowadzę tę sprawę" stały w kolumnie
   DOWODÓW, pod tagami i notatką. Zgłoszenie właściciela ze zrzutem: „to można
   przenieść jakoś do środkowego okna".

   I ma rację, bo to nie jest dowód. Kolumna po prawej odpowiada na pytanie
   „co wiemy o tej sprawie" — same fakty do czytania. Wzięcie sprawy jest
   CZYNNOŚCIĄ i należy tam, gdzie stoją pozostałe: przy pasku werdyktu, nad
   rozmową. Przycisk pełnej szerokości w kolumnie faktów wyglądał przy tym na
   ważniejszy od nich wszystkich.

   JEDNA LINIA, nie karta. Znacznik, nie zamek: sprawę wolno wziąć i oddać,
   a ponowne kliknięcie zdejmuje — dokładnie jak było. Zmienia się miejsce
   i waga, nie zachowanie.

   SKRZYNKA UŻYWA TEGO SAMEGO PASKA (0.392.0, decyzja właściciela o ujednoliceniu),
   ale z `mocny`. Przejęcie rozmowy niczyjej jest tam DZIAŁANIEM GŁÓWNYM ekranu,
   a nie metadaną — rozstrzygnęło to 0.247.0 i ten plik tego nie odwraca.
   Wspólny jest kształt wiersza, nie waga przycisku: ta wynika z tego, ile
   kosztuje NIEZROBIENIE kliknięcia. W reklamacji sprawa i tak stoi w kolejce;
   w skrzynce nieprzejętą rozmowę piszą czasem dwie osoby naraz.             */

export function Prowadzi({ prowadzi, trwa, onProwadze, mocny = false, jaProwadze = false,
  etykietaWez = "Prowadzę tę sprawę", etykietaOddaj = "Odłóż sprawę", mozeOddac = true }: {
  /** Imię prowadzącego; `null` znaczy „nikt jeszcze nie wziął". */
  prowadzi: string | null;
  trwa: boolean;
  onProwadze: () => void;
  /** Przycisk w wadze głównej — patrz preambuła; używa tego skrzynka. */
  mocny?: boolean;
  /** „Ty" zamiast imienia, gdy prowadzi patrzący. */
  jaProwadze?: boolean;
  etykietaWez?: string;
  etykietaOddaj?: string;
  /**
   * Czy w ogóle da się ODDAĆ wziętą sprawę.
   *
   * Skrzynka mówi `false`, bo `przejmijRozmowe` przypisuje WYŁĄCZNIE rozmowę
   * niczyją (`assigned_user_id IS NULL`) — oddania tą drogą nie ma wcale.
   * Przycisk „oddaj" wołałby tam zapis, który odbija się konfliktem, czyli
   * obiecywałby czynność, której serwer nie przyjmie. Reklamacja i dyskusja
   * mają prawdziwy przełącznik i zostają przy domyślnym `true`.
   */
  mozeOddac?: boolean;
}) {
  return <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 text-sm">
    <UserCheck size={14} className="shrink-0 text-slate-400" />
    <span className="text-slate-500">Prowadzi</span>
    {/* Imię POGRUBIONE, „nikt" nie: pusta sprawa nie ma się dopominać uwagi
        mocniej niż wzięta. */}
    <span className={prowadzi
      ? (jaProwadze ? "font-semibold text-ranga-ok" : "font-semibold text-slate-900")
      : "text-slate-500"}>
      {prowadzi ? (jaProwadze ? "Ty" : prowadzi) : "nikt"}
    </span>
    {/* Przy sprawie wziętej przez KOGOŚ INNEGO przycisku nie ma: odebranie
        cudzej sprawy idzie osobną, opisaną drogą (przekazanie z powodem).
        Zdejmuje się WŁASNY znacznik albo bierze niczyją. */}
    {(!prowadzi || (jaProwadze && mozeOddac)) && (mocny
      ? <Przycisk wariant="glowny" className="ml-auto" disabled={trwa} onClick={onProwadze}>
          {prowadzi ? etykietaOddaj : etykietaWez}
        </Przycisk>
      : <Przycisk className="ml-auto !px-2 !py-1 !text-xs" disabled={trwa} onClick={onProwadze}>
          {prowadzi ? etykietaOddaj : etykietaWez}
        </Przycisk>)}
  </div>;
}
