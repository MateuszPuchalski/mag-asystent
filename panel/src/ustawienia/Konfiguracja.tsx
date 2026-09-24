import React, { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useKonfiguracja, type WierszKonfiguracji, type ZrodloUstawienia } from "../api/ustawienia";
import { Blad, Przycisk } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Konfiguracja serwera (0.488.0) ─────────────────────────────────────
   Odpowiedź na „na czym ten serwer chodzi" bez pulpitu zdalnego na maszynie
   z Subiektem. Sam odczyt; zmiana dalej idzie przez `wertis.env`.

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

export function Konfiguracja({ admin }: { admin: boolean }) {
  const konf = useKonfiguracja(admin);
  const [wszystkie, setWszystkie] = useState(false);
  if (!admin) return null;

  const dane = konf.data;
  const wiersze = dane?.wiersze ?? [];
  const grupy = Object.keys(dane?.grupy ?? {});

  return <KartaWgladu id="karta-konfiguracja" tytul="Konfiguracja serwera"
    opis={<>Plik: <code>{dane?.plik ?? "nie znaleziono — działają wartości domyślne"}</code>. Zmianę
      wpisuje się w ten plik i restartuje usługi. Hasła i klucze są tu tylko jako „ustawione".</>}
    akcje={<>
      <Przycisk onClick={() => setWszystkie((x) => !x)}>
        <SlidersHorizontal size={16} />{wszystkie ? "Tylko ustawione" : `Wszystkie (${wiersze.length})`}
      </Przycisk>
    </>}>
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
            <Td>{wartosc(w)}</Td>
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
