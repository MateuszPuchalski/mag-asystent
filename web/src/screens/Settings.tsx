import { useState } from "react";
import { Volume2, Mic, MonitorSmartphone, Vibrate, AlertTriangle, Footprints, BatteryLow, Camera, Check, Plus, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings, setSetting, type Settings as SettingsModel } from "@/lib/settings";
import { addUser, removeUser, selectUser, useUsers, MAX_USER_LEN } from "@/lib/users";
import { toast } from "@/lib/store";
import { speak, spellLoc, voiceAvailable } from "@/lib/voice";
import { wakeLockAvailable } from "@/lib/wakelock";
import { getAsrError, micAvailable, retryAsr, useAsrProgress, useAsrStatus } from "@/lib/asr";
import { cameraScanAvailable } from "@/components/CameraScan";
import { Button } from "@/components/ui/button";

const motionAvailable = typeof window !== "undefined" && "DeviceMotionEvent" in window;
const batteryAvailable = typeof navigator !== "undefined" && "getBattery" in navigator;

interface Row {
  key: keyof SettingsModel;
  icon: React.ReactNode;
  name: string;
  desc: string;
  available: boolean;
}

const ROWS: Row[] = [
  {
    key: "voice",
    icon: <Volume2 className="h-4 w-4" />,
    name: "Głosowe prowadzenie",
    desc: "Kolektor mówi lokalizację po skanie i potwierdza zapisy",
    available: voiceAvailable,
  },
  {
    key: "voiceCommands",
    icon: <Mic className="h-4 w-4" />,
    name: "Komendy głosowe (offline)",
    desc: "Przytrzymaj mikrofon i powiedz: cofnij / stan / pomiń / ilość. Pierwsze użycie pobiera model (kilkadziesiąt–150 MB)",
    available: micAvailable,
  },
  {
    key: "wakeLock",
    icon: <MonitorSmartphone className="h-4 w-4" />,
    name: "Ekran zawsze aktywny",
    desc: "Ekran nie gaśnie podczas pracy (wake lock)",
    available: wakeLockAvailable,
  },
  {
    key: "shakeUndo",
    icon: <Vibrate className="h-4 w-4" />,
    name: "Potrząśnij = COFNIJ",
    desc: "Energiczne potrząśnięcie cofa zapis, gdy widoczny pasek COFNIJ",
    available: motionAvailable,
  },
  {
    key: "dropLog",
    icon: <AlertTriangle className="h-4 w-4" />,
    name: "Rejestr upadków",
    desc: "Upadek urządzenia zapisywany w dzienniku zdarzeń",
    available: motionAvailable,
  },
  {
    key: "walkMode",
    icon: <Footprints className="h-4 w-4" />,
    name: "Tryb marszu (rozkładanie)",
    desc: "Po zatwierdzeniu wózka wielka karta z następną lokalizacją",
    available: true,
  },
  {
    key: "batteryAssist",
    icon: <BatteryLow className="h-4 w-4" />,
    name: "Asystent wymiany baterii",
    desc: "Przy niskiej baterii podpowiedź hot-swap i dosłanie bufora",
    available: batteryAvailable,
  },
  {
    key: "cameraScan",
    icon: <Camera className="h-4 w-4" />,
    name: "Skaner awaryjny (aparat)",
    desc: "Ikona aparatu w pasku — odczyt kodu kamerą, gdy skaner zawiedzie",
    available: cameraScanAvailable,
  },
];

function Toggle({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-7 w-12 flex-none rounded-full border transition-colors",
        disabled ? "cursor-not-allowed bg-secondary opacity-40" : on ? "border-amber bg-amber" : "bg-secondary"
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all",
          on ? "left-[26px]" : "left-[3px]"
        )}
      />
    </button>
  );
}

