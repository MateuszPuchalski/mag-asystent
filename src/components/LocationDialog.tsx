import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import {
  cancelDialog,
  cur,
  dialogRoute,
  openPickOne,
  useStore,
} from "@/lib/store";

export function LocationDialog() {
  const pendingLoc = useStore((s) => s.pendingLoc);
  const pickOne = useStore((s) => s.pickOne);
  const p = useStore(cur);

  const open = !!pendingLoc && !!p;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && cancelDialog()}>
      <DrawerContent>
        {p && pendingLoc && (
          <>
            <DrawerTitle>
              Towar ma {p.locs.length} lokalizacje — co z{" "}
              <span className="text-amber-ink">{pendingLoc}</span>?
            </DrawerTitle>
            <Button
              size="tall"
              className="font-cond text-base font-extrabold tracking-wide"
              onClick={() => dialogRoute([pendingLoc], pendingLoc + " (zastąpiono wszystkie)")}
            >
              ZASTĄP WSZYSTKIE
            </Button>
            <Button
              variant="outline"
              size="tall"
              className="font-cond text-[15px] tracking-wide"
              onClick={() => dialogRoute([...p.locs, pendingLoc], pendingLoc + " (dodano)")}
            >
              DODAJ JAKO KOLEJNĄ
            </Button>
            {!pickOne ? (
              <Button
                variant="outline"
                size="tall"
                className="font-cond text-[15px] tracking-wide"
                onClick={openPickOne}
              >
                ZASTĄP JEDNĄ Z… ▾
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-1.5 py-0.5">
                {p.locs.map((old) => (
                  <button
                    key={old}
                    onClick={() =>
                      dialogRoute(
                        p.locs.map((l) => (l === old ? pendingLoc : l)),
                        pendingLoc + " (zamiast " + old + ")"
                      )
                    }
                    className="rounded-full border-[1.5px] border-ink bg-card px-3.5 py-2 font-cond text-[15px] font-bold transition-colors hover:bg-amber-bg"
                  >
                    {old} → {pendingLoc}
                  </button>
                ))}
              </div>
            )}
            <button onClick={cancelDialog} className="p-1.5 text-center text-[13px] font-semibold text-ink-mute">
              Anuluj
            </button>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
