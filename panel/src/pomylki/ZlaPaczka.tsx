import React from "react";
import { PackageX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { adresPomylki, useNowaPomylka } from "../api/pomylki";

/* ── „ZŁA PACZKA" Z MIEJSCA, W KTÓRYM AGENT JĄ ROZPOZNAŁ ─────────────────────
   Klient pisze o złym towarze w rozmowie, w zwrocie albo agent widzi to na
   profilu. Przycisk zakłada pomyłkę z loginem i zamówieniem, które ekran już
   zna, i przenosi do jej wiersza. Agent nie przepisuje numeru zamówienia.

   ZAPIS TYLKO NA KLIKNIĘCIE. Przycisk nic nie czyta i nic nie wysyła przy
   otwarciu ekranu, na którym stoi. Ta sama paczka zgłoszona drugi raz trafia
   do istniejącej pomyłki, bo serwer zakłada jedną na zamówienie. */

export function ZlaPaczka({ login, zamowienie, konto, className = "" }: {
  login: string | null | undefined;
  zamowienie: string | null | undefined;
  konto?: number | null;
  className?: string;
}) {
  const nowa = useNowaPomylka();
  const nawiguj = useNavigate();
  if (!login || !zamowienie) return null;
  const blad = (nowa.error as Error | null)?.message;
  return <span className={`inline-flex items-center gap-2 ${className}`}>
    <button type="button" disabled={nowa.isPending}
      title="Klient dostał zły towar — załóż pomyłkę wysyłkową z tym zamówieniem"
      onClick={() => nowa.mutate({ login, zamowienie, ...(konto != null ? { konto } : {}) },
        { onSuccess: (d) => nawiguj(adresPomylki(d.pomylka.id, d.pomylka.zgloszono)) })}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      <PackageX size={14} aria-hidden="true" />{nowa.isPending ? "Zakładam…" : "Zła paczka"}</button>
    {blad && <span role="alert" className="text-xs text-ranga-zle">{blad}</span>}
  </span>;
}
