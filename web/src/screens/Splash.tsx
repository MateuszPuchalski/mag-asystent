import { useState } from "react";
import { beep } from "@/lib/feedback";
import { go } from "@/lib/store";

export function Splash() {
  const [starting, setStarting] = useState(false);

  function start() {
    if (starting) return;
    setStarting(true);
    beep(true);
    setTimeout(() => go("home"), 260);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") start();
      }}
      className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-white"
    >
      <img
        src="assets/wertis-logo.jpg"
        alt="WERTIS — sklep z częściami"
        className="anim-fadeUp w-[248px] max-w-[70%]"
      />
      <div
        className={`mt-6 font-cond text-[15px] font-bold uppercase tracking-[0.14em] text-ink-mute transition-opacity ${
          starting ? "opacity-40" : "opacity-100"
        }`}
      >
        {starting ? "Uruchamianie…" : "Dotknij, aby rozpocząć"}
      </div>
      <div className="absolute bottom-4 text-[11px] text-ink-faint">
        Kolektor magazynowy · prototyp v0.2
      </div>
    </div>
  );
}
