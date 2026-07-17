import { useEffect, useState } from "react";
import { ChevronLeft, PackageOpen, Camera, Settings as SettingsIcon } from "lucide-react";
import { Barcode } from "@/components/glyphs";
import { SferaStatus } from "@/components/SferaStatus";
import { SuccessOverlay, Toast, UndoBar } from "@/components/Overlays";
import { Splash } from "@/screens/Splash";
import { Home } from "@/screens/Home";
import { Product } from "@/screens/Product";
import { ScanLoc } from "@/screens/ScanLoc";
import { MM } from "@/screens/MM";
import { Queue } from "@/screens/Queue";
import { PutawayDocuments } from "@/screens/putaway/Documents";
import { PutawaySession } from "@/screens/putaway/Session";
import { LocationView } from "@/screens/Location";
import { Settings } from "@/screens/Settings";
import { OfflineBanner } from "@/components/OfflineBanner";
import { CameraScan, cameraScanAvailable } from "@/components/CameraScan";
import { MicButton } from "@/components/MicButton";
import { backTarget, go, goBack, openLocation, openProduct, openQueue, openSettings, toast, useUi, type Screen as ScreenName } from "@/lib/store";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { beep } from "@/lib/feedback";
import { installScanListener, setFallbackScanHandler } from "@/lib/scanner";
import { setFallbackCommandHandler } from "@/lib/commands";
import { performUndo } from "@/lib/undo";
import { installWakeLock } from "@/lib/wakelock";
import { installMotion } from "@/lib/motion";
import { flush } from "@/lib/offline";
import { speak, spellLoc } from "@/lib/voice";
import { getSettings, useSettings } from "@/lib/settings";

const TITLE: Record<Exclude<ScreenName, "splash">, string> = {
  home: "Magazyn",
  product: "Karta towaru",
  scanLoc: "Skan lokalizacji",
  mm: "Przesunięcie MM",
  queue: "Kolejka Sfery",
  putawayDocs: "Rozkładanie dostaw",
  putawaySession: "Sesja rozkładania",
  location: "Zawartość lokalizacji",
  settings: "Ustawienia",
};

function TopBar({ onCamera }: { onCamera: () => void }) {
  const screen = useUi((s) => s.screen);
  const settings = useSettings();
  if (screen === "splash") return null;
  const hasBack = !!backTarget(screen);
  const title = TITLE[screen as Exclude<ScreenName, "splash">];

  return (
    <header className="flex h-[46px] flex-none items-center gap-1.5 border-b bg-card px-3">
      {hasBack ? (
        <button onClick={goBack} className="-ml-1.5 grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : (
        <img src="assets/wertis-logo.jpg" alt="WERTIS" className="h-7" />
      )}
      <div className={cn("flex-1 truncate font-cond text-[17px] font-bold uppercase tracking-wide", hasBack && "text-center")}>
        {title}
      </div>
      {cameraScanAvailable && settings.cameraScan && (
        <button onClick={onCamera} className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-secondary" title="Skaner awaryjny (aparat)">
          <Camera className="h-[18px] w-[18px]" />
        </button>
      )}
      <button onClick={openSettings} className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-secondary" title="Ustawienia">
        <SettingsIcon className="h-[18px] w-[18px]" />
      </button>
      <SferaStatus />
    </header>
  );
}

function Tab({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn("relative flex flex-col items-center justify-center gap-1 border-t-[3px]", active ? "border-amber" : "border-transparent")}
    >
      {children}
      <span className={cn("font-cond text-[11px] font-bold tracking-[0.08em]", active ? "text-ink" : "text-ink-mute")}>{label}</span>
    </button>
  );
}

function TabBar() {
  const screen = useUi((s) => s.screen);
  const onPutaway = screen === "putawayDocs" || screen === "putawaySession";
  // ekran kolejki jest pod-widokiem otwieranym z pastylki statusu Sfery —
  // wtedy żadna zakładka nie jest podświetlona (stan sygnalizuje pastylka)
  const onScan = !onPutaway && screen !== "queue";

  return (
    <nav className="grid h-[54px] flex-none grid-cols-2 border-t bg-card">
      <Tab active={onScan} onClick={() => go("home")} label="SKAN">
        <Barcode className={cn("h-3.5 w-[22px]", onScan ? "text-ink" : "text-ink-mute")} />
      </Tab>
      <Tab active={onPutaway} onClick={() => go("putawayDocs")} label="ROZKŁADANIE">
        <PackageOpen className={cn("h-[18px] w-[18px]", onPutaway ? "text-ink" : "text-ink-mute")} />
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
    case "location": return <LocationView />;
    case "settings": return <Settings />;
    default: return null;
  }
}

/** Asystent hot-swap: przy niskiej baterii dosłanie bufora + podpowiedź wymiany. */
function installBatteryAssist() {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      addEventListener(type: string, cb: () => void): void;
    }>;
  };
  if (!nav.getBattery) return;
  let warned = false;
  void nav.getBattery().then((b) => {
    const check = () => {
      if (!getSettings().batteryAssist) return;
      if (b.level < 0.15 && !b.charging && !warned) {
        warned = true;
        void flush();
        toast("Niski poziom baterii — wymień na zapasową (hot-swap). Bufor wysłany.");
        speak("Niski poziom baterii. Wymień na zapasową.");
        void api.deviceEvent({ type: "battery_low", level: Math.round(b.level * 100) }).catch(() => {});
      }
      if (b.level > 0.3) warned = false;
    };
    b.addEventListener("levelchange", check);
    b.addEventListener("chargingchange", check);
    check();
  });
}

export default function App() {
  const isSplash = useUi((s) => s.screen === "splash");
  const [cameraOpen, setCameraOpen] = useState(false);

  // Globalny router skanów: gdy żaden ekran nie obsłuży skanu — EAN otwiera
  // kartę towaru, etykieta regału otwiera podgląd zawartości lokalizacji.
  useEffect(() => {
    installScanListener();
    installWakeLock();
    installMotion();
    installBatteryAssist();
    // komendy głosowe działające z każdego ekranu
    setFallbackCommandHandler((cmd) => {
      if (cmd.kind === "undo") return (void performUndo(), true);
      if (cmd.kind === "back") return (goBack(), true);
      if (cmd.kind === "queue") return (openQueue(), true);
      return false;
    });
    setFallbackScanHandler((scan) => {
      if (scan.kind === "loc") {
        beep(true);
        openLocation(scan.code);
        return true;
      }
      void api
        .scan(scan.code)
        .then((r) => {
          if (r.type === "product") {
            beep(true);
            openProduct(r.card.id, { sym: r.card.sym, loc: r.card.locs[0] || "brak lokalizacji" });
            // hands-free: magazynier słyszy dokąd iść, bez patrzenia w ekran
            speak(
              r.card.locs[0]
                ? `${r.card.sym}. Lokalizacja: ${spellLoc(r.card.locs[0])}`
                : `${r.card.sym}. Brak lokalizacji`
            );
          } else {
            beep(false);
            toast("Nieznany kod: " + scan.code);
          }
        })
        .catch(() => toast("Błąd połączenia z serwerem"));
      return true;
    });
  }, []);

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
              <TopBar onCamera={() => setCameraOpen(true)} />
              <OfflineBanner />
              <main className="relative flex flex-1 flex-col overflow-hidden">
                <CurrentScreen />
                <SuccessOverlay />
                <Toast />
                <UndoBar />
                <MicButton />
              </main>
              <TabBar />
              <CameraScan open={cameraOpen} onClose={() => setCameraOpen(false)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
