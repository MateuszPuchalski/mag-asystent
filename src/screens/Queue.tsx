import { useRef, useState } from "react";
import { MapPin, ArrowLeftRight, Zap, Check } from "lucide-react";
import { Cog } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { retryTask, useStore } from "@/lib/store";
import type { QueueTask } from "@/lib/types";

function TypeIcon({ type }: { type: QueueTask["type"] }) {
  if (type === "set_location") return <MapPin className="h-4 w-4 text-ink" />;
  if (type === "combo") return <Zap className="h-4 w-4 fill-amber text-ink" />;
  return <ArrowLeftRight className="h-4 w-4 text-ink" />;
}

export function Queue() {
  const queue = useStore((s) => s.queue);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [ticker, setTicker] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pullY = useRef<number | null>(null);

  const pend = queue.filter((t) => t.status === "pending" || t.status === "processing").length;
  const err = queue.filter((t) => t.status === "error").length;
  const done = queue.filter((t) => t.status === "done").length;

  function onDown(e: React.PointerEvent) {
    if (listRef.current && listRef.current.scrollTop <= 0) pullY.current = e.clientY;
  }
  function onMove(e: React.PointerEvent) {
    if (pullY.current == null || refreshing) return;
    const d = e.clientY - pullY.current;
    if (d > 4) listRef.current?.setPointerCapture(e.pointerId);
    setPull(Math.max(0, Math.min(96, d * 0.55)));
  }
  function onUp() {
    if (pullY.current == null) return;
    const past = pull > 64;
    pullY.current = null;
    if (past && !refreshing) {
      setRefreshing(true);
      setPull(44);
      setTimeout(() => {
        setRefreshing(false);
        setPull(0);
        setTicker((t) => t + 1); // wymuś odświeżenie widoku
      }, 1100);
    } else {
      setPull(0);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" key={ticker}>
      <div
        className={cn(
          "flex flex-none flex-col items-center justify-end overflow-hidden bg-secondary",
          pullY.current == null && "transition-[height] duration-200"
        )}
        style={{ height: (refreshing ? 44 : Math.round(pull)) + "px" }}
      >
        {refreshing ? (
          <div className="flex items-center gap-2 py-2.5 text-xs font-semibold text-ink-soft">
            <Cog className="h-[18px] w-[18px]" hole="#EDEBE4" /> Odświeżanie statusów…
          </div>
        ) : (
          <div className="flex flex-col items-center pb-1.5">
            <Cog className="h-6 w-6" hole="#EDEBE4" spinning={false} style={{ opacity: Math.min(1, pull / 40) }} />
            <div className="pt-1 text-[10px] text-ink-mute">
              {pull > 64 ? "puść — odśwież" : "pociągnij, aby odświeżyć"}
            </div>
          </div>
        )}
      </div>

      <div className="flex-none border-b bg-card px-3 py-2 text-xs font-semibold text-ink-soft">
        {pend} oczekujące · {err} błędów · {done} zrobione
      </div>

      <div
        ref={listRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="no-scrollbar flex flex-1 touch-pan-x flex-col gap-2 overflow-y-auto p-3"
      >
        {queue.map((t) => (
          <div
            key={t.id}
            className={cn("flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5", t.status === "error" && "border-destructive/30")}
          >
            <div className="mt-0.5 flex-none">
              <TypeIcon type={t.type} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold">{t.label}</div>
              <div className="text-xs text-ink-soft">{t.detail}</div>
              {t.status === "error" && (
                <div className="mt-0.5 text-[11px] text-destructive">{t.errMsg}</div>
              )}
            </div>
            <div className="flex flex-none flex-col items-end gap-1">
              <div className="text-[10px] text-ink-faint">{t.time}</div>
              {t.status === "pending" && (
                <div className="anim-pulse text-[11px] font-bold text-ink-mute">⏳ w kolejce</div>
              )}
              {t.status === "processing" && (
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-ink">
                  <Cog className="h-3.5 w-3.5" /> Sfera zapisuje
                </div>
              )}
              {t.status === "done" && <Check className="h-4 w-4 stroke-[3] text-success" />}
              {t.status === "error" && (
                <Button variant="destructive" size="sm" className="h-auto px-2.5 py-1 font-cond" onClick={() => retryTask(t.id)}>
                  PONÓW
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