function UsersSection() {
  const { list, current } = useUsers();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  function submitNew() {
    const added = addUser(name);
    if (!added) return;
    setName("");
    setAdding(false);
    toast(`Pracuje: ${added}`);
  }

  return (
    <>
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
        Użytkownik — kto pracuje
      </div>

      {list.map((u) => (
        <div key={u} className="flex items-center gap-1.5">
          <button
            onClick={() => {
              if (u === current) return;
              selectUser(u);
              toast(`Pracuje: ${u}`);
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
              u === current ? "border-amber bg-amber-bg-soft" : "hover:border-amber"
            )}
          >
            <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-secondary text-ink">
              <UserRound className="h-4 w-4" />
            </div>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{u}</span>
            {u === current && <Check className="h-4 w-4 flex-none text-amber-ink" />}
          </button>
          {list.length > 1 && (
            <button
              onClick={() => {
                removeUser(u);
                toast(`Usunięto: ${u}`);
              }}
              className="grid h-9 w-9 flex-none place-items-center rounded-lg border text-ink-mute hover:border-destructive hover:text-destructive"
              title={`Usuń użytkownika ${u}`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitNew();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            autoFocus
            value={name}
            maxLength={MAX_USER_LEN}
            onChange={(e) => setName(e.target.value)}
            placeholder="Imię lub inicjały…"
            autoCapitalize="words"
            autoComplete="off"
            spellCheck={false}
            className="h-[42px] min-w-0 flex-1 rounded-lg border-2 border-ink bg-card px-3 text-[15px] font-medium outline-none placeholder:text-ink-mute"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="h-[42px] flex-none rounded-lg bg-amber px-3.5 font-cond text-[13px] font-bold tracking-wide disabled:opacity-40"
          >
            DODAJ
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#C9C5BB] px-3 py-2.5 font-cond text-[13px] font-bold tracking-wide text-ink-soft transition-colors hover:border-amber"
        >
          <Plus className="h-4 w-4" /> NOWY UŻYTKOWNIK
        </button>
      )}
    </>
  );
}

export function Settings() {
  const s = useSettings();
  const asr = useAsrStatus();
  const asrProgress = useAsrProgress();

  return (
    <div className="no-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto p-3">
      <UsersSection />

      <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-mute">
        Funkcje urządzenia
      </div>

      {ROWS.map((r) => (
        <div
          key={r.key}
          className={cn("flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5", !r.available && "opacity-60")}
        >
          <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-secondary text-ink">{r.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold">{r.name}</div>
            <div className="text-[11px] leading-snug text-ink-soft">
              {r.available ? r.desc : "Niedostępne na tym urządzeniu"}
            </div>
            {r.key === "voiceCommands" && s.voiceCommands && asr !== "off" && (
              <div className="mt-0.5 text-[10px] font-semibold text-amber-ink">
                {asr === "loading" && (asrProgress > 0 ? `pobieranie modelu… ${asrProgress}%` : "ładowanie modelu…")}
                {asr === "unavailable" && (
                  <span className="text-destructive">
                    model niedostępny — wgraj wagi na serwer (DEPLOY.md) lub sprawdź sieć
                    {getAsrError() && <span className="font-normal"> · {getAsrError().slice(0, 90)}</span>}
                  </span>
                )}
                {(asr === "ready" || asr === "recording" || asr === "busy") && "model gotowy"}
              </div>
            )}
            {r.key === "voiceCommands" && s.voiceCommands && asr === "unavailable" && (
              <button
                onClick={retryAsr}
                className="mt-1 rounded-md border border-amber px-2 py-0.5 font-cond text-[11px] font-bold tracking-wide text-amber-ink"
              >
                PONÓW PRÓBĘ
              </button>
            )}
          </div>
          <Toggle on={r.available && s[r.key]} disabled={!r.available} onClick={() => setSetting(r.key, !s[r.key])} />
        </div>
      ))}

      {voiceAvailable && s.voice && (
        <Button
          variant="outline"
          className="mt-1 font-cond tracking-wide"
          onClick={() => speak(`Przykład: lokalizacja ${spellLoc("E08-03-01")}`)}
        >
          <Volume2 className="h-4 w-4" /> TEST GŁOSU
        </Button>
      )}

      <div className="mt-auto pt-2 text-center text-[11px] text-ink-mute">
        Ustawienia zapisują się na tym urządzeniu
      </div>
    </div>
  );
}
