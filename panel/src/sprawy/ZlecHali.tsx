import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { useNoweZadanie } from "../api/rozmowy";
import { Przycisk } from "../ui";

/* ── „ZLEĆ HALI" ZE SPRAWY (0.502.0) ────────────────────────────────────────
   Do tego wydania zlecić hali dało się tylko z rozmowy (pomiar). Zwrot,
   reklamacja i dyskusja kazały przejść do Zadań, przepisać sprawę
   w tytuł i wrócić — a zadanie nie wiedziało, skąd przyszło. Tu zlecenie
   niesie `zrodlo` i numer sprawy: karta zadania prowadzi z powrotem, wynik
   ze zwrotu staje na jego osi, a odesłanie — w Do zrobienia.

   HALA DOSTAJE ZDANIE, NIE DOSSIER (0.408.0): pole „co ma zrobić hala" jest
   obowiązkowe, a numer sprawy idzie w tytuł dla biura. Towar, gdy sprawa
   ma jeden znany, jedzie z zadaniem — magazynier szuka po półce, nie po
   numerze zwrotu.

   ZWIJKA, NIE FORMULARZ NA STAŁE: zlecenie hali to rzadki ruch przy sprawie,
   a stałe pole kosztowałoby miejsce przy każdym otwarciu (dekalog, pkt 2). */

/* Bez dostawy: ona ma „notatkę do hali" — powód w `zadania-terenowe.ts`. */
export type ZrodloZlecenia = "zwrot" | "reklamacja" | "dyskusja";

/** Jedna znana kartoteka sprawy albo `null` — przy kilku nie zgadujemy. */
export function jedynaKartoteka(twIds: Array<number | null>): number | null {
  const znane = [...new Set(twIds.filter((t): t is number => t !== null))];
  return znane.length === 1 ? znane[0] : null;
}

const RODZAJE: Array<{ id: string; etykieta: string }> = [
  { id: "zdjecie", etykieta: "zdjęcie" },
  { id: "weryfikacja", etykieta: "sprawdzenie" },
  { id: "pomiar", etykieta: "pomiar" },
  { id: "inne", etykieta: "inne" },
];

type Props = { zrodlo: ZrodloZlecenia; zrodloRef: number; tytul: string; twId?: number | null };

/* Hook mutacji żyje w FORMULARZU, nie w przycisku: sprawa otwiera się
   bez klienta zapytań w ręku (testy ekranów renderują kolumnę dowodów
   gołą), a zlecenie hali to rzadki ruch — nie ma powodu płacić za niego
   przy każdym otwarciu. */
export function ZlecHali(p: Props) {
  const [otwarte, setOtwarte] = useState(false);
  const [zlecone, setZlecone] = useState<number | null>(null);

  if (zlecone !== null && !otwarte) {
    return <p className="text-xs text-slate-700">
      Zlecono hali zadanie #{zlecone}.{" "}
      <Link to="/obsluga/zadania" className="font-semibold text-sky-800 underline underline-offset-2">Zadania</Link>
    </p>;
  }
  if (!otwarte) {
    return <Przycisk type="button" className="text-xs" onClick={() => setOtwarte(true)}>
      <ClipboardList size={14} />Zleć hali</Przycisk>;
  }
  return <Formularz {...p} onZamknij={() => setOtwarte(false)}
    onZlecono={(id) => { setZlecone(id); setOtwarte(false); }} />;
}

function Formularz({ zrodlo, zrodloRef, tytul, twId = null, onZamknij, onZlecono }: Props & {
  onZamknij: () => void; onZlecono: (id: number) => void;
}) {
  const [rodzaj, setRodzaj] = useState("zdjecie");
  const [instrukcja, setInstrukcja] = useState("");
  const [pilne, setPilne] = useState(false);
  const nowe = useNoweZadanie();
  return <form aria-label="Zlecenie dla hali" className="space-y-2 rounded-lg border border-slate-200 p-2 text-xs"
    onSubmit={(e) => {
      e.preventDefault();
      nowe.mutate({ rodzaj, tytul, instrukcja: instrukcja.trim(), twId, zrodlo,
        zrodloRef: String(zrodloRef), priorytet: pilne ? "pilny" : "normalny" },
      { onSuccess: (w) => onZlecono(w.zadanie.id) });
    }}>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1">rodzaj
        <select value={rodzaj} onChange={(e) => setRodzaj(e.target.value)}
          className="rounded border border-slate-300 px-1 py-0.5">
          {RODZAJE.map((r) => <option key={r.id} value={r.id}>{r.etykieta}</option>)}
        </select></label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={pilne} onChange={(e) => setPilne(e.target.checked)} />pilne</label>
    </div>
    <textarea aria-label="Co ma zrobić hala" required value={instrukcja}
      onChange={(e) => setInstrukcja(e.target.value)} rows={2}
      placeholder="Co ma zrobić hala — jedno zdanie"
      className="w-full rounded border border-slate-300 px-2 py-1" />
    {nowe.error && <p role="alert" className="text-ranga-zle">{(nowe.error as Error).message}</p>}
    <div className="flex gap-2">
      <Przycisk wariant="glowny" className="text-xs" type="submit"
        disabled={nowe.isPending || !instrukcja.trim()}>Zleć</Przycisk>
      {/* `type="button"`: `Przycisk` nie ma domyślnego typu, a w formularzu
          przycisk bez typu WYSYŁA go — „Anuluj" zleciłby zadanie. */}
      <Przycisk type="button" className="text-xs" onClick={onZamknij}>Anuluj</Przycisk>
    </div>
  </form>;
}
