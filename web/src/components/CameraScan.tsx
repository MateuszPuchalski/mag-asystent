import { useEffect, useRef } from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { beep } from "@/lib/feedback";
import { classify, dispatchScan } from "@/lib/scanner";
import { toast } from "@/lib/store";

/* ── Kamera jako skaner awaryjny ────────────────────────────────────────────
   Gdy silnik skanera zawiedzie albo kod jest uszkodzony: natywny
   BarcodeDetector (Chrome/Android) na podglądzie tylnej kamery. Wynik idzie
   przez globalny router skanów — zachowanie właściwe dla aktywnego ekranu.   */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

export const cameraScanAvailable =
  typeof window !== "undefined" &&
  !!window.BarcodeDetector &&
  !!navigator.mediaDevices?.getUserMedia;

export function CameraScan({ open, onClose }: { open: boolean; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open || !cameraScanAvailable) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    const detector = new window.BarcodeDetector!({
      formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code"],
    });

    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue) {
              beep(true);
              const value = codes[0].rawValue;
              stop();
              onClose();
              dispatchScan(classify(value));
              return;
            }
          } catch {
            /* klatka nieczytelna — próbuj dalej */
          }
          setTimeout(tick, 120);
        };
        void tick();
      } catch {
        toast("Brak dostępu do kamery");
        onClose();
      }
    }

    function stop() {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    }

    void run();
    return stop;
  }, [open, onClose]);

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerTitle>Skaner awaryjny — aparat</DrawerTitle>
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-[4/3] w-full rounded-lg bg-ink object-cover"
        />
        <div className="text-center text-[11px] text-ink-mute">
          Nakieruj na kod — odczyt nastąpi automatycznie
        </div>
      </DrawerContent>
    </Drawer>
  );
}
