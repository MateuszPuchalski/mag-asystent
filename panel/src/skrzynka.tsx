import React, { useEffect, useState } from "react";
import { AlertTriangle, Inbox, RefreshCw, Ruler, Send } from "lucide-react";

/* Ekran skrzynki jest CZYTELNIKIEM zsynchronizowanego magazynu, nie klientem
   Allegro. Dlatego pokazuje moment ostatniej udanej synchronizacji: pusta lista
   o 9:00 znaczy co innego, gdy synchronizator stanął o 6:00, a co innego, gdy
   przebiegł minutę temu. Bez tej daty ekran kłamałby ciszą. */

type Rozmowa = { id: string; klient: string; ostatniaWiadomosc: string; ostatniaWiadomoscAt: string; nieprzeczytana: boolean };
type WpisOsi = { id: string; rodzaj: "wiadomosc" | "wynik_zadania"; autor: string; odKlienta: boolean; tresc: string; at: string; ofertaId: string | null; zadanieId?: number };
type Stan = { ostatniaSynchronizacja: string | null; bledy: number };

const czas = (v: string) => (v ? new Date(v).toLocaleString("pl") : "—");

export function Skrzynka({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [rozmowy, setRozmowy] = useState<Rozmowa[]>([]);
  const [stan, setStan] = useState<Stan>({ ostatniaSynchronizacja: null, bledy: 0 });
  const [wybrana, setWybrana] = useState<string | null>(null);
  const [os, setOs] = useState<WpisOsi[]>([]);
  const [szkic, setSzkic] = useState("");
  const [zrodlo, setZrodlo] = useState<string | null>(null);
  const [wskazowka, setWskazowka] = useState("");
  const [err, setErr] = useState("");
  const [laduje, setLaduje] = useState(true);

  async function wczytaj() {
    try {
      const d = await api("/api/obsluga/rozmowy");
      setRozmowy(d.rozmowy); setStan(d.stan); setErr("");
    } catch (x) { setErr((x as Error).message); } finally { setLaduje(false); }
  }
  useEffect(() => { wczytaj(); const t = setInterval(wczytaj, 20000); return () => clearInterval(t); }, []);

  async function otworz(id: string) {
    setWybrana(id); setSzkic(""); setZrodlo(null); setWskazowka("");
    /* Adres ma dać się wkleić koledze. Historia zamiast przeładowania, bo
       przeładowanie gubi szkic odpowiedzi, którego nikt jeszcze nie wysłał. */
    history.replaceState(null, "", `/obsluga/skrzynka?rozmowa=${encodeURIComponent(id)}`);
    try { const d = await api(`/api/obsluga/rozmowy/${encodeURIComponent(id)}`); setOs(d.os); }
    catch (x) { setErr((x as Error).message); }
  }

  async function zlec() {
    if (!wybrana || !zrodlo) return;
    try {
      await api("/api/obsluga/zadania/pomiar", { method: "POST", body: JSON.stringify({ rozmowaId: wybrana, wiadomoscId: zrodlo, instrukcja: wskazowka }) });
      setWskazowka(""); setZrodlo(null); otworz(wybrana);
    } catch (x) { setErr((x as Error).message); }
  }

  const bezOferty = os.some((w) => w.rodzaj === "wiadomosc" && w.odKlienta && !w.ofertaId);

  return <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
    <section className="card flex max-h-[75vh] flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b p-4">
        <Inbox size={18} /><b className="mr-auto">Rozmowy</b>
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={wczytaj} title="Odśwież"><RefreshCw size={16} /></button>
      </header>
      <p className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-500">
        Ostatnia synchronizacja: {czas(stan.ostatniaSynchronizacja ?? "")}
        {stan.bledy > 0 && <span className="ml-2 font-bold text-amber-700">błędów: {stan.bledy}</span>}
      </p>
      <div className="flex-1 overflow-y-auto">
        {laduje && <p className="p-4 text-sm text-slate-500">Wczytuję…</p>}
        {!laduje && !rozmowy.length && <p className="p-4 text-sm text-slate-500">Brak rozmów w zsynchronizowanej skrzynce.</p>}
        {rozmowy.map((r) => <button key={r.id} onClick={() => otworz(r.id)}
          className={`block w-full border-b p-4 text-left hover:bg-slate-50 ${wybrana === r.id ? "bg-amber-50" : ""}`}>
          <div className="flex items-center gap-2">
            <b className="truncate">{r.klient}</b>
            {r.nieprzeczytana && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold">NOWE</span>}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.ostatniaWiadomosc}</p>
          <p className="mt-1 text-xs text-slate-400">{czas(r.ostatniaWiadomoscAt)}</p>
        </button>)}
      </div>
    </section>

    <section className="card flex max-h-[75vh] flex-col overflow-hidden">
      {!wybrana && <div className="grid flex-1 place-items-center p-16 text-slate-500"><Inbox size={38} /><p className="mt-3 font-semibold">Wybierz rozmowę z listy</p></div>}
      {wybrana && <>
        {bezOferty && <p className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} />Brak powiązania z ofertą — hala nie dostanie numeru kartoteki.</p>}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {os.map((w) => w.rodzaj === "wynik_zadania"
            ? <article key={w.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs font-bold uppercase text-emerald-700">Wynik z magazynu · {w.autor}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
                <button className="btn-secondary mt-2 text-xs" onClick={() => setSzkic((s) => (s ? s + "\n" : "") + w.tresc)}>Wstaw wynik do szkicu</button>
              </article>
            : <article key={w.id} className={`rounded-lg border p-3 ${w.odKlienta ? "bg-white" : "bg-slate-50"}`}>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <b>{w.autor}</b>{w.ofertaId && <span>· oferta {w.ofertaId}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
                {w.odKlienta && <button className={`mt-2 text-xs font-bold ${zrodlo === w.id ? "text-amber-700" : "text-slate-500"}`}
                  onClick={() => setZrodlo(zrodlo === w.id ? null : w.id)}>
                  {zrodlo === w.id ? "✓ źródło pomiaru" : "Zleć z tej wiadomości"}</button>}
              </article>)}
        </div>
        {zrodlo && <div className="border-t bg-amber-50 p-4">
          <label className="block text-sm font-semibold">Wskazówka dla hali <span className="font-normal text-slate-500">(opcjonalnie)</span>
            <input className="field mt-1" value={wskazowka} onChange={(e) => setWskazowka(e.target.value)} placeholder="Np. podaj wynik w milimetrach" /></label>
          <button className="btn-primary mt-3" onClick={zlec}><Ruler size={16} />ZLEĆ POMIAR</button>
        </div>}
        <div className="border-t p-4">
          {/* Wysyłka do Allegro jest wyłączona w tym wydaniu: szkic zostaje
              lokalny, dopóki polityka odpowiedzi nie stanie w dokumentacji. */}
          <textarea className="field min-h-20" value={szkic} onChange={(e) => setSzkic(e.target.value)} placeholder="Szkic odpowiedzi — na razie tylko lokalnie" />
          <button className="btn-secondary mt-2" disabled title="Wysyłka do Allegro wchodzi w kolejnym wydaniu"><Send size={16} />WYŚLIJ (wkrótce)</button>
        </div>
      </>}
    </section>
    {err && <p className="rounded-lg bg-red-50 p-4 text-red-700 lg:col-span-2">{err}</p>}
  </div>;
}
