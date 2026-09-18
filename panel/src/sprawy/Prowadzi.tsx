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

   ── SKRZYNKA BIERZE SAM ZNACZNIK (0.395.0) ──────────────────────────────────
   0.392.0 dało skrzynce ten sam pasek z przyciskiem „PRZEJMIJ ROZMOWĘ"
   w wadze głównej. Zgłoszenie właściciela ze zrzutem zdjęło ten przycisk:
   wysyłka odpowiedzi przypisuje rozmowę niczyją SAMA od 0.159.0, więc guzik
   prosił o kliknięcie, które i tak padało minutę później.

   Razem z nim zeszły `mocny`, `etykietaWez`, `etykietaOddaj` i `mozeOddac` —
   cztery przełączniki, które istniały wyłącznie dla tamtego jednego wołania.
   Reklamacja i dyskusja nigdy żadnego z nich nie podały. Przełącznik bez
   wołającego to nie jest zapas na przyszłość, tylko kod, którego nikt nie
   sprawdza; wracając po niego, wróć razem z ekranem, który go potrzebuje.   */

export function Prowadzi({ prowadzi, trwa, onProwadze, jaProwadze = false,
  wWierszu = false, gdyNikt = "nikt" }: {
  /** Imię prowadzącego; `null` znaczy „nikt jeszcze nie wziął". */
  prowadzi: string | null;
  trwa: boolean;
  /**
   * Procedura wzięcia i oddania sprawy; BRAK znaczy „sam znacznik".
   *
   * Ta sama reguła, co przy innych procedurach opcjonalnych w tym panelu:
   * czego nie da się zrobić, tego nie ma na ekranie. Przycisk bez procedury
   * byłby martwy, a martwy przycisk uczy, że klikanie tu nic nie daje.
   */
  onProwadze?: () => void;
  /** „Ty" zamiast imienia, gdy prowadzi patrzący. */
  jaProwadze?: boolean;
  /**
   * Znacznik W WIERSZU z czymś innym, a nie własnym pasmem (0.395.0).
   *
   * Skrzynka po zdjęciu przycisku miała na te dwa słowa całą linię nagłówka,
   * a linia w tej kolumnie spycha pytanie klienta niżej — po nie agent tu
   * przyszedł. Ta sama zasada wypchnęła stamtąd bloki kontekstu w 0.180.0.
   */
  wWierszu?: boolean;
  /**
   * Czym zastąpić słowo „nikt".
   *
   * Skrzynka mówi tu, co stanie się SAMO, bo właśnie zniknął stamtąd przycisk
   * i bez zdania agent nie ma skąd wiedzieć, kiedy rozmowa stanie się jego.
   */
  gdyNikt?: string;
}) {
  return <div className={`${wWierszu ? "" : "mb-2 "}flex shrink-0 flex-wrap items-center gap-2 text-sm`}>
    <UserCheck size={14} className="shrink-0 text-slate-400" />
    <span className="text-slate-500">Prowadzi</span>
    {/* Imię POGRUBIONE, „nikt" nie: pusta sprawa nie ma się dopominać uwagi
        mocniej niż wzięta. */}
    <span className={prowadzi
      ? (jaProwadze ? "font-semibold text-ranga-ok" : "font-semibold text-slate-900")
      : "text-slate-500"}>
      {prowadzi ? (jaProwadze ? "Ty" : prowadzi) : gdyNikt}
    </span>
    {/* Przy sprawie wziętej przez KOGOŚ INNEGO przycisku nie ma: odebranie
        cudzej sprawy idzie osobną, opisaną drogą (przekazanie z powodem).
        Zdejmuje się WŁASNY znacznik albo bierze niczyją. */}
    {onProwadze && (!prowadzi || jaProwadze) &&
      <Przycisk className="ml-auto !px-2 !py-1 !text-xs" disabled={trwa} onClick={onProwadze}>
        {prowadzi ? "Odłóż sprawę" : "Prowadzę tę sprawę"}
      </Przycisk>}
  </div>;
}
