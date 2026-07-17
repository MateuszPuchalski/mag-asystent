import { useState } from "react";
import { Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { beep } from "@/lib/feedback";
import { speak } from "@/lib/voice";
import { toast } from "@/lib/store";
import { useSettings } from "@/lib/settings";
import { ensureAsr, micAvailable, startRecording, stopAndTranscribe, useAsrStatus } from "@/lib/asr";
import { dispatchCommand, parseCommand } from "@/lib/commands";

const IS_DEV = import.meta.env.DEV;

function runTranscript(transcript: string) {
  if (!transcript) {
    beep(false);
    toast("Nie zrozumiałem — powtórz");
    return;
  }
  const cmd = parseCommand(transcript);
  if (!cmd) {
    beep(false);
    toast(`Nie rozpoznano komendy: „${transcript}”`);
    speak("Nie rozumiem");
    return;
  }
  if (!dispatchCommand(cmd)) {
    toast("Ta komenda nie działa na tym ekranie");
  }
}

/** Push-to-talk: przytrzymaj = nagrywaj, puść = wykonaj komendę. */
export function MicButton() {
  const settings = useSettings();
  const status = useAsrStatus();
  const [held, setHeld] = useState(false);

  if (!settings.voiceCommands) return null;
  // bez mikrofonu / bez modelu: w DEV zostaje ścieżka tekstowa, w prod znikamy
  const degraded = !micAvailable || status === "unavailable";
  if (degraded && !IS_DEV) return null;

  async function down() {
    ensureAsr(); // pierwsze dotknięcie uruchamia pobieranie modelu
    if (degraded && IS_DEV) return; // DEV: komenda z klawiatury w onClick
    if (status !== "ready") return;
    setHeld(true);
    if (await startRecording()) beep(true);
    else {
      setHeld(false);
      toast("Brak dostępu do mikrofonu");
    }
  }

  async function up() {
    if (degraded && IS_DEV) {
      const typed = window.prompt("DEV — wpisz komendę głosową:");
      if (typed != null) runTranscript(typed);
      return;
    }
    if (!held) return;
    setHeld(false);
    runTranscript(await stopAndTranscribe());
  }

  const busy = status === "busy" || status === "loading";

  return (
    <button
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => setHeld(false)}
      title="Przytrzymaj i powiedz komendę"
      className={cn(
        "absolute bottom-3 right-3 z-30 grid h-14 w-14 place-items-center rounded-full border-2 shadow-lg transition-colors",
        status === "recording"
          ? "anim-pulse border-amber bg-amber text-ink"
          : "border-ink bg-card text-ink hover:bg-amber-bg"
      )}
    >
      {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Mic className="h-6 w-6" />}
    </button>
  );
}
