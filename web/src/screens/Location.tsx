import { MapPin, PackageSearch } from "lucide-react";
import { Barcode } from "@/components/glyphs";
import { useLocationProducts, useLocations } from "@/lib/hooks";
import { openLocation, openProduct, toast, useUi } from "@/lib/store";
import { beep } from "@/lib/feedback";
import { validateLoc } from "@/lib/locval";
import { classify, dispatchScan, useScanHandler } from "@/lib/scanner";

const DEMO_LOCS = ["E08-03-01", "H04-05-02", "A05-01-01", "PALETA48"];
const IS_DEV = import.meta.env.DEV;

export function LocationView() {
  const code = useUi((s) => s.locCode);
  const { data: info } = useLocations();
  const { data: products, isFetching } = useLocationProducts(code || null);

  // Kolejna etykieta → przełącz podgląd; EAN → fallback otworzy kartę towaru.
  useScanHandler((scan) => {
    if (scan.kind !== "loc") return false;
    const err = validateLoc(scan.code, info);
    if (err) {
      toast(err);
      beep(false);
      return true;
    }
    beep(true);
    openLocation(scan.code);
    return true;
  });

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {!code ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-amber bg-amber-bg-soft px-3 py-6">
          <Barcode className="h-7 w-[42px] text-ink" />
          <div className="font-cond text-base font-bold uppercase tracking-[0.08em]">Zeskanuj etykietę regału</div>
          <div className="anim-pulse text-[11px] text-ink-mute">pokażę, co powinno tu leżeć</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
            <MapPin className="h-4 w-4 flex-none text-amber-ink" />
            <div className="font-cond text-lg font-extrabold tracking-[0.08em]">{code}</div>
            <div className="ml-auto text-xs text-ink-soft">
              {isFetching ? "…" : `${products?.length ?? 0} towar(ów)`}
            </div>
          </div>

          {products && products.length === 0 && !isFetching && (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center text-sm text-ink-mute">
              <PackageSearch className="h-7 w-7 text-ink-mute" />
              Slot pusty — żaden towar nie ma tej lokalizacji w kartotece
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {products?.map((x) => (
              <button
                key={x.id}
                onClick={() => openProduct(x.id, { sym: x.sym, loc: x.locs[0] || code })}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-amber hover:bg-amber-bg-soft"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-cond text-[15px] font-bold tracking-wide">{x.sym}</div>
                  <div className="truncate text-xs text-ink-soft">{x.name}</div>
                  {x.locs.length > 1 && (
                    <div className="mt-0.5 text-[11px] text-ink-mute">też: {x.locs.filter((l) => l !== code).join(", ")}</div>
                  )}
                </div>
                <div className="flex-none text-right text-xs font-semibold">
                  <div>MAG <b>{x.mag}</b></div>
                  <div className={x.mgp > 0 ? "text-amber-ink" : "text-ink-mute"}>MGP <b>{x.mgp}</b></div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 text-[11px] text-ink-mute">
            <Barcode className="h-3 w-5 text-ink-soft" />
            skan kolejnej etykiety = inne miejsce · skan towaru = jego karta
          </div>
        </>
      )}

      {IS_DEV && (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
            Symulacja (DEV) — dotknij lokalizację
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_LOCS.map((c) => (
              <button
                key={c}
                onClick={() => dispatchScan(classify(c))}
                className="flex items-center justify-center gap-1.5 rounded-lg border bg-card p-2 font-cond text-[15px] font-bold tracking-[0.06em] transition-colors hover:border-amber"
              >
                <Barcode className="h-3.5 w-6 text-ink-soft" /> {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
