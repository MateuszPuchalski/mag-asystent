import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X, MapPin, PackagePlus } from "lucide-react";
import { Cog, Barcode } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type InventoryItem } from "@/lib/api";
import { useInventorySession, useInvalidate, useLocations } from "@/lib/hooks";
import { go, toast, useUi } from "@/lib/store";
import { beep } from "@/lib/feedback";
import { normalizeLoc, validateLoc } from "@/lib/locval";

const DEMO_LOCS = ["E08-03-01", "H04-05-02", "A05-01-01"];
const IS_DEV = import.meta.env.DEV;

export function Inventory() {
  const sessionId = useUi((s) => s.invSessionId);
  const { data: sess, isLoading } = useInventorySession(sessionId);
  const { data: info } = useLocations();
  const inv = useInvalidate();
  const [activeLoc, setActiveLoc] = useState("");
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => hiddenRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, InventoryItem[]>();
    for (const it of sess?.items ?? []) {
      const arr = m.get(it.location) ?? [];
      arr.push(it);
      m.set(it.location, arr);
    }
    return [...m.entries()];
  }, [sess]);

  if (isLoading || !sess) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2.5 text-sm font-semibold text-ink-mute">
        <Cog className="h-[18px] w-[18px]" hole="#F6F5F2" /> Wczytywanie inwentaryzacji…
      </div>
    );
  }
  const sid = sess.id;
  const refresh = () => inv.invSession(sid);

  async function handleScan(raw: string) {
    const code = normalizeLoc(raw);
    // lokalizacja? (ma literę, nie czysty EAN) → skanuj miejsce
    if (/[A-Za-z]/.test(code) && !/^\d+$/.test(code)) {
      const err = validateLoc(code, info);
      if (err) return (toast(err), beep(false));
      try {
        await api.invScan(sid, code);
        setActiveLoc(code);
        beep(true);
        refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Błąd");
      }
      return;
    }
    // inaczej: skan towaru → „nadmiar" w aktywnej lokalizacji
    if (!activeLoc) return (toast("Najpierw zeskanuj lokalizację"), beep(false));
    try {
      const r = await api.scan(code);
      if (r.type === "product") {
        await api.invExtra(sid, { location: activeLoc, twId: r.card.id });
        beep(true);
        refresh();
      } else {
        beep(false);
        toast("Nieznany towar: " + code);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Błąd");
    }
  }

  async function mark(it: InventoryItem, present: boolean) {
    try {
      await api.invMark(sid, { itemId: it.id, present });
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Błąd");
    }
  }

  async function close() {
    try {
      const r = await api.invClose(sid);
      toast(`Zamknięto: ${r.summary.ok} OK · ${r.summary.missing} brak · ${r.summary.extra} nadmiar`);
      go("home");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Błąd");
    }
  }

  const s = sess.summary;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <input
        ref={hiddenRef}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            handleScan(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
        className="pointer-events-none absolute left-[-999px] opacity-0"
      />
      <div className="flex-none border-b bg-card px-3 py-2 text-xs font-semibold text-ink-soft">
        {s.ok} OK · {s.missing} brak · {s.extra} nadmiar · {s.unchecked} do sprawdzenia
      </div>

      <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-amber bg-amber-bg-soft px-3 py-4">
          <Barcode className="h-6 w-9 text-ink" />
          <div className="font-cond text-[15px] font-bold uppercase tracking-[0.06em]">
            {activeLoc ? `Skanuj towary w ${activeLoc}` : "Zeskanuj etykietę regału"}
          </div>
          <div className="text-[11px] text-ink-mute">
            {activeLoc ? "skan towaru = nadmiar; inna etykieta = nowe miejsce" : "pokażę, co powinno tu leżeć"}
          </div>
        </div>

        {IS_DEV && (
          <div className="flex flex-wrap gap-1.5">
            {DEMO_LOCS.map((c) => (
              <button
                key={c}
                onClick={() => handleScan(c)}
                className="rounded-full border-[1.5px] border-ink bg-card px-3 py-1.5 font-cond text-sm font-bold transition-colors hover:bg-amber-bg"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {grouped.map(([loc, items]) => (
          <div key={loc} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
              <MapPin className="h-3.5 w-3.5" /> {loc}
            </div>
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-cond text-sm font-bold tracking-wide">{it.sym}</span>
                    {!it.expected && (
                      <Badge variant="amber" className="gap-1">
                        <PackagePlus className="h-3 w-3" /> nadmiar
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-ink-soft">{it.name}</div>
                </div>
                {it.expected ? (
                  <div className="flex flex-none gap-1.5">
                    <Button
                      variant={it.counted === true ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => mark(it, true)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={it.counted === false ? "destructive" : "outline"}
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => mark(it, false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Check className="h-4 w-4 flex-none stroke-[3] text-success" />
                )}
              </div>
            ))}
          </div>
        ))}

        {grouped.length === 0 && (
          <div className="py-6 text-center text-sm text-ink-mute">Zeskanuj pierwszą lokalizację, aby zacząć.</div>
        )}

        <Button variant="outline" size="tall" className="mt-1 font-cond tracking-wide" onClick={close}>
          ZAMKNIJ I ROZLICZ
        </Button>
      </div>
    </div>
  );
}
