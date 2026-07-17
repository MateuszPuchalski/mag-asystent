import { useState } from "react";
import { Minus, Plus, Check, SkipForward, MapPin, Undo2, PackageCheck, AlertTriangle, RotateCcw } from "lucide-react";
import { Cog, Barcode } from "@/components/glyphs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type PutawayItem } from "@/lib/api";
import { useSession, useInvalidate } from "@/lib/hooks";
import { flashSuccess, go, toast, useUi } from "@/lib/store";

const DEMO_LOCS = ["A05-01-01", "B11-02-01", "E08-03-01", "PALETA48"];
const IS_DEV = import.meta.env.DEV;

export function PutawaySession() {
  const sessionId = useUi((s) => s.sessionId);
  const { data: sess, isLoading } = useSession(sessionId);
  const inv = useInvalidate();

  if (isLoading || !sess) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2.5 text-sm font-semibold text-ink-mute">
        <Cog className="h-[18px] w-[18px]" hole="#F6F5F2" /> Wczytywanie sesji…
      </div>
    );
  }

  const sid = sess.id;
  const refresh = () => inv.session(sid);
  const cart = sess.items.filter((i) => i.status === "on_cart");
  // częściowo rozłożone wracają do „Do rozłożenia" — delta czeka na kolejną rundę wózka
  const pending = sess.items.filter((i) => i.status === "pending" || i.status === "partial");
  const doneItems = sess.items.filter((i) => i.status === "done" || i.status === "skipped");

  async function putOnCart(twId: number) {
    try {
      const r = await api.cart(sid, { twId });
      if (r.error) return toast(r.error);
      if (r.locked) return toast("Pozycja na wózku innej osoby: " + r.lockedBy);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Błąd");
    }
  }

  async function commit() {
    try {
      const r = await api.commitCart(sid);
      inv.queue();
      refresh();
      flashSuccess(`Wózek zatwierdzony (${r.committed})`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Nie udało się zatwierdzić");
    }
  }

  async function close() {
    try {
      const r = await api.closeSession(sid);
      inv.docs();
      toast(`Sesja zamknięta: ${r.summary.done} rozłożone, ${r.summary.partial} częściowe, ${r.summary.skipped} pominięte`);
      go("putawayDocs");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Błąd zamknięcia");
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-none border-b bg-card px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="font-cond text-[15px] font-bold tracking-wide">
            {sess.sourceDocNumber ?? "Całe MGP"}
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            {sess.inFlight > 0 && <span title="Zapisy w drodze do Subiekta">⏳ {sess.inFlight}</span>}
            <span>zostało {sess.progress.remaining}/{sess.progress.total} poz.</span>
          </div>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-amber transition-all"
            style={{ width: `${sess.progress.total ? (100 * sess.progress.done) / sess.progress.total : 0}%` }}
          />
        </div>
      </div>

      <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* BŁĘDY KOLEJKI — MM/lokalizacja nie weszły do Subiekta mimo odhaczenia */}
        {sess.queueAlerts?.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-destructive bg-destructive/10 p-2.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-destructive">
              <AlertTriangle className="h-4 w-4" /> Nie zapisano w Subiekcie ({sess.queueAlerts.length})
            </div>
            {sess.queueAlerts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-cond text-sm font-bold tracking-wide">{a.label}</div>
                  <div className="truncate text-[11px] text-ink-soft">{a.errorMsg ?? a.detail}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-cond"
                  onClick={async () => {
                    try {
                      await api.retry(a.id);
                      inv.queue();
                      refresh();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : "Błąd");
                    }
                  }}
                >
                  <RotateCcw className="h-4 w-4" /> PONÓW
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* WÓZEK */}
        {cart.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-amber bg-amber-bg-soft p-2.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-ink">
              <PackageCheck className="h-4 w-4" /> Na wózku ({cart.length})
            </div>
            {cart.map((it) => (
              <CartRow key={it.id} sid={sid} it={it} onChange={refresh} />
            ))}
            <Button size="tall" className="font-cond text-[15px] font-extrabold tracking-wide" onClick={commit}>
              ZATWIERDŹ WÓZEK ({cart.length}) → MM + LOKALIZACJE
            </Button>
          </div>
        )}

        {/* DO ROZŁOŻENIA */}
        {pending.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
              Do rozłożenia — dotknij, aby wziąć na wózek
            </div>
            {pending.map((it) => (
              <button
                key={it.id}
                onClick={() => putOnCart(it.twId)}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-amber"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-cond text-sm font-bold tracking-wide">{it.sym}</div>
                  <div className="truncate text-xs text-ink-soft">{it.name}</div>
                </div>
                <div className="flex-none text-right">
                  {it.targetLoc ? (
                    <Badge variant="secondary" className="font-cond">{it.targetLoc}</Badge>
                  ) : (
                    <Badge variant="destructive" className="font-cond">BRAK LOK</Badge>
                  )}
                  <div className="mt-0.5 text-[11px] text-ink-mute">
                    {it.status === "partial" ? `zostało ${it.delta} z ${it.qtyExpected}` : `${it.qtyExpected} szt`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ZAŁATWIONE */}
        {doneItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">Załatwione</div>
            {doneItems.map((it) => (
              <div key={it.id} className="flex items-center gap-2.5 rounded-lg border bg-card/60 px-3 py-2 opacity-80">
                <div className="min-w-0 flex-1">
                  <div className="font-cond text-sm font-bold tracking-wide">{it.sym}</div>
                  <div className="text-[11px] text-ink-mute">
                    {it.status === "done" && `rozłożono ${it.qtyDone} szt`}
                    {it.status === "partial" && `częściowo ${it.qtyDone}/${it.qtyExpected}`}
                    {it.status === "skipped" && `pominięto${it.skipReason ? " · " + it.skipReason : ""}`}
                  </div>
                </div>
                {it.status === "skipped" ? (
                  <SkipForward className="h-4 w-4 text-ink-mute" />
                ) : (
                  <Check className="h-4 w-4 stroke-[3] text-success" />
                )}
              </div>
            ))}
          </div>
        )}

        {pending.length === 0 && cart.length === 0 && (
          <Button variant="outline" size="tall" className="font-cond tracking-wide" onClick={close}>
            ZAMKNIJ SESJĘ I ROZLICZ
          </Button>
        )}
      </div>
    </div>
  );
}

function CartRow({ sid, it, onChange }: { sid: number; it: PutawayItem; onChange: () => void }) {
  const [qty, setQty] = useState(it.stageQty ?? 0);
  const [loc, setLoc] = useState(it.stageLoc ?? "");
  const [picking, setPicking] = useState(!it.stageLoc);

  async function confirm(location: string) {
    if (!location) return toast("Zeskanuj lokalizację docelową");
    try {
      const r = await api.confirm(sid, { itemId: it.id, qty, location, updateLoc: true });
      if (r?.error) return toast(r.error);
      setLoc(location);
      setPicking(false);
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Błąd");
    }
  }
  async function remove() {
    await api.cartRemove(sid, it.id);
    onChange();
  }
  async function skip() {
    await api.skip(sid, { itemId: it.id });
    onChange();
  }

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-cond text-sm font-bold tracking-wide">{it.sym}</div>
          <div className="truncate text-[11px] text-ink-soft">{it.name}</div>
        </div>
        {loc ? (
          <Badge variant="amber" className="font-cond"><MapPin className="h-3 w-3" />{loc}</Badge>
        ) : (
          <Badge variant="destructive" className="font-cond">wybierz lok.</Badge>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQty(Math.max(1, qty - 1))}>
          <Minus className="h-4 w-4" />
        </Button>
        <div className="min-w-[54px] text-center font-cond text-xl font-extrabold">{qty}</div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQty(Math.min(it.qtyExpected || qty + 1, qty + 1))}>
          <Plus className="h-4 w-4" />
        </Button>
        <div className="text-[11px] text-ink-mute">z {it.qtyExpected || "—"} · MGP {it.mgpStan}</div>
        <div className="ml-auto flex gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-mute" onClick={skip} title="Pomiń">
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-mute" onClick={remove} title="Zdejmij">
            <Undo2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {picking ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-mute">
            <Barcode className="h-3 w-5 text-ink-soft" /> Zeskanuj lokalizację docelową
          </div>
          {IS_DEV && (
            <div className="flex flex-wrap gap-1.5">
              {DEMO_LOCS.map((c) => (
                <button
                  key={c}
                  onClick={() => confirm(c)}
                  className="rounded-full border-[1.5px] border-ink bg-card px-3 py-1.5 font-cond text-sm font-bold transition-colors hover:bg-amber-bg"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button className="flex-1 font-cond tracking-wide" onClick={() => confirm(loc)}>
            <Check className="h-4 w-4" /> POTWIERDŹ NA {loc}
          </Button>
          <Button variant="outline" className="font-cond" onClick={() => setPicking(true)}>
            Inna lok.
          </Button>
        </div>
      )}
    </div>
  );
}
