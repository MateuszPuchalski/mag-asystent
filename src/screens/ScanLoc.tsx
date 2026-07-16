import { useEffect, useRef, useState } from "react";
import { Barcode } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { beep } from "@/lib/feedback";
import { cur, scanLocation, setManualOpen, toast, useStore } from "@/lib/store";

const DEMO_LOCS = ["E08-03-01", "D01-02-02", "H04-05-02", "PALETA48"];

export function ScanLoc() {
  const p = useStore(cur);
  const mode = useStore((s) => s.mode);
  const manualOpen = useStore((s) => s.manualOpen);
  const [manual, setManual] = useState("");
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => hiddenRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, []);

  if (!p) return null;

  function submitLoc(raw: string) {
    const val = raw.trim().toUpperCase().replace(/^LOC:/, "");
    if (!val) return;
    if (/\s/.test(val)) {
      toast("Kod lokalizacji nie może zawierać spacji");
      beep(false);
      return;
    }
    scanLocation(val);
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* niewidoczne pole na realny skan klawiaturowy */}
      <input
        ref={hiddenRef}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            submitLoc(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
        className="pointer-events-none absolute left-[-999px] opacity-0"
      />

      <div className="text-[13px] text-ink-soft">
        {mode === "combo"
          ? `MM ${p.mgp} szt MGP→MAG + nowa lokalizacja — zeskanuj miejsce docelowe.`
          : "Podejdź do miejsca docelowego i zeskanuj jego etykietę."}
      </div>

      <div className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-amber bg-amber-bg-soft px-3 py-6">
        <Barcode className="h-7 w-[42px] text-ink" />
        <div className="font-cond text-base font-bold uppercase tracking-[0.08em]">
          Zeskanuj etykietę lokalizacji
        </div>
        <div className="anim-pulse text-[11px] text-ink-mute">czekam na skan…</div>
      </div>

      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
        Symulacja — dotknij etykietę na regale
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_LOCS.map((c) => (
          <button
            key={c}
            onClick={() => scanLocation(c)}
            className="flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2.5 transition-colors hover:border-amber"
          >
            <Barcode className="h-3.5 w-6 text-ink-soft" />
            <div className="font-cond text-lg font-extrabold tracking-[0.08em]">{c}</div>
          </button>
        ))}
      </div>

      {!manualOpen ? (
        <button
          onClick={() => setManualOpen(true)}
          className="p-1.5 text-center text-[13px] font-semibold text-amber-dark"
        >
          Wpisz lokalizację ręcznie…
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="anim-popIn flex gap-2">
            <Input
              autoFocus
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && submitLoc(manual)}
              placeholder="np. A-03-2"
              className="uppercase"
            />
            <Button className="px-5 font-cond tracking-wide" onClick={() => submitLoc(manual)}>
              OK
            </Button>
          </div>
          <div className="text-[11px] text-ink-mute">
            Bez spacji · ręczne wpisywanie = ryzyko literówek
          </div>
        </div>
      )}
    </div>
  );
}
