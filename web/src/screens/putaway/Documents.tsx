import { PackageOpen, ChevronRight, Boxes, Undo2 } from "lucide-react";
import { Cog } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type PutawayDocument } from "@/lib/api";
import { usePutawayDocuments, useInvalidate } from "@/lib/hooks";
import { openSession, toast } from "@/lib/store";

export function PutawayDocuments() {
  const { data: docs = [], isLoading } = usePutawayDocuments();
  const inv = useInvalidate();

  async function open(docId?: number, mode?: "all_mgp") {
    try {
      const { sessionId } = await api.createSession(docId ? { docId } : { mode });
      inv.docs();
      openSession(sessionId);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Nie udało się otworzyć sesji");
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2.5 text-sm font-semibold text-ink-mute">
        <Cog className="h-[18px] w-[18px]" hole="#F6F5F2" /> Wczytywanie dokumentów…
      </div>
    );
  }

  const deliveries = docs.filter((d: PutawayDocument) => d.zone !== "zwroty");
  const returns = docs.filter((d: PutawayDocument) => d.zone === "zwroty");

  const DocRow = ({ d }: { d: PutawayDocument }) => (
    <button
      key={d.docId}
      onClick={() => open(d.docId)}
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:border-amber hover:bg-amber-bg-soft"
    >
      <div className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-secondary">
        {d.zone === "zwroty" ? (
          <Undo2 className="h-5 w-5 text-amber-ink" />
        ) : (
          <PackageOpen className="h-5 w-5 text-ink" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-cond text-[15px] font-bold tracking-wide">{d.nrPelny}</span>
          {d.session && (
            <Badge variant={d.session.progressPct === 100 ? "success" : "amber"}>
              {d.session.progressPct}%
            </Badge>
          )}
          {d.onMag && d.session?.progressPct !== 100 && (
            <Badge variant="amber">na MAG · do zlokalizowania</Badge>
          )}
        </div>
        <div className="truncate text-xs text-ink-soft">{d.dostawca}</div>
        <div className="text-[11px] text-ink-mute">
          {d.dataWyst} · {d.positions} poz.
        </div>
      </div>
      <ChevronRight className="h-5 w-5 flex-none text-ink-mute" />
    </button>
  );

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {returns.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-ink">
            Zwroty od klientów · kartony do rozłożenia
          </div>
          {returns.map((d: PutawayDocument) => (
            <DocRow key={d.docId} d={d} />
          ))}
        </>
      )}

      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
        Dostawy FZ/PZ na MGP · ostatnie 14 dni
      </div>

      {deliveries.map((d: PutawayDocument) => (
        <DocRow key={d.docId} d={d} />
      ))}

      <Button
        variant="outline"
        size="tall"
        className="mt-1 font-cond text-[15px] tracking-wide"
        onClick={() => open(undefined, "all_mgp")}
      >
        <Boxes className="h-4 w-4" /> ROZKŁADAJ CAŁE MGP
      </Button>
      <div className="text-center text-[11px] text-ink-mute">
        Tryb zapasowy — wszystkie towary ze stanem na strefie przyjęć, bez dokumentu.
      </div>
    </div>
  );
}
