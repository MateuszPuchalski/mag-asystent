import React, { useState } from "react";
import { DatabaseZap, ImageOff } from "lucide-react";
import { useOdswiezZdjecia, useResync } from "../api/stan";
import type { Zdrowie } from "../api/typy";
import { Blad, Przycisk, dataLokalna, ile } from "../ui";
import { KartaWgladu } from "../ui/wglad";
import { Potwierdz } from "../ui/Potwierdz";

/* ── Serwer (z `biuro.html`, 0.441.0) ───────────────────────────────────
   Wersja, źródło danych, worker i ślad audytowy — oraz dwie operacje
   ratunkowe, które do 0.111.0 żyły wyłącznie w DEPLOY.md jako polecenia curl.
   Odmowę roli wypowiada serwer (`ratunek_serwera`). RESYNC pyta, bo na
   produkcji to pełny import z Subiekta; odświeżenie zdjęć nie pyta, bo
   kasuje wyłącznie znaczniki „nie ma zdjęcia" i kolektory zapytają ponownie.

   KAŻDY FAKT RAZ (0.509.0). Plik konfiguracji zszedł stąd, bo stoi
   w opisie karty „Konfiguracja serwera" za zębatką, a zmienić go może
   tylko admin, który tam właśnie patrzy. Wersja ZOSTAJE, choć mówi ją też
   karta aktualizacji: tamta jest wyłącznie adminowa, a biuro zgłaszające
   „coś nie działa" patrzy tutaj i nigdzie indziej jej nie zobaczy. */

/** Wynik resyncu zdaniem, nie zrzutem JSON-a: dwie liczby, po których
 *  człowiek poznaje, że wczytało się tyle, ile się spodziewał. */
export function zdanieResyncu(stats: Record<string, unknown> | undefined): string {
  const towary = Number(stats?.towary);
  const dokumenty = Number(stats?.dokumenty);
  if (!Number.isFinite(towary) || !Number.isFinite(dokumenty)) return "Resync zakończony.";
  return `Resync zakończony: wczytano ${ile(towary, "kartotekę", "kartoteki", "kartotek")} i ${
    ile(dokumenty, "dokument", "dokumenty", "dokumentów")}.`;
}

function bajty(n: number | undefined): string {
  if (!n) return "—";
  const mb = n / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace(".", ",")} MB` : `${Math.round(n / 1024)} kB`;
}

export function KartaSerwera({ zdrowie }: { zdrowie: Zdrowie | undefined }) {
  const resync = useResync();
  const zdjecia = useOdswiezZdjecia();
  const [wynik, setWynik] = useState("");
  const [blad, setBlad] = useState("");
  const h = zdrowie;
  const w = h?.worker;
  const a = h?.audyt;

  const wiersz = (k: string, v: React.ReactNode) =>
    <tr key={k}><td className="w-48 py-1.5 pr-3 align-top text-slate-600">{k}</td><td className="py-1.5">{v}</td></tr>;

  return <KartaWgladu id="karta-serwer" tytul="Serwer"
    akcje={<>
      <Potwierdz etykieta={<><DatabaseZap size={16} />Pełny resync z Subiekta</>}
        pytanie="Kartoteki i stany wczytają się od nowa z bazy Subiekta — na dużej kartotece to trwa." tak="Resync"
        trwa={resync.isPending} onTak={() => {
          setWynik(""); setBlad("");
          resync.mutate(undefined, {
            onSuccess: (d) => setWynik(zdanieResyncu(d.stats)),
            onError: (e) => setBlad(e.message),
          });
        }} />
      <Przycisk disabled={zdjecia.isPending} onClick={() => {
        setWynik(""); setBlad("");
        zdjecia.mutate(undefined, {
          onSuccess: (d) => setWynik(`Zapomniano ${d.zapomniano ?? 0} braków — kolektory zapytają o zdjęcia ponownie.`),
          onError: (e) => setBlad(e.message),
        });
      }}><ImageOff size={16} />Odśwież brakujące zdjęcia</Przycisk>
    </>}>
    {wynik && <p className="mb-2 text-sm text-ranga-ok">{wynik}</p>}
    <Blad>{blad}</Blad>
    {h && <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
      {wiersz("wersja serwera", h.wersja ?? "—")}
      {wiersz("źródło danych", <>{h.mode ?? "—"}{h.mode === "seeded" &&
        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">demo</span>}</>)}
      {wiersz("worker Sfery", w?.zyje
        ? <><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">pracuje</span>
            {w.widziany && <span className="ml-2 text-slate-600">{w.widziany}</span>}</>
        : <><span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">nie żyje</span> — zapisy do Subiekta NIE wchodzą</>)}
      {wiersz("ślad audytowy", `${a?.zdarzen ?? 0} zdarzeń · od ${a?.najstarsze ? dataLokalna(a.najstarsze) : "—"} · baza ${bajty(a?.bazaBajtow)}`)}
      {/* Kopie robi serwer sam (0.487.0), więc tu biuro widzi, że je robi.
          Zaległość i błąd przychodzą osobno, zdaniem w „do sprawdzenia". */}
      {wiersz("kopie bazy", h.kopie
        ? `nocna ${h.kopie.nocna ? dataLokalna(h.kopie.nocna) : "jeszcze nie było"} · przed aktualizacją ${
            h.kopie.przedAktualizacja ? dataLokalna(h.kopie.przedAktualizacja) : "—"}`
        : "—")}
      {(h.problemy ?? []).length > 0 && wiersz("do sprawdzenia", <ul className="space-y-1">
        {h.problemy!.map((p) => <li key={p}><span className="mr-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">uwaga</span>{p}</li>)}
      </ul>)}
    </tbody></table>}
  </KartaWgladu>;
}
