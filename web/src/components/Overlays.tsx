import { Check, Undo2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useInvalidate } from "@/lib/hooks";
import { remove as removeBuffered } from "@/lib/offline";
import { hideUndo, toast, useUi } from "@/lib/store";

export function SuccessOverlay() {
  const success = useUi((s) => s.success);
  if (!success) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background/95">
      <div className="anim-popIn grid h-20 w-20 place-items-center rounded-full bg-amber/15">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-amber">
          <Check className="h-8 w-8 stroke-[3] text-ink" />
        </div>
      </div>
      <div className="anim-fadeUp mt-4 font-cond text-[22px] font-extrabold tracking-wide text-ink">
        {success}
      </div>
      <div className="anim-fadeUp mt-1 text-xs text-ink-mute">worker Sfery zapisze w tle</div>
    </div>
  );
}

export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="anim-fadeUp absolute inset-x-3 bottom-[66px] z-40 rounded-lg bg-ink px-3.5 py-2.5 text-[13px] font-semibold text-white">
      {toast}
    </div>
  );
}

/** Pasek po auto-zapisie: potwierdzenie + COFNIJ w oknie karencji kolejki. */
export function UndoBar() {
  const undo = useUi((s) => s.undo);
  const curId = useUi((s) => s.curId);
  const inv = useInvalidate();
  if (!undo) return null;

  async function cancel() {
    const u = undo!;
    hideUndo();
    if (u.queueId != null) {
      try {
        await api.cancel(u.queueId);
        inv.queue();
        if (curId) inv.product(curId);
        toast("Cofnięto");
      } catch (e) {
        toast(
          e instanceof ApiError && e.status === 409
            ? "Już zapisane — zeskanuj ponownie, aby poprawić"
            : e instanceof Error
              ? e.message
              : "Nie udało się cofnąć"
        );
      }
    } else if (u.bufferId) {
      toast(removeBuffered(u.bufferId) ? "Cofnięto (z bufora)" : "Operacja już wysłana");
    }
  }

  return (
    <div className="anim-fadeUp absolute inset-x-3 bottom-[8px] z-40 flex items-center gap-2.5 rounded-lg bg-ink px-3.5 py-2.5 text-white shadow-lg">
      <Check className="h-4 w-4 flex-none stroke-[3] text-amber" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{undo.msg}</div>
        {undo.warn && <div className="truncate text-[11px] text-amber">{undo.warn}</div>}
      </div>
      <button
        onClick={cancel}
        className="flex flex-none items-center gap-1.5 rounded-md border border-white/25 px-3 py-1.5 font-cond text-[13px] font-extrabold tracking-wide text-amber"
      >
        <Undo2 className="h-3.5 w-3.5" /> COFNIJ
      </button>
    </div>
  );
}
