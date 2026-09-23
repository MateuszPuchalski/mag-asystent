import React, { useState } from "react";
import { KeyRound, LogOut, Power, Users } from "lucide-react";
import {
  useAktywnosc, useKonta, useResetHasla, useSesje, useWylogujWszedzie, type Konto,
} from "../api/ustawienia";
import { Blad, Pole, Przycisk, stempel } from "../ui";
import { Potwierdz } from "../ui/Potwierdz";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Konta i sesje (z `biuro.html` 0.111.0, 0.444.0) ────────────────────
   Do 0.111.0 reset hasła, wyłączenie konta i ucięcie sesji zgubionego
   kolektora żyły wyłącznie jako polecenia curl w DEPLOY.md.

   PRZYCISKI WIDZI TYLKO ADMIN. Biuro pokazywało je wszystkim i zostawiało
   odmowę serwerowi — bo strona nie znała roli. Panel ją zna (`useJa`), a
   przycisk, który NA PEWNO skończy się odmową, to interakcja po nic (dekalog
   pkt 1). Serwer odmawia dalej (`zarzadzanie_biurem`); ekran tylko nie
   zaprasza do próby. Ten sam wzór co karta Allegro w stanie systemu.

   Kont się tu nie zakłada i nie kasuje. Zakłada je kreator na kolektorze
   (`POST /api/users`), a skasowane konto zostawiłoby dziennik bez autora.

   HASŁO W POLU `password`, nie w okienku przeglądarki. Biuro pytało przez
   `prompt()`, który pokazuje wpisywany tekst każdemu za plecami. */

const HASLO_MIN = 8;

function WierszKonta({ k, admin, sesjeOtwarte, onSesje }: {
  k: Konto; admin: boolean; sesjeOtwarte: boolean; onSesje: () => void;
}) {
  const aktywnosc = useAktywnosc();
  const reset = useResetHasla();
  const [haslo, setHaslo] = useState<string | null>(null);
  const [wynik, setWynik] = useState("");
  const maly = "!px-2.5 !py-1 !text-xs";

  return <tr className={k.active ? "" : "text-slate-500"}>
    <Td className="font-semibold">{k.name}</Td>
    <Td className="text-slate-600">{k.login ?? "—"}</Td>
    <Td>{k.role}</Td>
    <Td>{k.active
      ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">aktywne</span>
      : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600">wyłączone</span>}</Td>
    {admin && <Td>
      <div className="flex flex-wrap items-center gap-2">
        <Przycisk className={maly} aria-pressed={sesjeOtwarte} onClick={onSesje}>Sesje</Przycisk>
        {haslo === null
          ? <Przycisk className={maly} onClick={() => { setHaslo(""); setWynik(""); }}><KeyRound size={14} />Reset hasła</Przycisk>
          : <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
              e.preventDefault();
              reset.mutate({ userId: k.userId, haslo }, {
                onSuccess: () => { setHaslo(null); setWynik("Hasło ustawione — przekaż je osobie bezpośrednio."); },
              });
            }}>
              <Pole type="password" autoComplete="new-password" autoFocus className="w-40 !py-1 text-xs"
                aria-label={`Nowe hasło dla ${k.name}`} placeholder={`min. ${HASLO_MIN} znaków`}
                value={haslo} onChange={(e) => setHaslo(e.target.value)} />
              <Przycisk wariant="glowny" type="submit" className={maly}
                disabled={haslo.length < HASLO_MIN || reset.isPending}>Ustaw</Przycisk>
              <Przycisk type="button" className={maly} onClick={() => setHaslo(null)}>Anuluj</Przycisk>
            </form>}
        {k.active
          ? <Potwierdz maly etykieta={<><Power size={14} />Wyłącz</>}
              pytanie="Konto straci dostęp od zaraz." tak="Wyłącz konto" trwa={aktywnosc.isPending}
              onTak={() => aktywnosc.mutate({ userId: k.userId, active: false })} />
          : <Przycisk className={maly} disabled={aktywnosc.isPending}
              onClick={() => aktywnosc.mutate({ userId: k.userId, active: true })}><Power size={14} />Włącz</Przycisk>}
      </div>
      {wynik && <p className="mt-1 text-xs text-ranga-ok">{wynik}</p>}
      <Blad>{reset.error?.message || aktywnosc.error?.message}</Blad>
    </Td>}
  </tr>;
}

function Sesje({ k, onZamknij }: { k: Konto; onZamknij: () => void }) {
  const sesje = useSesje(k.userId);
  const wyloguj = useWylogujWszedzie();
  const [wynik, setWynik] = useState("");
  const lista = sesje.data?.sesje ?? [];

  return <section aria-label={`Sesje: ${k.name}`} className="mt-4 rounded-lg border border-slate-200 p-3">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h3 className="mr-auto text-sm font-bold">Sesje · {k.name}</h3>
      {/* Cięcie własnego konta wylogowuje też tę przeglądarkę — pytanie mówi
          to, zanim ekran wróci do logowania. */}
      <Potwierdz maly etykieta={<><LogOut size={14} />Wyloguj wszędzie</>}
        pytanie="Wszystkie sesje konta zostaną ucięte — także ta, jeśli to Twoje konto." tak="Wyloguj"
        trwa={wyloguj.isPending}
        onTak={() => wyloguj.mutate(k.userId, { onSuccess: (d) => setWynik(`Ucięto sesji: ${d.sesji}.`) })} />
      <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={onZamknij}>Zamknij</Przycisk>
    </div>
    {wynik && <p className="mb-2 text-sm text-ranga-ok">{wynik}</p>}
    <Tabela naglowki={["Urządzenie", "Zalogowano", "Ostatnio widziane"]} pusto="Brak czynnych sesji.">
      {lista.map((s, i) => <tr key={`${s.deviceId}-${s.createdAt}-${i}`}>
        <Td className="font-semibold">{s.deviceId ?? "—"}</Td>
        <Td className="text-slate-600">{stempel(s.createdAt)}</Td>
        <Td className="text-slate-600">{s.lastSeen ? stempel(s.lastSeen) : "—"}</Td>
      </tr>)}
    </Tabela>
    <Blad>{sesje.error?.message || wyloguj.error?.message}</Blad>
  </section>;
}

export function Konta({ admin }: { admin: boolean }) {
  const konta = useKonta();
  const [sesjeDla, setSesjeDla] = useState<number | null>(null);
  const lista = konta.data?.users ?? [];
  const wybrane = lista.find((k) => k.userId === sesjeDla) ?? null;

  return <KartaWgladu id="karta-konta" tytul="Konta i sesje"
    opis={admin
      ? "Reset nadaje nowe hasło, Wyłącz odbiera dostęp od zaraz. Sesje pokazują, co jest zalogowane; Wyloguj wszędzie to przycisk na zgubiony kolektor."
      : "Konta zmienia administrator — reset hasła, wyłączenie konta i sesje są po jego stronie."}
    akcje={<Users size={16} className="text-slate-500" aria-hidden />}>
    <Tabela naglowki={admin ? ["Osoba", "Login", "Rola", "Stan", ""] : ["Osoba", "Login", "Rola", "Stan"]}
      pusto="Brak kont.">
      {lista.map((k) => <WierszKonta key={k.userId} k={k} admin={admin} sesjeOtwarte={sesjeDla === k.userId}
        onSesje={() => setSesjeDla((s) => (s === k.userId ? null : k.userId))} />)}
    </Tabela>
    {admin && wybrane && <Sesje k={wybrane} onZamknij={() => setSesjeDla(null)} />}
    <Blad>{konta.error?.message}</Blad>
  </KartaWgladu>;
}
