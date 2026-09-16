import { Tag } from "lucide-react";
import { useOutlet, usePrzeniesionoNaOutlet, zlote } from "../api/zwroty";
import { Przycisk, Blad } from "../ui";

/* ── Lista robocza regału outletowego (0.375.0) ─────────────────────────────
   Decyzja właściciela z 16 września 2026: „na razie będziemy obsługiwać outlet
   ręcznie". Magazyn outletowy stoi w Subiekcie, w aplikacji nie jest
   skonfigurowany, a regał jest jeden i oglądają go klienci stacjonarni.

   Ta lista jest WARUNKIEM, pod którym w ogóle weszła trzecia ocena. „Przecena"
   zeszła z ekranu w 0.209.0, bo kończyła się znacznikiem w bazie — a znacznik,
   którego nikt nie czyta, jest ślepym zaułkiem. Tutaj znacznik ma czytelnika:
   człowieka, który niesie używkę na regał i wystawia jej MM w Subiekcie.

   POKAZUJE SIĘ DOPIERO Z ZAWARTOŚCIĄ, jak pasek koszyka. Pusta byłaby stałym
   elementem mówiącym „zero", a dekalog każe pokazywać to, co potrzebne teraz.

   POTRĄCENIE STOI PRZY POZYCJI, bo to jest liczba, o którą przedmiot potaniał:
   oddaliśmy klientowi dokładnie tyle mniej. Kto wycenia regał, ma ją pod ręką
   zamiast szacować z pamięci.                                                */

export function NaOutlet() {
  const { data, error } = useOutlet();
  const przeniesiono = usePrzeniesionoNaOutlet();
  const pozycje = data?.pozycje ?? [];
  if (error) return <Blad>Nie wiem, co czeka na outlet: {(error as Error).message}</Blad>;
  if (pozycje.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3"
      aria-label="Na regał outletowy">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
        <Tag size={16} aria-hidden />
        Na regał outletowy · {pozycje.length}
        {/* Zdanie, nie sama liczba: aplikacja nie wystawia tu dokumentu i ma
            to powiedzieć wprost, zamiast pozwolić czekać na papier, który
            nie przyjdzie. */}
        <span className="font-normal text-slate-500">— przenosi i wystawia MM człowiek</span>
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {pozycje.map((p) => (
          <li key={p.pozycjaId}
            className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-1 text-xs">
            <span className="font-bold">{p.symbol ?? p.nazwa}</span>
            {p.symbol && <span className="text-slate-500">{p.nazwa}</span>}
            <span className="text-slate-500">{p.ilosc} szt.</span>
            <span className="text-slate-500">zwrot {p.numer}</span>
            {p.potracenieGrosze !== null && p.potracenieGrosze > 0 &&
              <span className="text-slate-500">potrącono {zlote(p.potracenieGrosze)}</span>}
            <Przycisk className="ml-auto text-xs"
              disabled={przeniesiono.isPending}
              onClick={() => przeniesiono.mutate({ pozycjaId: p.pozycjaId })}>
              Stoi na regale
            </Przycisk>
          </li>))}
      </ul>
      {przeniesiono.error &&
        <Blad>{(przeniesiono.error as Error).message}</Blad>}
    </section>
  );
}
