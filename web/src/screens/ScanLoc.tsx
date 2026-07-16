import { useEffect, useRef, useState } from "react";
import { Barcode } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { beep } from "@/lib/feedback";
import { useMM, useProduct, useSetLocation } from "@/lib/hooks";
import { flashSuccess, go, setManualOpen, toast, useUi } from "@/lib/store";

const DEMO_LOCS = ["E08-03-01", "D01-02-02", "H04-05-02", "PALETA48"];

export function ScanLoc() {
  const curId = useUi((s) => s.curId);
  const mode = useUi((s) => s.mode);
  const manualOpen = useUi((s) => s.manualOpen);
  const [manual, setManual] = useState("");
  const [pending, setPending] = useState<string | null>(null); // kod do dialogu wielolokalizacji
  const [pickOne, setPickOne] = useState(false);
  const hiddenRef = useRef<HTMLInputElement>(null);

  const { data: p } = useProduct(curId);
  const setLoc = useSetLocation(curId ?? 0);
  const mm = useMM(curId ?? 0);

  useEffect(() => {
    const t = setTimeout(() => hiddenRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, []);

  if (!p) return null;

  const onErr = (e: unknown) => toast(e instanceof Error ? e.message : "Błąd zapisu");
  const done = (msg: string) => {
    flashSuccess(msg);
    setPending(null);
    setPickOne(false);
    go("product");
  };

  function handleCode(raw: string) {
    const code = raw.trim().toUpperCase().replace(/^LOC:/, "");
    if (!code) return;
    if (/\s/.test(code)) {
      toast("Kod lokalizacji nie może zawierać spacji");
      beep(false);
      return;
    }
    if (mode === "combo") {
      // zasilenie: MM całości MGP + ustawienie lokalizacji (spec §5.3)
      mm.mutate(
        { items: [{ twId: p!.id, qty: p!.mgp.effective }], targetLocation: code },
        { onSuccess: () => done("Zasilenie w kolejce"), onError: onErr }
      );
      return;
    }
    if (p!.locs.length > 1) {
      setPending(code);
      setPickOne(false);
      return;
    }
    setLoc.mutate({ action: "replace", value: code }, { onSuccess: () => done("Lokalizacja zapisana"), onError: onErr });
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      <input
        ref={hiddenRef}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            handleCode(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
        className="pointer-events-none absolute left-[-999px] opacity-0"
      />

      <div className="text-[13px] text-ink-soft">
        {mode === "combo"
          ? `MM ${p.mgp.effective} szt MGP→MAG + nowa lokalizacja — zeskanuj miejsce docelowe.`
          : "Podejdź do miejsca docelowego i zeskanuj jego etykietę."}
      </div>

      <div className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-amber bg-amber-bg-soft px-3 py-6">
        <Barcode className="h-7 w-[42px] text-ink" />
        <div className="font-cond text-base font-bold uppercase tracking-[0.08em]">Zeskanuj etykietę lokalizacji</div>
        <div className="anim-pulse text-[11px] text-ink-mute">czekam na skan…</div>
      </div>

      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
        Symulacja — dotknij etykietę na regale
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_LOCS.map((c) => (
          <button
            key={c}
            onClick={() => handleCode(c)}
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
              onKeyDown={(e) => e.key === "Enter" && handleCode(manual)}
              placeholder="np. A-03-2"
              className="uppercase"
            />
            <Button className="px-5 font-cond tracking-wide" onClick={() => handleCode(manual)}>OK</Button>
          </div>
          <div className="text-[11px] text-ink-mute">Bez spacji · ręczne wpisywanie = ryzyko literówek</div>
        </div>
      )}

      <Drawer open={!!pending} onOpenChange={(o) => !o && (setPending(null), setPickOne(false))}>
        <DrawerContent>
          {pending && (
            <>
              <DrawerTitle>
                Towar ma {p.locs.length} lokalizacje — co z <span className="text-amber-ink">{pending}</span>?
              </DrawerTitle>
              <Button
                size="tall"
                className="font-cond text-base font-extrabold tracking-wide"
                onClick={() => setLoc.mutate({ action: "replace", value: pending }, { onSuccess: () => done("Lokalizacja zapisana"), onError: onErr })}
              >
                ZASTĄP WSZYSTKIE
              </Button>
              <Button
                variant="outline"
                size="tall"
                className="font-cond text-[15px] tracking-wide"
                onClick={() => setLoc.mutate({ action: "add", value: pending }, { onSuccess: () => done("Lokalizacja dodana"), onError: onErr })}
              >
                DODAJ JAKO KOLEJNĄ
              </Button>
              {!pickOne ? (
                <Button variant="outline" size="tall" className="font-cond text-[15px] tracking-wide" onClick={() => setPickOne(true)}>
                  ZASTĄP JEDNĄ Z… ▾
                </Button>
              ) : (
                <div className="flex flex-wrap justify-center gap-1.5 py-0.5">
                  {p.locs.map((old) => (
                    <button
                      key={old}
                      onClick={() => setLoc.mutate({ action: "replace_one", value: pending, replaced: old }, { onSuccess: () => done("Lokalizacja zapisana"), onError: onErr })}
                      className="rounded-full border-[1.5px] border-ink bg-card px-3.5 py-2 font-cond text-[15px] font-bold transition-colors hover:bg-amber-bg"
                    >
                      {old} → {pending}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => (setPending(null), setPickOne(false))} className="p-1.5 text-center text-[13px] font-semibold text-ink-mute">
                Anuluj
              </button>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
