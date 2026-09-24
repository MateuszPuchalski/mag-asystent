import React, { useState } from "react";
import { KeyRound, LogOut, Power, UserPlus, Users } from "lucide-react";
import {
  useAktywnosc, useKonta, useResetHasla, useSesje, useWylogujWszedzie, useZalozKonto,
  type Konto, type RolaKonta,
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

   Kont się tu nie kasuje: skasowane konto zostawiłoby dziennik bez autora.

   ZAKŁADA SIĘ JE TU OD 0.490.0. Wcześniej tylko kreator na kolektorze albo
   `curl` — czyli konto biura zakładał ktoś z kolektorem w ręku. Formularz
   widzi biuro i admin; biuro dostaje wyłącznie rolę magazyniera, bo konto
   biura albo admina serwer założy tylko adminowi (`zarzadzanie_biurem`).

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

/* Te same zasady co serwer (`bladDanych` w `routes/auth.ts`). Przycisk nie
   świeci, dopóki wiadomo, że żądanie skończy się odmową; resztę mówi serwer. */
const LOGIN = /^[a-z0-9._-]{3,32}$/;

function NowaOsoba({ role, onZamknij }: { role: RolaKonta[]; onZamknij: () => void }) {
  const zaloz = useZalozKonto();
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [haslo, setHaslo] = useState("");
  const [rola, setRola] = useState<RolaKonta>(role[0]!);
  const [wynik, setWynik] = useState("");
  const gotowe = name.trim() !== "" && LOGIN.test(login) && haslo.length >= HASLO_MIN;

  return <form aria-label="Nowa osoba" className="mt-4 rounded-lg border border-slate-200 p-3"
    onSubmit={(e) => {
      e.preventDefault();
      setWynik("");
      zaloz.mutate({ name: name.trim(), login, haslo, role: rola }, {
        onSuccess: (d) => {
          /* Hasła nie pokazujemy ani razu — wpisał je ten sam człowiek przed
             chwilą. Tak samo robi kreator na kolektorze. */
          setWynik(`Konto „${d.user.login}” założone — przekaż hasło osobiście.`);
          setName(""); setLogin(""); setHaslo("");
        },
      });
    }}>
    <h3 className="mb-2 text-sm font-bold">Nowa osoba</h3>
    <div className="flex flex-wrap items-end gap-2">
      <Pole aria-label="Imię i nazwisko" placeholder="Imię i nazwisko" className="w-48"
        value={name} onChange={(e) => setName(e.target.value)} />
      <Pole aria-label="Login" placeholder="login" autoComplete="off" className="w-36"
        value={login} onChange={(e) => setLogin(e.target.value.trim().toLowerCase())} />
      <Pole aria-label="Hasło" type="password" autoComplete="new-password" placeholder={`hasło, min. ${HASLO_MIN} znaków`}
        className="w-48" value={haslo} onChange={(e) => setHaslo(e.target.value)} />
      <select aria-label="Rola" className="field w-auto"
        value={rola} onChange={(e) => setRola(e.target.value as RolaKonta)}>
        {role.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <Przycisk wariant="glowny" type="submit" disabled={!gotowe || zaloz.isPending}>Załóż konto</Przycisk>
      <Przycisk type="button" onClick={onZamknij}>Zamknij</Przycisk>
    </div>
    <p className="mt-1 text-xs text-slate-600">Login: 3–32 znaki, małe litery, cyfry oraz . _ -</p>
    {wynik && <p className="mt-1 text-sm text-ranga-ok">{wynik}</p>}
    <Blad>{zaloz.error?.message}</Blad>
  </form>;
}

export function Konta({ admin, biuro = false }: { admin: boolean; biuro?: boolean }) {
  const konta = useKonta();
  const [sesjeDla, setSesjeDla] = useState<number | null>(null);
  const lista = konta.data?.users ?? [];
  const wybrane = lista.find((k) => k.userId === sesjeDla) ?? null;
  const [nowa, setNowa] = useState(false);
  const role: RolaKonta[] = admin ? ["magazynier", "biuro", "admin"] : biuro ? ["magazynier"] : [];

  return <KartaWgladu id="karta-konta" tytul="Konta i sesje"
    opis={admin
      ? "Reset nadaje nowe hasło, Wyłącz odbiera dostęp od zaraz. Sesje pokazują, co jest zalogowane; Wyloguj wszędzie to przycisk na zgubiony kolektor."
      : biuro
        ? "Konta magazynierów zakładasz tutaj. Reset hasła, wyłączenie konta i sesje są po stronie administratora."
        : "Konta zmienia administrator — reset hasła, wyłączenie konta i sesje są po jego stronie."}
    akcje={role.length > 0 && !nowa
      ? <Przycisk onClick={() => setNowa(true)}><UserPlus size={16} />Dodaj osobę</Przycisk>
      : <Users size={16} className="text-slate-500" aria-hidden />}>
    <Tabela naglowki={admin ? ["Osoba", "Login", "Rola", "Stan", ""] : ["Osoba", "Login", "Rola", "Stan"]}
      pusto="Brak kont.">
      {lista.map((k) => <WierszKonta key={k.userId} k={k} admin={admin} sesjeOtwarte={sesjeDla === k.userId}
        onSesje={() => setSesjeDla((s) => (s === k.userId ? null : k.userId))} />)}
    </Tabela>
    {nowa && role.length > 0 && <NowaOsoba role={role} onZamknij={() => setNowa(false)} />}
    {admin && wybrane && <Sesje k={wybrane} onZamknij={() => setSesjeDla(null)} />}
    <Blad>{konta.error?.message}</Blad>
  </KartaWgladu>;
}
