import { AlertTriangle } from "lucide-react";
import { Cog } from "@/components/glyphs";
import { cn } from "@/lib/utils";
import { useQueue } from "@/lib/hooks";
import { openQueue, useUi } from "@/lib/store";

/**
 * Pastylka statusu Sfery w prawym górnym rogu — jednocześnie wskaźnik stanu
 * kolejki i wejście do jej ekranu (zastępuje zakładkę „Kolejka"). Priorytet:
 * błąd (czerwona) > oczekujące (amber + licznik) > bezczynna (zielona).
 */
export function SferaStatus() {
  const { data } = useQueue();
  const onQueue = useUi((s) => s.screen === "queue");
  const s = data?.summary ?? { pending: 0, error: 0, done: 0 };

  const base =
    "flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold leading-none transition-colors select-none";

  let content: React.ReactNode;
  let tone: string;

  if (s.error > 0) {
    tone = "border-destructive/25 bg-destructive/10 text-destructive anim-pulse";
    content = (
      <>
        <AlertTriangle className="h-3.5 w-3.5" />
        {s.error} błąd{s.error > 1 ? "y" : ""}
      </>
    );
  } else if (s.pending > 0) {
    tone = "border-amber-line bg-amber-bg text-amber-ink";
    content = (
      <>
        <Cog className="h-3.5 w-3.5" hole="#FFF3D6" />
        {s.pending} w kolejce
      </>
    );
  } else {
    tone = "border-success/25 bg-success/10 text-success";
    content = (
      <>
        <span className="h-2 w-2 rounded-full bg-success" />
        Sfera
      </>
    );
  }

  return (
    <button
      onClick={openQueue}
      aria-label="Kolejka Sfery"
      className={cn(base, tone, onQueue && "ring-2 ring-ring ring-offset-1")}
    >
      {content}
    </button>
  );
}
