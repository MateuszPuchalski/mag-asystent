import { useState } from "react";
import { Barcode } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { beep } from "@/lib/feedback";
import { useLocations, useProduct, useSetLocation } from "@/lib/hooks";
import { go, setManualOpen, showUndo, toast, useUi } from "@/lib/store";
import { isKnownLoc, normalizeLoc, validateLoc } from "@/lib/locval";
import { dispatchScan, classify, useScanHandler } from "@/lib/scanner";
import { LocChoiceDrawer, type LocChoice } from "@/components/LocChoiceDrawer";
import type { RunResult } from "@/lib/offline";

const DEMO_LOCS = ["E08-03-01", "D01-02-02", "H04-05-02", "PALETA48"];
const IS_DEV = import.meta.env.DEV;

export function ScanLoc() {
  const curId = useUi((s) => s.curId);
  const manualOpen = useUi((s) => s.manualOpen);
  const [manual, setManual] = useState("");
  const [pending, setPending] = useState<string | null>(null); // kod do dialogu wielolokalizacji

  const { data: p } = useProduct(curId);
  const { data: locInfo } = useLocations();
  const setLoc = useSetLocation(curId ?? 0);

  useScanHandler((scan) => {
    if (scan.kind === "ean") return false; // EAN → fallback (karta innego towaru)
    handleCode(scan.code);
    return true;
  });

  if (!p) return null;

  const onErr = (e: unknown) => toast(e instanceof Error ? e.message : "Błąd zapisu");

  /** Auto-zapis + pasek COFNIJ (bez tapa potwierdzenia). */
  function save(choice: LocChoice, successMsg: string) {
    const warn = !isKnownLoc(choice.value, locInfo) ? "Lokalizacja spoza wykazu — sprawdź etykietę" : undefined;
    setLoc.mutate(choice, {
      onSuccess: (res: RunResult) => {
        beep(true);
        setPending(null);
        showUndo({
          msg: res.offline ? `Zapisano lokalnie · ${choice.value}` : `${successMsg} · ${choice.value}`,
          queueId: res.queueId,
          bufferId: res.bufferId,
          warn,
        });
        go("product");
      },
      onError: onErr,
    });
  }

  function handleCode(raw: string) {
    const code = normalizeLoc(raw);
    const err = validateLoc(code, locInfo);
    if (err) {
      toast(err);
      beep(false);
      return;
    }
    if (p!.locs.length > 1) {
      setPending(code); // realna decyzja — drawer zostaje
      return;
    }
    save({ action: "replace", value: code }, "Lokalizacja zapisana");
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* Tożsamość towaru — magazynier musi wiedzieć CO przenosi (analiza) */}
      <div className="rounded-lg border bg-card px-3 py-2.5">
        <div className="text-sm font-bold leading-snug text-pretty">{p.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <b className="font-cond text-[15px] tracking-wide text-ink">{p.sym}</b>
          <span>EAN {p.ean || "—"}</span>
          <span>{p.unit}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-mute">Teraz:</span>
          {p.locs.length === 0 ? (
            <span className="text-[13px] text-ink-mute">brak lokalizacji</span>
          ) : (
            p.locs.map((c, i) => (
              <span
                key={c}
                className={cn(
                  "rounded-full border-[1.5px] border-ink px-2.5 py-0.5 font-cond text-[13px] font-bold tracking-wide",
                  i === 0 ? "bg-ink text-white" : "bg-card text-ink"
                )}
              >
                {c}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="text-[13px] text-ink-soft">
        Podejdź do miejsca docelowego i zeskanuj jego etykietę — zapis nastąpi od razu (z opcją COFNIJ).
      </div>

      <div className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-amber bg-amber-bg-soft px-3 py-6">
        <Barcode className="h-7 w-[42px] text-ink" />
        <div className="font-cond text-base font-bold uppercase tracking-[0.08em]">Zeskanuj etykietę lokalizacji</div>
        <div className="anim-pulse text-[11px] text-ink-mute">czekam na skan…</div>
      </div>

      {IS_DEV && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
            Symulacja (DEV) — dotknij etykietę na regale
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_LOCS.map((c) => (
              <button
                key={c}
                onClick={() => dispatchScan(classify(c))}
                className="flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2.5 transition-colors hover:border-amber"
              >
                <Barcode className="h-3.5 w-6 text-ink-soft" />
                <div className="font-cond text-lg font-extrabold tracking-[0.08em]">{c}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {locInfo?.allowManual !== false &&
        (!manualOpen ? (
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
                onKeyDown={(e) => e.key === "Enter" && handleCode(manual)}
                placeholder="np. E08-03-01"
                className="uppercase"
              />
              <Button className="px-5 font-cond tracking-wide" onClick={() => handleCode(manual)}>OK</Button>
            </div>
            <div className="text-[11px] text-ink-mute">Bez spacji · ręczne wpisywanie = ryzyko literówek</div>
          </div>
        ))}

      <LocChoiceDrawer product={p} code={pending} onClose={() => setPending(null)} onPick={save} />
    </div>
  );
}
