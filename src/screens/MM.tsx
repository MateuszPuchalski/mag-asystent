import { Minus, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createMM, cur, setQty, useStore } from "@/lib/store";

export function MM() {
  const p = useStore(cur);
  const qty = useStore((s) => s.qty);
  if (!p) return null;

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3.5 overflow-y-auto p-3">
      <div className="rounded-lg border bg-card px-3 py-2.5">
        <div className="font-cond text-[15px] font-bold">{p.sym}</div>
        <div className="truncate text-xs text-ink-soft">{p.name}</div>
      </div>

      <div className="flex items-center justify-center gap-2.5 font-cond text-[15px] font-bold tracking-[0.08em]">
        <span className="rounded-md bg-amber-bg px-2.5 py-1">MGP</span>
        <ArrowRight className="h-4 w-4" />
        <span className="rounded-md bg-secondary px-2.5 py-1">MAG</span>
      </div>

      <div className="flex items-center justify-center gap-3.5">
        <Button variant="outline" className="h-[52px] w-[52px] rounded-xl text-2xl" onClick={() => setQty(qty - 1)}>
          <Minus className="h-6 w-6" />
        </Button>
        <div className="min-w-[90px] text-center">
          <div className="font-cond text-[46px] font-extrabold leading-none">{qty}</div>
          <div className="text-[11px] text-ink-mute">z {p.mgp} szt na MGP</div>
        </div>
        <Button variant="outline" className="h-[52px] w-[52px] rounded-xl text-2xl" onClick={() => setQty(qty + 1)}>
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      <Button
        variant="outline"
        className="border-amber py-3 font-cond text-[15px] tracking-wide text-amber-ink hover:bg-amber-bg-soft"
        onClick={() => setQty(p.mgp)}
      >
        CAŁA ILOŚĆ — {p.mgp} SZT
      </Button>

      <Button size="tall" className="mt-auto py-4 font-cond text-[17px] font-extrabold tracking-wide" onClick={() => createMM(qty)}>
        UTWÓRZ MM ({qty} SZT)
      </Button>
      <div className="-mt-1.5 text-center text-[11px] text-ink-mute">
        Dokument MM utworzy worker Sfery — numer pojawi się w kolejce
      </div>
    </div>
  );
}
