import { useState } from "react";
import { ArrowLeftRight, Trash2, X, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Barcode, Cog } from "@/components/glyphs";
import { cn } from "@/lib/utils";
import { beep } from "@/lib/feedback";
import { useHistory, useLocations, useProduct, useSetLocation } from "@/lib/hooks";
import {
  flashSuccess,
  openMM,
  openScanLoc,
  setChipMenu,
  showUndo,
  toast,
  useUi,
} from "@/lib/store";
import { isKnownLoc, validateLoc } from "@/lib/locval";
import { speak, spellLoc } from "@/lib/voice";
import { classify, dispatchScan, useScanHandler } from "@/lib/scanner";
import { LocChoiceDrawer, type LocChoice } from "@/components/LocChoiceDrawer";
import type { RunResult } from "@/lib/offline";

const LOC_LIMIT = 50;
const DEMO_SCANS = ["E08-03-01", "PALETA48", "5905947595303"];
const IS_DEV = import.meta.env.DEV;

export function Product() {
  const curId = useUi((s) => s.curId);
  const chipMenu = useUi((s) => s.chipMenu);
  const [pending, setPending] = useState<string | null>(null); // skan lok. przy wielu lokalizacjach
  const { data: p, isLoading } = useProduct(curId);
  const { data: history } = useHistory(curId);
  const { data: locInfo } = useLocations();
  const setLoc = useSetLocation(curId ?? 0);

  /** Zapis relokacji ze skanu + pasek COFNIJ. */
  function saveLoc(choice: LocChoice, successMsg: string) {
    const warn = !isKnownLoc(choice.value, locInfo) ? "Lokalizacja spoza wykazu — sprawdź etykietę" : undefined;
    setLoc.mutate(choice, {
      onSuccess: (res: RunResult) => {
        beep(true);
        setPending(null);
        speak(`Zapisano, ${spellLoc(choice.value)}`);
        showUndo({
          msg: res.offline ? `Zapisano lokalnie · ${choice.value}` : `${successMsg} · ${choice.value}`,
          queueId: res.queueId,
          bufferId: res.bufferId,
          warn,
        });
      },
      onError: (e) => toast(e instanceof Error ? e.message : "Błąd zapisu"),
    });
  }

  // Intencja z kolejności skanów: na karcie towaru skan etykiety regału =
  // przenieś TEN towar TAM. Skan EAN → fallback (karta kolejnego towaru).
  useScanHandler((scan) => {
    if (!p || scan.kind !== "loc") return false;
    const err = validateLoc(scan.code, locInfo);
    if (err) {
      toast(err);
      beep(false);
      speak(err);
      return true;
    }
    if (p.locs.includes(scan.code)) {
      toast(`Towar już ma lokalizację ${scan.code}`);
      return true;
    }
    if (p.locs.length > 1) {
      setPending(scan.code);
      return true;
    }
    saveLoc({ action: "replace", value: scan.code }, "Lokalizacja zapisana");
    return true;
  });

  if (isLoading || !p) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2.5 text-sm font-semibold text-ink-mute">
        <Cog className="h-[18px] w-[18px]" hole="#F6F5F2" /> Wczytywanie karty…
      </div>
    );
  }

  const locStr = p.locs.join(" ");
  const overLimit = locStr.length > 42;
  const noMgp = p.mgp.stan === 0;
  const hasPendingMM = p.mgp.pendingOut > 0;

  function removeChip(code: string) {
    setLoc.mutate(
      { action: "remove", value: code },
      {
        onSuccess: () => {
          setChipMenu(null);
          flashSuccess("Lokalizacja usunięta");
        },
        onError: (e) => toast(e instanceof Error ? e.message : "Błąd zapisu"),
      }
    );
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div>
        <div className="text-base font-bold leading-snug text-pretty">{p.name}</div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-soft">
          <b className="text-ink">{p.sym}</b>
          <span>EAN {p.ean || "—"}</span>
          <span>{p.unit}</span>
        </div>
        {p.desc && <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-ink-mute">{p.desc}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] font-bold tracking-[0.12em] text-ink-mute">MAG · DOSTĘPNE</div>
          <div className="font-cond text-3xl font-extrabold leading-tight">{p.mag.avail}</div>
          <div className="text-[11px] text-ink-soft">rez. {p.mag.rez} · razem {p.mag.stan}</div>
        </div>
        <div className={cn("rounded-lg border p-3", p.mgp.stan > 0 ? "border-amber-line bg-amber-bg" : "bg-card")}>
          <div className="text-[10px] font-bold tracking-[0.12em] text-ink-mute">MGP · STREFA PRZYJĘĆ</div>
          <div className={cn("font-cond text-3xl font-extrabold leading-tight", p.mgp.stan > 0 && "text-amber-ink")}>
            {p.mgp.stan}
          </div>
          <div className="text-[11px] text-ink-soft">
            {p.mgp.stan > 0 ? "do zasilenia MAG" : p.ordered > 0 ? "zam. u dostawcy: " + p.ordered : "strefa przyjęć pusta"}
          </div>
        </div>
      </div>

      {hasPendingMM && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-line bg-amber-bg-soft px-2.5 py-1.5 text-xs font-semibold text-[#8A6300]">
          <Cog className="h-3.5 w-3.5 flex-none" hole="#FFF6E3" />
          W kolejce Sfery ⏳ {p.mgp.pendingOut} szt — stan uwzględni zapis za chwilę
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
            Lokalizacje <span className="font-normal normal-case tracking-normal">(pierwsza = pickingowa)</span>
          </div>
          <div className={cn("text-[10px] font-semibold tabular-nums", overLimit ? "text-destructive" : "text-ink-mute")}>
            {locStr.length}/{LOC_LIMIT} zn.
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.locs.length === 0 && (
            <div className="rounded-full border-[1.5px] border-dashed border-[#C9C5BB] px-3 py-1.5 text-[13px] text-ink-mute">
              brak lokalizacji
            </div>
          )}
          {p.locs.map((c, i) => (
            <button
              key={c}
              onClick={() => setChipMenu(c)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border-[1.5px] border-ink px-3 py-1.5 font-cond text-[15px] font-bold tracking-wide transition-transform active:scale-95",
                i === 0 ? "bg-ink text-white" : "bg-card text-ink"
              )}
            >
              {i === 0 && <span className="h-[7px] w-[7px] rounded-full bg-amber" />}
              {c}
            </button>
          ))}
        </div>
        {chipMenu && (
          <div className="anim-popIn flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2">
            <div className="flex-1 text-[13px]">Lokalizacja <b>{chipMenu}</b></div>
            <Button variant="destructive" size="sm" disabled={setLoc.isPending} onClick={() => removeChip(chipMenu)}>
              <Trash2 className="h-3.5 w-3.5" /> USUŃ
            </Button>
            <button onClick={() => setChipMenu(null)} className="px-1.5 text-ink-mute">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {history && history.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
            <History className="h-3.5 w-3.5" /> Historia
          </div>
          <div className="flex flex-col gap-1 rounded-lg border bg-card px-2.5 py-2">
            {history.slice(0, 4).map((h, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="flex-1 truncate text-ink-soft">{h.detail || h.type}</span>
                <span className="flex-none text-ink-mute">
                  {h.user} · {h.at.slice(5, 10)} {h.at.slice(11, 16)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center justify-center gap-2 text-[11px] text-ink-mute">
          <Barcode className="h-3 w-5 text-ink-soft" />
          skan etykiety regału = przenieś tutaj · skan towaru = następna karta
        </div>

        {IS_DEV && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {DEMO_SCANS.map((c) => (
              <button
                key={c}
                onClick={() => dispatchScan(classify(c))}
                className="rounded-full border border-dashed border-[#C9C5BB] bg-card px-2.5 py-1 font-cond text-xs font-bold tracking-wide hover:border-amber"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="tall" className="font-cond text-[15px] tracking-wide" onClick={() => openScanLoc()}>
            ZMIEŃ LOKALIZACJĘ
          </Button>
          <Button
            variant="outline"
            size="tall"
            className={cn("font-cond text-[15px] tracking-wide", noMgp && "opacity-40")}
            onClick={() => (noMgp ? toast("Brak stanu na MGP") : openMM())}
          >
            <ArrowLeftRight className="h-4 w-4" /> MM MGP → MAG
          </Button>
        </div>
      </div>

      {p && <LocChoiceDrawer product={p} code={pending} onClose={() => setPending(null)} onPick={saveLoc} />}
    </div>
  );
}
