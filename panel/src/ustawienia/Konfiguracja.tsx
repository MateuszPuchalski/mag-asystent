import React, { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  useKonfiguracja, useZmienUstawienie, type WierszKonfiguracji, type ZrodloUstawienia,
} from "../api/ustawienia";
import { Blad, Pole, Przycisk } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Konfiguracja serwera (0.488.0) ─────────────────────────────────────
   Odpowiedź na „na czym ten serwer chodzi" bez pulpitu zdalnego na maszynie
   z Subiektem. Od 0.491.0 decyzje właściciela zmienia się tu przyciskiem
   „Zmień"; resztę — klucze instalatora i pokrętła — dalej w pliku.

   ZMIANA TO JEDEN KLUCZ NA RAZ. Serwer sprawdza, czy wstanie z nowym
   plikiem, zapisuje go i restartuje się sam. Formularz całości kusiłby do
   zmiany pięciu rzeczy naraz, a odmowa jednej zatrzymałaby wszystkie.

   TYLKO ADMIN, i karta dla biura nie istnieje wcale, zamiast pokazywać
   odmowę. Przycisk czy karta, które NA PEWNO skończą się 403, to interakcja
   po nic (dekalog pkt 1) — ten sam wzór co przyciski w kartach kont.

   DOMYŚLNIE WIDAĆ TO, CO KTOŚ USTAWIŁ, plus decyzje właściciela. Sto
   trzydzieści wierszy z czego sto „domyślna" zasłoniłoby te kilkanaście,
   o które się pyta. Reszta jest pod jednym przełącznikiem, bez szukania. */

const ZRODLO: Record<ZrodloUstawienia, { etykieta: string; klasa: string }> = {
  plik: { etykieta: "z pliku", klasa: "bg-slate-100 text-slate-700" },
  /* Czerwone, bo to jest stan, który już raz położył wdrożenie: w pliku stoi
     jedno, a proces pracuje na czymś innym (`env-file.ts`). */
  przykryte: { etykieta: "przykryte przez usługę", klasa: "bg-red-100 text-ranga-zle font-bold" },
  srodowisko: { etykieta: "ze środowiska", klasa: "bg-slate-100 text-slate-700" },
  domyslna: { etykieta: "domyślna", klasa: "text-slate-500" },
};

function widoczny(w: WierszKonfiguracji, wszystkie: boolean): boolean {
  return wszystkie || w.zrodlo !== "domyslna" || w.kto === "wlasciciel";
}

function wartosc(w: WierszKonfiguracji): React.ReactNode {
  if (w.tajny) return w.zrodlo === "domyslna" ? "—" : <i className="text-slate-600">ustawione</i>;
  if (w.zrodlo === "domyslna") return "—";
  return w.wartosc === "" ? <i className="text-slate-600">puste</i> : <code className="break-all">{w.wartosc}</code>;
}

const maly = "!px-2.5 !py-1 !text-xs";

