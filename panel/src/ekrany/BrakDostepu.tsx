import { Lock } from "lucide-react";
import { Karta, Przycisk } from "../ui";

/* ── KONTO MAGAZYNIERA W BIURZE (0.431.0) ───────────────────────────────────
   Panel jest biurem, a biuro to role `biuro` i `admin`. Do tej wersji
   magazynier logował się bez przeszkód i dostawał puste kolumny, bo każda
   trasa odmawiała mu po cichu 403. Tu dostaje jedno zdanie: gdzie jest, czego
   nie ma i co zrobić. Bramka stoi w przeglądarce DLA CZŁOWIEKA — dane i tak
   chroni serwer przy każdej trasie. */
export function BrakDostepu({ login, rola, wyloguj }: { login: string; rola: string; wyloguj: () => void }) {
  return <div className="grid min-h-screen place-items-center bg-slate-100 p-5">
    <Karta className="w-full max-w-md p-6">
      <div className="flex items-center gap-3 text-slate-500"><Lock size={20} />
        <b className="text-naglowek text-slate-900">To konto nie ma dostępu do biura</b></div>
      <p className="text-tresc mt-3 text-slate-700">Zalogowano jako <b>{login}</b> ({rola}). Pracę na hali
        prowadzi kolektor; biuro otwiera konto z rolą biuro albo admin.</p>
      <Przycisk wariant="glowny" className="mt-5" onClick={wyloguj}>WYLOGUJ</Przycisk>
    </Karta>
  </div>;
}
