import { useSyncExternalStore } from "react";
import { getSettings } from "./settings";

/* ── ASR offline (Whisper on-device przez transformers.js) ──────────────────
   Push-to-talk: nagranie z mikrofonu (16 kHz mono) → transkrypcja małym
   Whisperem w przeglądarce. Wagi ładowane NAJPIERW z własnego serwera
   (web/public/models/<id>/ — patrz DEPLOY.md i tools/fetch-asr-model.mjs;
   magazyn on-premise nie ma internetu), z fallbackiem do huggingface.co.
   Po pierwszym załadowaniu wagi siedzą w cache przeglądarki → offline.       */

const ASR_MODEL = (import.meta.env.VITE_ASR_MODEL ?? "onnx-community/whisper-tiny") as string;
const SAMPLE_RATE = 16000;
const MAX_RECORD_MS = 5000;

export type AsrStatus = "off" | "loading" | "ready" | "recording" | "busy" | "unavailable";

let status: AsrStatus = "off";
let progress = 0; // % pobierania wag (0 gdy nie dotyczy)
let lastError = "";
let transcriber: ((audio: Float32Array) => Promise<string>) | null = null;
let initPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function setStatus(s: AsrStatus) {
  status = s;
  emit();
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export function getAsrStatus(): AsrStatus {
  return status;
}
export function useAsrStatus(): AsrStatus {
  return useSyncExternalStore(subscribe, () => status);
}
export function useAsrProgress(): number {
  return useSyncExternalStore(subscribe, () => progress);
}
export function getAsrError(): string {
  return lastError;
}

export const micAvailable =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Leniwe ładowanie modelu (tylko gdy komendy głosowe włączone w Ustawieniach). */
export function ensureAsr(): void {
  if (!getSettings().voiceCommands || initPromise || !micAvailable) return;
  setStatus("loading");
  initPromise = (async () => {
    try {
      // dynamiczny import — transformers.js nie może wejść do głównego bundla
      const { pipeline, env } = await import("@huggingface/transformers");
      // wagi self-hosted mają pierwszeństwo (on-premise bez internetu)
      env.allowLocalModels = true;
      env.localModelPath = "models/";
      env.allowRemoteModels = true; // fallback: HF (dev z internetem)
      const pipe: any = await pipeline("automatic-speech-recognition", ASR_MODEL, {
        dtype: "q8",
        progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.total) {
            progress = Math.round((100 * (p.loaded ?? 0)) / p.total);
            emit();
          }
        },
      });
      transcriber = async (audio: Float32Array) => {
        const out = await pipe(audio, { language: "pl", task: "transcribe" });
        return (out?.text as string) ?? "";
      };
      progress = 0;
      setStatus("ready");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error("[asr] ładowanie modelu nieudane:", e);
      setStatus("unavailable");
    }
  })();
}

/** Ponów próbę załadowania (np. po podłączeniu sieci / wgraniu wag na serwer). */
export function retryAsr(): void {
  if (status === "loading" || status === "recording" || status === "busy") return;
  initPromise = null;
  transcriber = null;
  lastError = "";
  progress = 0;
  setStatus("off");
  ensureAsr();
}

/* nagrywanie: surowe próbki przez AudioContext (Whisper chce 16 kHz Float32) */
let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let chunks: Float32Array[] = [];
let recordTimer: ReturnType<typeof setTimeout> | null = null;

export async function startRecording(): Promise<boolean> {
  if (status !== "ready") return false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    proc.onaudioprocess = (e) => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    setStatus("recording");
    recordTimer = setTimeout(() => void stopAndTranscribe(), MAX_RECORD_MS); // limit długości
    return true;
  } catch {
    cleanup();
    return false;
  }
}

function cleanup() {
  if (recordTimer) clearTimeout(recordTimer);
  recordTimer = null;
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close().catch(() => {});
  stream = null;
  ctx = null;
}

let pendingResult: Promise<string> | null = null;

/** Zatrzymaj nagranie i zwróć transkrypt (pusty string = nic nie zrozumiano). */
export function stopAndTranscribe(): Promise<string> {
  if (status !== "recording") return pendingResult ?? Promise.resolve("");
  const recorded = chunks;
  chunks = [];
  cleanup();
  setStatus("busy");
  pendingResult = (async () => {
    try {
      const total = recorded.reduce((s, c) => s + c.length, 0);
      if (total < SAMPLE_RATE / 4) return ""; // < 0,25 s — przypadkowe dotknięcie
      const audio = new Float32Array(total);
      let off = 0;
      for (const c of recorded) {
        audio.set(c, off);
        off += c.length;
      }
      return (await transcriber!(audio)).trim();
    } catch {
      return "";
    } finally {
      setStatus("ready");
      pendingResult = null;
    }
  })();
  return pendingResult;
}