function Edytor({ w, onGotowe, onZamknij }: {
  w: WierszKonfiguracji; onGotowe: (zdanie: string) => void; onZamknij: () => void;
}) {
  const zmien = useZmienUstawienie();
  const e = w.edycja!;
  /* Sekret startuje pusty: serwer i tak go nie wysyła, a pusty zapis nie
     jest „wyczyść" — do tego jest „Domyślna". */
  const [v, setV] = useState(w.tajny ? "" : w.wartosc ?? (e.rodzaj === "wybor" ? e.opcje![0]! : ""));
  const wyslij = (wartosc: string | null) => zmien.mutate({ klucz: w.klucz, wartosc }, {
    onSuccess: (d) => onGotowe(d.restart === "sam"
      ? `${w.klucz} zapisany. Serwer wstaje ponownie z nowym plikiem — karta odświeży się za chwilę.`
      : `${w.klucz} zapisany w pliku. Zadziała po restarcie usług wertis-api i wertis-worker.`),
  });

  return <form aria-label={`Zmiana ${w.klucz}`} className="flex flex-wrap items-center gap-2"
    onSubmit={(ev) => { ev.preventDefault(); wyslij(v); }}>
    {e.rodzaj === "wybor"
      ? <select aria-label={w.klucz} className="field w-auto !py-1 text-xs" value={v} onChange={(x) => setV(x.target.value)}>
          {e.opcje!.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      : <Pole aria-label={w.klucz} autoFocus className="w-64 !py-1 text-xs"
          type={w.tajny ? "password" : "text"} autoComplete={w.tajny ? "new-password" : "off"}
          inputMode={e.rodzaj === "liczba" ? "numeric" : undefined}
          placeholder={e.rodzaj === "data" ? "2026-08-31T22:00:00Z" : w.tajny ? "nowa wartość" : ""}
          value={v} onChange={(x) => setV(x.target.value)} />}
    <Przycisk wariant="glowny" type="submit" className={maly}
      disabled={zmien.isPending || (w.tajny && v === "")}>Zapisz</Przycisk>
    {w.zrodlo !== "domyslna" && <Przycisk type="button" className={maly} disabled={zmien.isPending}
      onClick={() => wyslij(null)}>Domyślna</Przycisk>}
    <Przycisk type="button" className={maly} onClick={onZamknij}>Anuluj</Przycisk>
    {zmien.isPending && <span className="text-xs text-slate-600">Sprawdzam, czy serwer wstanie z tą zmianą…</span>}
    <Blad>{zmien.error?.message}</Blad>
  </form>;
}

export function Konfiguracja({ admin }: { admin: boolean }) {
  const konf = useKonfiguracja(admin);
  const [wszystkie, setWszystkie] = useState(false);
  const [edytowany, setEdytowany] = useState<string | null>(null);
  const [wynik, setWynik] = useState("");
  if (!admin) return null;

  const dane = konf.data;
  const wiersze = dane?.wiersze ?? [];
  const grupy = Object.keys(dane?.grupy ?? {});

  return <KartaWgladu id="karta-konfiguracja" tytul="Konfiguracja serwera"
    opis={<>Plik: <code>{dane?.plik ?? "nie znaleziono — działają wartości domyślne"}</code>. Decyzje
      właściciela zmienisz przyciskiem „Zmień"; resztę ustawia instalator. Hasła i klucze są tu tylko
      jako „ustawione".</>}
    akcje={<>
      <Przycisk onClick={() => setWszystkie((x) => !x)}>
        <SlidersHorizontal size={16} />{wszystkie ? "Tylko ustawione" : `Wszystkie (${wiersze.length})`}
      </Przycisk>
    </>}>
    {wynik && <p className="mb-3 text-sm text-ranga-ok">{wynik}</p>}
    {(dane?.nieznane.length ?? 0) > 0 && <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-ranga-zle">
      <b>Nieznane klucze w pliku:</b> {dane!.nieznane.join(", ")}. Żaden program ich nie czyta —
      to zwykle literówka, a wtedy działa wartość domyślna.
    </p>}
    {grupy.map((g) => {
      const wGrupie = wiersze.filter((w) => w.grupa === g && widoczny(w, wszystkie));
      if (!wGrupie.length) return null;
      return <section key={g} className="mb-4 last:mb-0">
        <h3 className="mb-1 text-sm font-bold text-slate-700">{dane!.grupy[g]}</h3>
        <Tabela naglowki={["Klucz", "Wartość", "Skąd", "Co ustawia"]} pusto="">
          {wGrupie.map((w) => <tr key={w.klucz}>
            <Td className="font-mono text-xs">{w.klucz}</Td>
            <Td>{edytowany === w.klucz
              ? <Edytor w={w} onZamknij={() => setEdytowany(null)}
                  onGotowe={(z) => { setWynik(z); setEdytowany(null); }} />
              : <div className="flex flex-wrap items-center gap-2">{wartosc(w)}
                  {w.edycja && <Przycisk className={maly}
                    onClick={() => { setEdytowany(w.klucz); setWynik(""); }}>Zmień</Przycisk>}</div>}</Td>
            <Td><span className={`rounded px-1.5 py-0.5 text-xs ${ZRODLO[w.zrodlo].klasa}`}>
              {ZRODLO[w.zrodlo].etykieta}</span></Td>
            <Td className="text-slate-600">{w.opis}</Td>
          </tr>)}
        </Tabela>
      </section>;
    })}
    <Blad>{konf.error?.message}</Blad>
  </KartaWgladu>;
}
