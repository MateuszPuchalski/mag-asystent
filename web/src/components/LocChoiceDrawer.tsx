import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import type { ProductCard } from "@/lib/api";

export interface LocChoice {
  action: "replace" | "add" | "replace_one";
  value: string;
  replaced?: string;
}

/**
 * Wybór przy wielu lokalizacjach: ZASTĄP WSZYSTKIE / DODAJ / ZASTĄP JEDNĄ.
 * Wspólny dla karty towaru (skan bezpośredni) i ekranu ScanLoc.
 */
export function LocChoiceDrawer({
  product,
  code,
  onClose,
  onPick,
}: {
  product: ProductCard;
  code: string | null;
  onClose: () => void;
  onPick: (choice: LocChoice, successMsg: string) => void;
}) {
  const [pickOne, setPickOne] = useState(false);
  const close = () => {
    setPickOne(false);
    onClose();
  };

  return (
    <Drawer open={!!code} onOpenChange={(o) => !o && close()}>
      <DrawerContent>
        {code && (
          <>
            <DrawerTitle>
              Towar ma {product.locs.length} lokalizacje — co z <span className="text-amber-ink">{code}</span>?
            </DrawerTitle>
            <Button
              size="tall"
              className="flex-col gap-0.5 font-cond text-base font-extrabold tracking-wide"
              onClick={() => onPick({ action: "replace", value: code }, "Lokalizacja zapisana")}
            >
              ZASTĄP WSZYSTKIE
              <span className="text-[10px] font-semibold normal-case tracking-normal opacity-90">
                usuniesz: {product.locs.join(", ")} · zostanie: {code}
              </span>
            </Button>
            <Button
              variant="outline"
              size="tall"
              className="font-cond text-[15px] tracking-wide"
              onClick={() => onPick({ action: "add", value: code }, "Lokalizacja dodana")}
            >
              DODAJ JAKO KOLEJNĄ
            </Button>
            {!pickOne ? (
              <Button variant="outline" size="tall" className="font-cond text-[15px] tracking-wide" onClick={() => setPickOne(true)}>
                ZASTĄP JEDNĄ Z… ▾
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-1.5 py-0.5">
                {product.locs.map((old) => (
                  <button
                    key={old}
                    onClick={() => onPick({ action: "replace_one", value: code, replaced: old }, "Lokalizacja zapisana")}
                    className="rounded-full border-[1.5px] border-ink bg-card px-3.5 py-2 font-cond text-[15px] font-bold transition-colors hover:bg-amber-bg"
                  >
                    {old} → {code}
                  </button>
                ))}
              </div>
            )}
            <button onClick={close} className="p-1.5 text-center text-[13px] font-semibold text-ink-mute">
              Anuluj
            </button>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
