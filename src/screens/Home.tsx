import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Barcode, Cog } from "@/components/glyphs";
import { Badge } from "@/components/ui/badge";
import { beep } from "@/lib/feedback";
import {
  interpretScan,
  openProduct,
  searchProducts,
  setQuery,
  useStore,
} from "@/lib/store";

const SCAN_CHAR_MS = 50; // skaner wrzuca znaki szybciej niż człowiek

export function Home() {
  const loading = useStore((s) => s.loading);
  const query = useStore((s) => s.query);
  const products = useStore((s) => s.products);
  const recent = useStore((s) => s.recent);
  const inputRef = useRef<HTMLInputElement>(null);
  const fast = useRef({ last: 0, count: 0 });

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const q = query.trim();
  const results = q ? searchProducts(q) : [];

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const t = performance.now();
    if (e.key.length === 1) {
      fast.current.count = t - fast.current.last < SCAN_CHAR_MS ? fast.current.count + 1 : 0;
      fast.current.last = t;
    }
    if (e.key === "Enter") {
      const val = query.trim();
      if (!val) return;
      const isScan = fast.current.count >= 3 || /^\d{8}$|^\d{12,14}$/.test(val);
      fast.current.count = 0;
      if (isScan) return interpretScan(val);
      if (results.length) openProduct(results[0].id);
    }
  }

  const demoSyms = ["W80-2005", "W07-0101", "FTC201"];
  let tiles = demoSyms.map((s) => products.find((x) => x.sym === s)).filter(Boolean) as typeof products;
  if (!tiles.length) tiles = products.slice(0, 3);

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3.5 overflow-y-auto p-3">
      {loading && (
        <div className="flex items-center justify-center gap-2.5 py-5 text-sm font-semibold text-ink-mute">
          <Cog className="h-[18px] w-[18px]" hole="#F6F5F2" /> Ładowanie bazy towarów…
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-lg border-2 border-ink bg-card px-3 py-2.5">
        <Barcode className="h-4 w-6 text-ink" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Skanuj lub wpisz symbol / nazwę…"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:text-ink-mute"
        />
        {q && (
          <button onClick={() => setQuery("")} className="px-0.5 text-ink-mute">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {q ? (
        results.length ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
              Wyniki ({results.length})
            </div>
            {results.map((x) => (
              <button
                key={x.id}
                onClick={() => openProduct(x.id)}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-amber hover:bg-amber-bg-soft"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-cond text-[15px] font-bold tracking-wide">{x.sym}</div>
                  <div className="truncate text-xs text-ink-soft">{x.name}</div>
                </div>
                <div className="flex-none text-right text-xs font-semibold">
                  <div>MAG <b className="font-bold">{x.mag}</b></div>
                  <div className={x.mgp > 0 ? "text-amber-ink" : "text-ink-mute"}>
                    MGP <b className="font-bold">{x.mgp}</b>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="py-4 text-center text-sm text-ink-mute">
            Brak wyników dla „{q}”
          </div>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="-mt-1.5 text-[11px] text-ink-mute">
            Baza: {products.length} kartotek z Subiekta (odczyt SQL)
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
            Symulacja skanera — dotknij kod
          </div>
          {tiles.map((x) => (
            <button
              key={x.id}
              onClick={() => { beep(true); openProduct(x.id); }}
              className="flex items-center gap-3 rounded-lg border border-dashed border-[#C9C5BB] bg-card px-3 py-2 text-left transition-colors hover:border-amber"
            >
              <Barcode className="h-[17px] w-[26px] text-ink-soft" />
              <div className="min-w-0">
                <div className="text-xs font-semibold tabular-nums tracking-wide">
                  {x.ean || x.sym}
                </div>
                <div className="truncate text-[11px] text-ink-mute">{x.name}</div>
              </div>
            </button>
          ))}

          {recent.length > 0 && (
            <>
              <div className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
                Ostatnio skanowane
              </div>
              {recent
                .map((id) => products.find((x) => x.id === id))
                .filter(Boolean)
                .map((x) => (
                  <button
                    key={x!.id}
                    onClick={() => openProduct(x!.id)}
                    className="flex items-center justify-between gap-2.5 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-amber"
                  >
                    <span className="font-cond text-sm font-bold">{x!.sym}</span>
                    <Badge variant="secondary" className="font-normal">
                      {x!.locs[0] || "brak lokalizacji"}
                    </Badge>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
