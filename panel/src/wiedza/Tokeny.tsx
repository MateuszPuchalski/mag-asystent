import React, { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import type { KartotekaTokenu, TokenSilnika } from "../api/typy";
import { useDodajToken, useRozstrzygnijToken, useTokenySilnikow, useUsunToken } from "../api/wiedza";
import { Blad, Pole, Przycisk } from "../ui";
import { PolaModelu, type DaneModelu } from "./PolaModelu";
import { Kafel } from "../towar/Kafel";

/**
 * Tokeny silników w nazwach kartotek (0.239.0) — drugi słownik, obok aliasów
 * pola „Silnik". Biuro wpisuje słowo („GX160") i model silnika; serwer
 * dopasowuje słowo do NAZW kartotek (nigdy do opisów — opis bywa notatką
 * i mówi też „nie pasuje do…"). Lista kartotek to podgląd decyzji człowieka,
 * nie propozycja automatu: automat nie zgaduje marki z tokenu (0.186.0).
 *
 * JEDNO KLIKNIĘCIE ZATWIERDZA ZAZNACZONE (decyzja właściciela). Zaznaczone
 * dostają zatwierdzone zastosowanie do silnika, odznaczone idą do pominiętych
 * i nie wracają po imporcie. Propozycję i rozstrzygnięcie robi ten sam
 * człowiek w jednej transakcji — wolno, bo „zatwierdza każdy z biura, także
 * autor"; nowe jest tylko to, że dwa zapisy idą za jednym kliknięciem.
 */
export function Tokeny() {
  const lista = useTokenySilnikow();
  const dodaj = useDodajToken();
  const rozstrzygnij = useRozstrzygnijToken();
  const usun = useUsunToken();
  const [blad, setBlad] = useState("");
  const [ostatnie, setOstatnie] = useState("");
  const tokeny = lista.data?.tokeny ?? [];
  const trwa = dodaj.isPending || rozstrzygnij.isPending || usun.isPending;

  return <section className="mt-6 space-y-3 border-t pt-4" aria-label="Tokeny silników w nazwach kartotek">
    <h3 className="flex items-center gap-2 text-naglowek font-bold"><Tag size={16} /> Tokeny silników w nazwach kartotek</h3>
    <p className="text-xs text-slate-500">
      Słowo z nazwy kartoteki i silnik, który ono oznacza — np. „GX160” to Honda GX160.
      Kartoteki z tym słowem w nazwie czekają niżej: odznacz te, które nie pasują, i zatwierdź resztę.
      Zatwierdzone stają się zastosowaniami do silnika, odznaczone nie wracają po imporcie.
    </p>
    <Blad>{blad || (lista.error as Error | null)?.message}</Blad>
    {ostatnie && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{ostatnie}</p>}
    {!lista.isLoading && tokeny.length === 0 &&
      <p className="text-sm text-slate-500">Słownik jest pusty. Dodaj pierwszy token, a lista kartotek ułoży się sama.</p>}
    <ul className="space-y-3">
      {tokeny.map((t) => <Token key={t.id} t={t} trwa={trwa}
        onRozstrzygnij={(zatwierdz, pomin) => { setBlad(""); setOstatnie("");
          rozstrzygnij.mutate({ id: t.id, zatwierdz, pomin }, {
            onSuccess: (w) => setOstatnie(`Token „${t.token}”: zatwierdzono ${w.zatwierdzonych}` +
              (w.juzBylo ? ` (w tym ${w.juzBylo} już było)` : "") + `, pominięto ${w.pominietych}.`),
            onError: (e) => setBlad((e as Error).message),
          }); }}
        onUsun={() => { setBlad(""); setOstatnie("");
          usun.mutate({ id: t.id }, { onError: (e) => setBlad((e as Error).message) }); }} />)}
    </ul>
    <NowyToken trwa={dodaj.isPending}
      onDodaj={(v) => { setBlad(""); setOstatnie("");
        dodaj.mutate(v, {
          onSuccess: (t) => setOstatnie(`Token „${t.token}” = ${t.silnik.etykieta}: ${t.nowych} kartotek do przejrzenia.`),
          onError: (e) => setBlad((e as Error).message),
        }); }} />
  </section>;
}

function Token({ t, trwa, onRozstrzygnij, onUsun }: {
  t: TokenSilnika; trwa: boolean;
  onRozstrzygnij: (zatwierdz: number[], pomin: number[]) => void;
  onUsun: () => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  /* STAN TRZYMA ODZNACZONE, nie zaznaczone — wzór z pozycji zwrotu: kopia
     listy zaznaczonych gniła przy każdej zmianie listy (nowa kartoteka po
     imporcie wchodziłaby odznaczona i po cichu wypadała z zatwierdzenia). */
  const [odznaczone, setOdznaczone] = useState<ReadonlySet<number>>(() => new Set());
  const zaznaczone = useMemo(() => t.nowe.filter((k) => !odznaczone.has(k.twId)), [t.nowe, odznaczone]);
  const przelacz = (twId: number) => setOdznaczone((w) => {
    const n = new Set(w);
    if (!n.delete(twId)) n.add(twId);
    return n;
  });

  return <li className="rounded-lg border border-slate-200 p-3" aria-label={`Token: ${t.token}`}>
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <b className="font-mono">„{t.token}”</b>
      <span className="text-sm text-slate-700">= {t.silnik.etykieta}</span>
      <span className="text-xs text-slate-500">
        nowych {t.nowych} · zatwierdzonych {t.zatwierdzonych} · pominiętych {t.pominietych} · {t.dodal}
      </span>
      <span className="ml-auto flex gap-2">
        {t.nowych > 0 && <Przycisk className="text-xs" onClick={() => setOtwarte((o) => !o)}>
          {otwarte ? "Zwiń" : `Przejrzyj (${t.nowych})`}</Przycisk>}
        {/* Usunięcie tokenu NIE cofa zastosowań — to fakty z dowodem, cofa się
            je osobno przez wycofanie. Token to tylko klucz do listy. */}
        <Przycisk className="text-xs" disabled={trwa} onClick={onUsun}>Usuń</Przycisk>
      </span>
    </div>
    {otwarte && t.nowe.length > 0 && <div className="mt-3 space-y-2">
      {t.nowych > t.nowe.length && <p className="text-xs text-slate-500">
        Pokazuję {t.nowe.length} z {t.nowych} — reszta po przejrzeniu tych.</p>}
      <ul className="space-y-1">
        {t.nowe.map((k) => <Kartoteka key={k.twId} k={k} zaznaczona={!odznaczone.has(k.twId)}
          onPrzelacz={() => przelacz(k.twId)} />)}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={trwa || (zaznaczone.length === 0 && odznaczone.size === 0)}
          onClick={() => {
            onRozstrzygnij(zaznaczone.map((k) => k.twId), t.nowe.filter((k) => odznaczone.has(k.twId)).map((k) => k.twId));
            setOdznaczone(new Set());
          }}>Zatwierdź zaznaczone ({zaznaczone.length})</Przycisk>
        {odznaczone.size > 0 && <span className="text-xs text-slate-500">
          odznaczone ({odznaczone.size}) zostaną pominięte i nie wrócą po imporcie</span>}
      </div>
    </div>}
  </li>;
}

function Kartoteka({ k, zaznaczona, onPrzelacz }: { k: KartotekaTokenu; zaznaczona: boolean; onPrzelacz: () => void }) {
  return <li className="flex items-center gap-3 rounded-lg bg-slate-50 p-2">
    {/* Pole zaznaczenia PRZED zdjęciem, w jednej kolumnie dla całej listy:
        odhaczanie idzie w dół jednym ruchem oka. */}
    <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`Pasuje: ${k.nazwa ?? k.symbol}`}
      checked={zaznaczona} onChange={onPrzelacz} />
    <Kafel twId={k.twId} rozmiar={40} nazwa={k.nazwa ?? k.symbol} symbol={k.symbol} />
    <div className="min-w-0 flex-1">
      <b className="block truncate text-tresc">{k.nazwa ?? k.symbol}</b>
      <span className="font-mono text-xs text-slate-500">{k.symbol}</span>
    </div>
  </li>;
}

type NowyTokenSilnika = Parameters<ReturnType<typeof useDodajToken>["mutate"]>[0];

/** Formularz tokenu: słowo + model silnika. Rodzaj zablokowany na „silnik". */
function NowyToken({ trwa, onDodaj }: { trwa: boolean; onDodaj: (v: NowyTokenSilnika) => void }) {
  const [otwarte, setOtwarte] = useState(false);
  const [token, setToken] = useState("");
  const [silnik, setSilnik] = useState<DaneModelu>({ rodzaj: "silnik", marka: "", nazwa: "", wariant: "" });
  /* Trzy znaki po zwinięciu pilnuje serwer; tu tylko puste pola trzymają przycisk. */
  const gotowe = Boolean(token.trim() && silnik.marka.trim() && silnik.nazwa.trim());
  /* Zwinięty jak „Dodaj alias": słownik rośnie rzadko, a lista kartotek
     do przejrzenia ma być pierwszym, co widać. */
  if (!otwarte) return <Przycisk wariant="drugi" onClick={() => setOtwarte(true)}>Dodaj token</Przycisk>;
  return <form className="space-y-2 rounded-lg border p-3" aria-label="Dodaj token silnika"
    onSubmit={(e) => {
      e.preventDefault();
      if (!gotowe) return;
      onDodaj({ token: token.trim(), silnik: { rodzaj: "silnik", marka: silnik.marka.trim(),
        nazwa: silnik.nazwa.trim(), wariant: silnik.wariant.trim() || null } });
      setToken(""); setSilnik({ rodzaj: "silnik", marka: "", nazwa: "", wariant: "" }); setOtwarte(false);
    }}>
    <Pole aria-label="Słowo w nazwie kartoteki" value={token} placeholder="Słowo z nazwy kartoteki, np. GX160"
      onChange={(e) => setToken(e.target.value)} />
    <PolaModelu dane={silnik} onZmiana={setSilnik} zwarte rodzajStaly />
    <Przycisk type="submit" disabled={trwa || !gotowe}>Dodaj token</Przycisk>
  </form>;
}
