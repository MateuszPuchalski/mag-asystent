import React, { useState } from "react";
import { DatabaseZap, ImageOff } from "lucide-react";
import { useOdswiezZdjecia, useResync } from "../api/stan";
import type { Zdrowie } from "../api/typy";
import { Blad, Przycisk, dataLokalna } from "../ui";
import { KartaWgladu } from "../ui/wglad";
import { Potwierdz } from "../ui/Potwierdz";

/* ── Serwer (z `biuro.html`, 0.441.0) ───────────────────────────────────
   Wersja, źródło danych, worker i ślad audytowy — oraz dwie operacje
   ratunkowe, które do 0.111.0 żyły wyłącznie w DEPLOY.md jako polecenia curl.
   Odmowę roli wypowiada serwer (`ratunek_serwera`). RESYNC pyta, bo na
   produkcji to pełny import z Subiekta; odświeżenie zdjęć nie pyta, bo
   kasuje wyłącznie znaczniki „nie ma zdjęcia" i kolektory zapytają ponownie. */

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
        pytanie="Read-model przeładuje się z bazy Subiekta — na dużej kartotece to trwa." tak="Resync"
        trwa={resync.isPending} onTak={() => {
          setWynik(""); setBlad("");
          resync.mutate(undefined, {
            onSuccess: (d) => setWynik(`Resync zakończony (${JSON.stringify(d.stats ?? {}).slice(0, 80)}).`),
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
      {wiersz("plik konfiguracji", h.configZPliku ?? "—")}
      {wiersz("ślad audytowy", `${a?.zdarzen ?? 0} zdarzeń · od ${a?.najstarsze ? dataLokalna(a.najstarsze) : "—"} · baza ${bajty(a?.bazaBajtow)}`)}
      {(h.problemy ?? []).length > 0 && wiersz("do sprawdzenia", <ul className="space-y-1">
        {h.problemy!.map((p) => <li key={p}><span className="mr-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">uwaga</span>{p}</li>)}
      </ul>)}
    </tbody></table>}
  </KartaWgladu>;
}
