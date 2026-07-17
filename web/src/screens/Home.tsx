import { useEffect, useRef, useState } from "react";
import { X, MapPin } from "lucide-react";
import { Barcode } from "@/components/glyphs";
import { Badge } from "@/components/ui/badge";
import { beep } from "@/lib/feedback";
import { api, type ProductRow } from "@/lib/api";
import { useSearch } from "@/lib/hooks";
import { openLocation, openProduct, toast, useUi } from "@/lib/store";
import { normalizeLoc } from "@/lib/locval";

const SCAN_CHAR_MS = 50;
// Prefiks skanera dla etykiet lokalizacji (konfigurowalny — pewniejszy niż heurystyka czasu).
const LOC_PREFIX = (import.meta.env.VITE_SCAN_LOC_PREFIX ?? "LOC:") as string;
const IS_DEV = import.meta.env.DEV;

/** Kod „wygląda jak lokalizacja": ma literę, nie jest czystym ciągiem cyfr (EAN). */
function looksLikeLocation(code: string): boolean {
  return /[A-Za-z]/.test(code) && !/^\d+$/.test(code) && !/\s/.test(code);
}

const DEMO_TILES = [
  { ean: "5905947596270", name: "Worek do odkurzacza MV 3 WD3 200 SE 4001" },
  { ean: "5905947595303", name: "Filtr paliwa uniwersalny 6mm Skuter Motocykl Atv" },
  { ean: "5907580103419", name: "Łożysko koła kosiarki uniwersalne 12.7mm x 28.6mm" },
];

function openRow(x: ProductRow) {
  openProduct(x.id, { sym: x.sym, loc: x.locs[0] || "brak lokalizacji" });
}

export function Home() {
  const [query, setQuery] = useState("");
  const recent = useUi((s) => s.recent);
  const inputRef = useRef<HTMLInputElement>(null);
  const fast = useRef({ last: 0, count: 0 });

  const q = query.trim();
  const { data: results = [], isFetching } = useSearch(q);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  async function handleScan(code: string) {
    try {
      const r = await api.scan(code);
      if (r.type === "product") {
        beep(true);
        openProduct(r.card.id, { sym: r.card.sym, loc: r.card.locs[0] || "brak lokalizacji" });
      } else if (r.type === "search") {
        setQuery(code);
      } else {
        // nieznany towar — jeśli kod wygląda jak lokalizacja, pokaż jej zawartość
        if (looksLikeLocation(code)) {
          beep(true);
          openLocation(code);
        } else {
          beep(false);
          toast("Nieznany kod: " + code);
        }
      }
    } catch {
      toast("Błąd połączenia z serwerem");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const t = performance.now();
    if (e.key.length === 1) {
      fast.current.count = t - fast.current.last < SCAN_CHAR_MS ? fast.current.count + 1 : 0;
      fast.current.last = t;
    }
    if (e.key === "Enter") {
      const val = query.trim();
      if (!val) return;
      // prefiks skanera dla lokalizacji → od razu podgląd zawartości
      if (LOC_PREFIX && val.toUpperCase().startsWith(LOC_PREFIX.toUpperCase())) {
        fast.current.count = 0;
        setQuery("");
        return void openLocation(normalizeLoc(val));
      }
      const isScan = fast.current.count >= 3 || /^\d{8}$|^\d{12,14}$/.test(val);
      fast.current.count = 0;
      if (isScan) return void handleScan(val);
      if (results.length) openRow(results[0]);
    }
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-3.5 overflow-y-auto p-3">
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
              Wyniki ({results.length}){isFetching ? " …" : ""}
            </div>
            {results.map((x) => (
              <button
                key={x.id}
                onClick={() => openRow(x)}
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
            {isFetching ? "Szukam…" : `Brak wyników dla „${q}”`}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="-mt-1.5 text-[11px] text-ink-mute">
            Dane na żywo z serwera (odczyt SQL z Subiekta)
          </div>

          <button
            onClick={() => openLocation("")}
            className="flex items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5 font-cond text-[13px] font-bold tracking-wide transition-colors hover:border-amber"
          >
            <MapPin className="h-4 w-4 text-ink-soft" /> SKANUJ LOKALIZACJĘ
          </button>

          {IS_DEV && (
            <>
              <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
                Symulacja skanera (DEV) — dotknij kod
              </div>
              {DEMO_TILES.map((x) => (
                <button
                  key={x.ean}
                  onClick={() => handleScan(x.ean)}
                  className="flex items-center gap-3 rounded-lg border border-dashed border-[#C9C5BB] bg-card px-3 py-2 text-left transition-colors hover:border-amber"
                >
                  <Barcode className="h-[17px] w-[26px] text-ink-soft" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tabular-nums tracking-wide">{x.ean}</div>
                    <div className="truncate text-[11px] text-ink-mute">{x.name}</div>
                  </div>
                </button>
              ))}
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
                Ostatnio skanowane
              </div>
              {recent.map((x) => (
                <button
                  key={x.id}
                  onClick={() => openProduct(x.id, { sym: x.sym, loc: x.loc })}
                  className="flex items-center justify-between gap-2.5 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-amber"
                >
                  <span className="font-cond text-sm font-bold">{x.sym}</span>
                  <Badge variant="secondary" className="font-normal">{x.loc}</Badge>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
