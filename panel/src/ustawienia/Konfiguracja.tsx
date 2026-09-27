import React, { useState } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import {
  useKonfiguracja, useZmienUstawienie, type WierszKonfiguracji, type ZrodloUstawienia,
} from "../api/ustawienia";
import { Blad, dataLokalna, odmien, Pole, Przycisk } from "../ui";
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
  if (w.zrodlo === "domyslna") return w.obowiazuje ? <code className="break-all">{w.obowiazuje}</code> : "—";
  return w.wartosc === "" ? <i className="text-slate-600">puste</i> : <code className="break-all">{w.wartosc}</code>;
}

/* ── Wartość słowem (@wydanie) ──────────────────────────────────────────
   Decyzja właściciela pokazuje to, na czym serwer pracuje, językiem biura:
   „7 dni", „wyłączony", data. Wcześniej przy domyślnej stała kreska, a
   liczbę znał tylko `config.ts`. Słowa dla wartości przychodzą z rejestru,
   bo rodzaj gramatyczny idzie za nazwą: szkic „wyłączony", rozpoznanie
   „wyłączone". Brak słowa to surowa wartość, nie zgadywanie. */
export function wartoscSlowem(w: WierszKonfiguracji): string {
  if (w.tajny) return w.zrodlo === "domyslna" ? "brak" : "ustawiony";
  const v = w.obowiazuje ?? w.wartosc;
  if (v === null || v === undefined) return "domyślna";
  const slowo = w.wartosci?.[v];
  if (slowo) return slowo;
  if ((w.rodzaj ?? w.edycja?.rodzaj) === "data") return v === "" ? "bez progu" : dataLokalna(v);
  if (v === "") return "puste";
  const n = Number(v);
  if (w.jednostka && Number.isFinite(n)) return `${v} ${odmien(n, ...w.jednostka)}`;
  return v;
}

const maly = "!px-2.5 !py-1 !text-xs";

