import { Check } from "lucide-react";
import { useUi } from "@/lib/store";

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
