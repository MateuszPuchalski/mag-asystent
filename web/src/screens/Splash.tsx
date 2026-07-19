import { useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { beep } from "@/lib/feedback";
import { go } from "@/lib/store";
import { addUser, selectUser, useUsers, MAX_USER_LEN } from "@/lib/users";
import { cn } from "@/lib/utils";

export function Splash() {
  const { list, current } = useUsers();
  const [starting, setStarting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  function start(user: string) {
    if (starting) return;
    selectUser(user);
    setStarting(user);
    beep(true);
    setTimeout(() => go("home"), 260);
  }

  function submitNew() {
    const added = addUser(name);
    if (!added) return;
    setName("");
    setAdding(false);
    start(added);
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      <img
        src="assets/wertis-logo.jpg"
        alt="WERTIS — sklep z częściami"
        className="anim-fadeUp w-[248px] max-w-[70%]"
      />

      <div className="mt-6 font-cond text-[13px] font-bold uppercase tracking-[0.14em] text-ink-mute">
        {starting ? "Uruchamianie…" : "Kto pracuje?"}
      </div>

      <div className="no-scrollbar mt-3 flex max-h-[46%] w-full max-w-[280px] flex-col gap-1.5 overflow-y-auto">
        {list.map((u) => (
          <button
            key={u}
            disabled={!!starting}
            onClick={() => start(u)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-all",
              u === current ? "border-amber bg-amber-bg-soft" : "hover:border-amber",
              starting && starting !== u && "opacity-40"
            )}
          >
            <UserRound className="h-4 w-4 flex-none text-ink-soft" />
            <span className="min-w-0 flex-1 truncate font-cond text-[15px] font-bold tracking-wide">{u}</span>
          </button>
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
              START
            </button>
          </form>
        ) : (
          <button
            disabled={!!starting}
            onClick={() => setAdding(true)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#C9C5BB] px-3 py-2.5 font-cond text-[13px] font-bold tracking-wide text-ink-soft transition-colors hover:border-amber"
          >
            <Plus className="h-4 w-4" /> NOWY UŻYTKOWNIK
          </button>
        )}
      </div>

      <div className="absolute bottom-4 text-center text-[11px] leading-tight text-ink-faint">
        Kolektor magazynowy · v{__APP_VERSION__}
        <br />
        build {__BUILD_TIME__}
      </div>
    </div>
  );
}