function Edytor({ w, onGotowe, onZamknij }: {
  w: WierszKonfiguracji; onGotowe: (zdanie: string) => void; onZamknij: () => void;
}) {
  const zmien = useZmienUstawienie();
  const e = w.edycja!;
  /* Sekret startuje pusty: serwer i tak go nie wysyła, a pusty zapis nie
     jest „wyczyść" — do tego jest „Domyślna". */
  /* Start od wartości, która obowiązuje: zmiana terminu z 7 na 10 dni
     zaczyna się od „7", nie od pustego pola i szukania, ile było. */
  const [v, setV] = useState(w.tajny ? ""
    : w.wartosc ?? w.obowiazuje ?? (e.rodzaj === "wybor" ? e.opcje![0]! : ""));
  const nazwa = w.nazwa ?? w.klucz;
  const wyslij = (wartosc: string | null) => zmien.mutate({ klucz: w.klucz, wartosc }, {
    onSuccess: (d) => onGotowe(d.restart === "sam"
      ? `${nazwa}: zapisane. Serwer wstaje ponownie z nowym plikiem — karta odświeży się za chwilę.`
      : `${nazwa}: zapisane w pliku. Zadziała po restarcie usług wertis-api i wertis-worker.`),
  });

  return <form aria-label={`Zmiana ${nazwa}`} className="flex flex-wrap items-center gap-2"
    onSubmit={(ev) => { ev.preventDefault(); wyslij(v); }}>
    {e.rodzaj === "wybor"
      ? <select aria-label={nazwa} className="field w-auto !py-1 text-xs" value={v} onChange={(x) => setV(x.target.value)}>
          {e.opcje!.map((o) => <option key={o} value={o}>{w.wartosci?.[o] ?? o}</option>)}
        </select>
      : <Pole aria-label={nazwa} autoFocus className="w-64 !py-1 text-xs"
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

/* ── Gdzie mieszkają klucze właściciela (0.529.0) ──────────────────────
   Ustawienia są pogrupowane według tego, na co wpływają, a nie gdzie je
   zapisuje serwer. Termin zwrotu stoi przy zwrotach, a nie w konfiguracji
   serwera pod nazwą `ZWROT_TERMIN_DNI` — szukało się go tam, gdzie się
   o nim myśli, i nie znajdowało.

   Grupa rejestru bez miejsca tutaj ląduje w karcie zaawansowanej, razem
   z kluczami instalatora. Nowy klucz właściciela nie zniknie więc po cichu:
   najwyżej trafi na dno, dopóki ktoś nie dopisze go tutaj. */
export const MIEJSCE_KLUCZY: Record<string, "magazyn" | "obsluga" | "serwer"> = {
  magazyn: "magazyn", zdjecia: "magazyn",
  zwroty: "obsluga", allegro: "obsluga", copilot: "obsluga", sfera: "obsluga",
  serwer: "serwer",
};

const wlasciciela = (w: WierszKonfiguracji) => w.kto === "wlasciciel" && w.grupa in MIEJSCE_KLUCZY;

/** Tabela kluczy z „Zmień" przy każdym, który wolno zmienić z panelu. */
function TabelaKluczy({ wiersze, onWynik }: { wiersze: WierszKonfiguracji[]; onWynik: (z: string) => void }) {
  const [edytowany, setEdytowany] = useState<string | null>(null);
  return <Tabela naglowki={["Klucz", "Wartość", "Skąd", "Co ustawia"]} pusto="">
    {wiersze.map((w) => <tr key={w.klucz}>
      <Td className="font-mono text-xs">{w.klucz}</Td>
      <Td>{edytowany === w.klucz
        ? <Edytor w={w} onZamknij={() => setEdytowany(null)}
            onGotowe={(z) => { onWynik(z); setEdytowany(null); }} />
        : <div className="flex flex-wrap items-center gap-2">{wartosc(w)}
            {w.edycja && <Przycisk className={maly}
              onClick={() => { setEdytowany(w.klucz); onWynik(""); }}>Zmień</Przycisk>}</div>}</Td>
      <Td><span className={`rounded px-1.5 py-0.5 text-xs ${ZRODLO[w.zrodlo].klasa}`}>
        {ZRODLO[w.zrodlo].etykieta}</span></Td>
      <Td className="text-slate-600">{w.opis}</Td>
    </tr>)}
  </Tabela>;
}

/* ── Decyzje właściciela wierszami (@wydanie) ──────────────────────────
   Decyzja właściciela z 27 września 2026, wariant B z makiet: wiersz jak
   w ustawieniach telefonu. Nazwa i jedno zdanie z lewej, wartość, która
   obowiązuje, z prawej. Tabela z kluczem z pliku na czele i kreską zamiast
   liczby odpowiadała na pytanie instalatora, nie biura. Klucz zostaje w
   dymku nazwy, bo szuka się go przy awarii i w `wertis.env`.

   CAŁY WIERSZ JEST PRZYCISKIEM. Cel kliknięcia to wiersz, nie mały „Zmień"
   w środku kolumny (dekalog pkt 1 i 6). Wiersz, którego panel nie zmieni,
   nie udaje przycisku — mówi „w pliku" w miejscu strzałki.

   JEDEN OTWARTY NARAZ. Zmiana to jeden klucz na żądanie (nagłówek pliku),
   więc drugi formularz obok tylko by kusił. */
function WierszWlasciciela({ w, otwarty, komunikat, onPrzelacz, onZamknij, onWynik }: {
  w: WierszKonfiguracji; otwarty: boolean;
  /** Zdanie po zapisie — pod wierszem, który się zmieniło, nie na górze karty. */
  komunikat: string | null;
  onPrzelacz: () => void; onZamknij: () => void; onWynik: (z: string) => void;
}) {
  const zmienialny = w.edycja !== null;
  const tresc = <>
    <span className="flex min-w-0 flex-1 flex-col">
      <b title={w.klucz}>{w.nazwa ?? w.klucz}</b>
      <span className="text-sm text-slate-600">{w.opis}</span>
    </span>
    <span className="flex max-w-[45%] flex-col items-end text-right">
      <b className="break-all">{wartoscSlowem(w)}</b>
      {/* Źródło tylko wtedy, gdy mówi coś ponad „domyślna" przy wartości,
          która sama jest słowem „domyślna". */}
      {!(w.zrodlo === "domyslna" && w.obowiazuje == null && !w.tajny) &&
        <span className={`rounded px-1.5 text-xs ${ZRODLO[w.zrodlo].klasa}`}>{ZRODLO[w.zrodlo].etykieta}</span>}
    </span>
  </>;
  return <li>
    {zmienialny
      ? <button type="button" aria-expanded={otwarty} onClick={onPrzelacz}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
          {tresc}
          {otwarty ? <ChevronDown size={18} className="shrink-0 text-slate-600" aria-hidden />
            : <ChevronRight size={18} className="shrink-0 text-slate-600" aria-hidden />}
        </button>
      : <div className="flex min-h-12 items-center gap-3 px-4 py-2"
          title="Zmienia się w pliku wertis.env albo instalatorem.">
          {tresc}
          <span className="w-12 shrink-0 text-right text-xs text-slate-600">w pliku</span>
        </div>}
    {otwarty && <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <Edytor w={w} onZamknij={onZamknij} onGotowe={(z) => { onZamknij(); onWynik(z); }} />
      <p className="mt-2 text-xs text-slate-600">
        Serwer najpierw sprawdza, czy wstanie z nową wartością, i dopiero wtedy się restartuje.
      </p>
    </div>}
    {komunikat && <p role="status" className="px-4 pb-2.5 text-sm text-ranga-ok">{komunikat}</p>}
  </li>;
}

/** Klucze właściciela z podanych grup rejestru, jedna karta na grupę —
 *  osadzane w grupie ekranu ustawień, której dotyczą. Tylko admin, jak
 *  cała konfiguracja (nagłówek pliku). */
export function KluczeWlasciciela({ admin, grupy }: { admin: boolean; grupy: string[] }) {
  const konf = useKonfiguracja(admin);
  const [wynik, setWynik] = useState<{ klucz: string; zdanie: string } | null>(null);
  const [otwarty, setOtwarty] = useState<string | null>(null);
  if (!admin) return null;
  const dane = konf.data;
  const wiersze = (dane?.wiersze ?? []).filter(wlasciciela);
  return <>
    {grupy.map((g) => {
      const wGrupie = wiersze.filter((w) => w.grupa === g);
      if (!wGrupie.length) return null;
      return <KartaWgladu key={g} id={`karta-klucze-${g}`} tytul={dane!.grupy[g] ?? g}>
        <ul className="-m-4 divide-y divide-slate-100">
          {wGrupie.map((w) => <WierszWlasciciela key={w.klucz} w={w} otwarty={otwarty === w.klucz}
            komunikat={wynik?.klucz === w.klucz ? wynik.zdanie : null}
            onPrzelacz={() => { setOtwarty((o) => o === w.klucz ? null : w.klucz); setWynik(null); }}
            onZamknij={() => setOtwarty(null)}
            onWynik={(zdanie) => setWynik({ klucz: w.klucz, zdanie })} />)}
        </ul>
      </KartaWgladu>;
    })}
    {konf.error && <Blad>{konf.error.message}</Blad>}
  </>;
}

/** Zaawansowane: klucze instalatora, pokrętła i klucze właściciela z grup,
 *  które nie mają jeszcze miejsca w ekranie. Domyślnie tylko ustawione. */
export function Konfiguracja({ admin }: { admin: boolean }) {
  const konf = useKonfiguracja(admin);
  const [wszystkie, setWszystkie] = useState(false);
  const [wynik, setWynik] = useState("");
  if (!admin) return null;

  const dane = konf.data;
  const zaawansowane = (dane?.wiersze ?? []).filter((w) => !wlasciciela(w));
  const grupy = Object.keys(dane?.grupy ?? {});

  return <KartaWgladu id="karta-konfiguracja" tytul="Konfiguracja serwera"
    opis={<>Plik: <code>{dane?.plik ?? "nie znaleziono — działają wartości domyślne"}</code>. Klucze
      instalatora i zaawansowane — decyzje właściciela stoją w swoich grupach. Hasła i klucze są tu
      tylko jako „ustawione".</>}
    akcje={<>
      <Przycisk onClick={() => setWszystkie((x) => !x)}>
        <SlidersHorizontal size={16} />{wszystkie ? "Tylko ustawione" : `Wszystkie (${zaawansowane.length})`}
      </Przycisk>
    </>}>
    {wynik && <p className="mb-3 text-sm text-ranga-ok">{wynik}</p>}
    {(dane?.nieznane.length ?? 0) > 0 && <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-ranga-zle">
      <b>Nieznane klucze w pliku:</b> {dane!.nieznane.join(", ")}. Żaden program ich nie czyta —
      to zwykle literówka, a wtedy działa wartość domyślna.
    </p>}
    {grupy.map((g) => {
      const wGrupie = zaawansowane.filter((w) => w.grupa === g && widoczny(w, wszystkie));
      if (!wGrupie.length) return null;
      return <section key={g} className="mb-4 last:mb-0">
        <h3 className="mb-1 text-sm font-bold text-slate-700">{dane!.grupy[g]}</h3>
        <TabelaKluczy wiersze={wGrupie} onWynik={setWynik} />
      </section>;
    })}
    <Blad>{konf.error?.message}</Blad>
  </KartaWgladu>;
}
