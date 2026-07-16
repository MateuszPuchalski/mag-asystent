import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Barcode, Cog } from "@/components/glyphs";
import { LocationDialog } from "@/components/LocationDialog";
import { SuccessOverlay, Toast } from "@/components/Overlays";
import { Splash } from "@/screens/Splash";
import { Home } from "@/screens/Home";
import { Product } from "@/screens/Product";
import { ScanLoc } from "@/screens/ScanLoc";
import { MM } from "@/screens/MM";
import { Queue } from "@/screens/Queue";
import { backTarget, go, goBack, loadProducts, useStore } from "@/lib/store";
import type { Screen } from "@/lib/types";
import { cn } from "@/lib/utils";

const TITLE: Record<Exclude<Screen, "splash">, string> = {
  home: "Magazyn",
  product: "Karta towaru",
  scanLoc: "Skan lokalizacji",
  mm: "Przesunięcie MM",
  queue: "Kolejka Sfery",
};

function TopBar() {
  const screen = useStore((s) => s.screen);
  const mode = useStore((s) => s.mode);
  if (screen === "splash") return null;
  const hasBack = !!backTarget(screen);
  const title =
    screen === "scanLoc" && mode === "combo" ? "Zasilenie — cel" : TITLE[screen as Exclude<Screen, "splash">];

  return (
    <header className="flex h-[46px] flex-none items-center gap-2 border-b bg-card px-3">
      {hasBack ? (
        <button onClick={goBack} className="-ml-1.5 grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : (
        <img src="assets/wertis-logo-compact.svg" alt="WERTIS" className="h-6" />
      )}
      <div className={cn("flex-1 font-cond text-[17px] font-bold uppercase tracking-wide", hasBack && "text-center")}>
        {title}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
        <span className="h-2 w-2 rounded-full bg-success" /> Sfera
      </div>
    </header>
  );
}

function TabBar() {
  const screen = useStore((s) => s.screen);
  const badge = useStore((s) => s.queue.filter((t) => t.status !== "done").length);
  const onQueue = screen === "queue";

  return (
    <nav className="grid h-[54px] flex-none grid-cols-2 border-t bg-card">
      <button
        onClick={() => go("home")}
        className={cn("flex flex-col items-center justify-center gap-1 border-t-[3px]", onQueue ? "border-transparent" : "border-amber")}
      >
        <Barcode className={cn("h-3.5 w-[22px]", onQueue ? "text-ink-mute" : "text-ink")} />
        <span className={cn("font-cond text-xs font-bold tracking-[0.1em]", onQueue ? "text-ink-mute" : "text-ink")}>
          SKAN
        </span>
      </button>
      <button
        onClick={() => go("queue")}
        className={cn("relative flex flex-col items-center justify-center gap-1 border-t-[3px]", onQueue ? "border-amber" : "border-transparent")}
      >
        <Cog className="h-[17px] w-[17px]" spinning={false} color={onQueue ? "#2A2A2C" : "#9A9A9E"} hole="#fff" />
        <span className={cn("font-cond text-xs font-bold tracking-[0.1em]", onQueue ? "text-ink" : "text-ink-mute")}>
          KOLEJKA
        </span>
        {badge > 0 && (
          <span className="absolute right-[calc(50%-26px)] top-1.5 grid h-4 min-w-4 place-items-center rounded-lg bg-amber px-1 text-[10px] font-extrabold text-ink">
            {badge}
          </span>
        )}
      </button>
    </nav>
  );
}

function Screen() {
  const screen = useStore((s) => s.screen);
  switch (screen) {
    case "home": return <Home />;
    case "product": return <Product />;
    case "scanLoc": return <ScanLoc />;
    case "mm": return <MM />;
    case "queue": return <Queue />;
    default: return null;
  }
}

export default function App() {
  const isSplash = useStore((s) => s.screen === "splash");

  useEffect(() => {
    loadProducts();
  }, []);

  return (
    <div id="stage" className="grid min-h-screen place-items-center p-9 max-[480px]:p-0 max-[760px]:p-0">
      <div
        id="device"
        className="relative rounded-[30px] bg-[#2A2A2C] px-3.5 pb-5 pt-4 shadow-2xl max-[760px]:rounded-none max-[760px]:p-0"
      >
        <div className="pointer-events-none absolute left-[-5px] top-[170px] h-[74px] w-[7px] rounded bg-amber max-[760px]:hidden" />
        <div className="pointer-events-none absolute right-[-5px] top-[170px] h-[74px] w-[7px] rounded bg-amber max-[760px]:hidden" />
        <div className="flex justify-center pb-2.5 max-[760px]:hidden">
          <div className="h-[5px] w-[54px] rounded bg-[#48484B]" />
        </div>
        <div className="relative flex h-[648px] w-[376px] flex-col overflow-hidden rounded-[10px] bg-background max-[480px]:h-screen max-[480px]:w-screen max-[760px]:h-screen max-[760px]:w-screen max-[760px]:rounded-none">
          {isSplash ? (
            <Splash />
          ) : (
            <>
              <TopBar />
              <main className="relative flex flex-1 flex-col overflow-hidden">
                <Screen />
                <SuccessOverlay />
                <Toast />
                <LocationDialog />
              </main>
              <TabBar />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
