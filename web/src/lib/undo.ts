import { ApiError, api } from "./api";
import { remove as removeBuffered } from "./offline";
import { queryClient } from "./queryClient";
import { hideUndo, store, toast } from "./store";
import { speak } from "./voice";

/**
 * Cofnięcie ostatniego auto-zapisu (pasek COFNIJ / potrząśnięcie urządzeniem).
 * Online: anuluje zadanie w kolejce Sfery (działa w oknie karencji);
 * offline: usuwa operację z bufora.
 */
export async function performUndo(): Promise<void> {
  const u = store.getState().undo;
  if (!u) return;
  hideUndo();
  if (u.queueId != null) {
    try {
      await api.cancel(u.queueId);
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
      const curId = store.getState().curId;
      if (curId) void queryClient.invalidateQueries({ queryKey: ["product", curId] });
      toast("Cofnięto");
      speak("Cofnięto");
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
    speak("Cofnięto");
  }
}
