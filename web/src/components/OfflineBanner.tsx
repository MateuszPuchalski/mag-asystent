import { CloudOff } from "lucide-react";
import { flush, useOfflineCount } from "@/lib/offline";

/** Pasek informacyjny: N operacji czeka w buforze offline (analiza — Wi-Fi w regałach). */
export function OfflineBanner() {
  const count = useOfflineCount();
  if (count === 0) return null;
  return (
    <button
      onClick={() => void flush()}
      className="flex flex-none items-center gap-2 border-b border-amber-line bg-amber-bg px-3 py-1.5 text-left text-xs font-semibold text-[#8A6300]"
    >
      <CloudOff className="h-4 w-4 flex-none" />
      <span className="flex-1">Tryb offline — {count} operacji w buforze, wyślą się po połączeniu</span>
      <span className="font-cond font-bold uppercase tracking-wide text-amber-dark">Wyślij teraz</span>
    </button>
  );
}
