import { ChevronLeft, PackageOpen } from "lucide-react";
import { Barcode, Cog } from "@/components/glyphs";
import { SuccessOverlay, Toast } from "@/components/Overlays";
import { Splash } from "@/screens/Splash";
import { Home } from "@/screens/Home";
import { Product } from "@/screens/Product";
import { ScanLoc } from "@/screens/ScanLoc";
import { MM } from "@/screens/MM";
import { Queue } from "@/screens/Queue";
import { PutawayDocuments } from "@/screens/putaway/Documents";
import { PutawaySession } from "@/screens/putaway/Session";
import { backTarget, go, goBack, useUi, type Screen as ScreenName } from "@/lib/store";
import { cn } from "@/lib/utils";

const TITLE: Record<Exclude<ScreenName, "splash">, string> = {
  home: "Magazyn",
  product: "Karta towaru",
  scanLoc: "Skan lokalizacji",
  mm: "Przesunięcie MM",
  queue: "Kolejka Sfery",
  putawayDocs: "Rozkładanie dostaw",
  putawaySession: "Sesja rozkładania",
};

function TopBar() {
  const screen = useUi((s) => s.screen);
  const mode = useUi((s) => s.mode);
  if (screen === "splash") return null;
  const hasBack = !!backTarget(screen);
  const title =
    screen === "scanLoc" && mode === "combo" ? "Zasilenie — cel" : TITLE[screen as Exclude<ScreenName, "splash">];

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

function Tab({
  active,
  onClick,
  label,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn("relative flex flex-col items-center justify-center gap-1 border-t-[3px]", active ? "border-amber" : "border-transparent")}
    >
      {children}
      <span className={cn("font-cond text-[11px] font-bold tracking-[0.08em]", active ? "text-ink" : "text-ink-mute")}>{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute right-[calc(50%-22px)] top-1 grid h-4 min-w-4 place-items-center rounded-lg bg-amber px-1 text-[10px] font-extrabold text-ink">
          {badge}
        </span>
      )}
    </button>
  );
}

function TabBar() {
  const screen = useUi((s) => s.screen);
  const onQueue = screen === "queue";
  const onPutaway = screen === "putawayDocs" || screen === "putawaySession";
  const onScan = !onQueue && !onPutaway;

  return (
    <nav className="grid h-[54px] flex-none grid-cols-3 border-t bg-card">
      <Tab active={onScan} onClick={() => go("home")} label="SKAN">
        <Barcode className={cn("h-3.5 w-[22px]", onScan ? "text-ink" : "text-ink-mute")} />
      </Tab>
      <Tab active={onPutaway} onClick={() => go("putawayDocs")} label="ROZKŁADANIE">
        <PackageOpen className={cn("h-[18px] w-[18px]", onPutaway ? "text-ink" : "text-ink-mute")} />
      </Tab>
      <Tab active={onQueue} onClick={() => go("queue")} label="KOLEJKA">
        <Cog className="h-[17px] w-[17px]" spinning={false} color={onQueue ? "#2A2A2C" : "#9A9A9E"} hole="#fff" />
      </Tab>
    </nav>
  );
}

function CurrentScreen() {
  const screen = useUi((s) => s.screen);
  switch (screen) {
    case "home": return <Home />;
    case "product": return <Product />;
    case "scanLoc": return <ScanLoc />;
    case "mm": return <MM />;
    case "queue": return <Queue />;
    case "putawayDocs": return <PutawayDocuments />;
    case "putawaySession": return <PutawaySession />;
    default: return null;
  }
}

export default function App() {
  const isSplash = useUi((s) => s.screen === "splash");

  return (
    <div id="stage" className="grid min-h-screen place-items-center p-9 max-[480px]:p-0 max-[760px]:p-0">
      <div id="device" className="relative rounded-[30px] bg-[#2A2A2C] px-3.5 pb-5 pt-4 shadow-2xl max-[760px]:rounded-none max-[760px]:p-0">
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
                <CurrentScreen />
                <SuccessOverlay />
                <Toast />
              </main>
              <TabBar />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
