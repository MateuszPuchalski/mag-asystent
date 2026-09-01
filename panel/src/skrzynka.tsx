import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Inbox, Lock, RefreshCw, Ruler, Send, UserCheck } from "lucide-react";

/* Ekran skrzynki jest CZYTELNIKIEM modelu kanonicznego, nie klientem Allegro.
   Dlatego pokazuje moment ostatniej synchronizacji: pusta lista o 9:00 znaczy
   co innego, gdy synchronizator stanął o 6:00, a co innego, gdy przebiegł
   minutę temu. Bez tej daty ekran kłamałby ciszą. */

type Rozmowa = { id: number; klient: string; ostatniaWiadomosc: string; ostatniaWiadomoscAt: string; nieprzeczytana: boolean; wlascicielId: number | null; wlasciciel: string | null; wersja: number };
type WpisOsi = { id: string; rodzaj: "wiadomosc" | "wynik_zadania"; autor: string; odKlienta: boolean; tresc: string; at: string; ofertaId: string | null; zadanieId?: number; messageId?: number };
type Szkic = { body: string; wersja: number; expectedLastMessageId: number | null };
type Stan = { ostatniaSynchronizacja: string | null; bledy: number };

const czas = (v: string) => (v ? new Date(v).toLocaleString("pl") : "—");

export function Skrzynka({ api, mojeId }: { api: (p: string, i?: RequestInit) => Promise<any>; mojeId: number | null }) {
  const [rozmowy, setRozmowy] = useState<Rozmowa[]>([]);
  const [stan, setStan] = useState<Stan>({ ostatniaSynchronizacja: null, bledy: 0 });
  const [wybrana, setWybrana] = useState<Rozmowa | null>(null);
  const [os, setOs] = useState<WpisOsi[]>([]);
  const [szkic, setSzkic] = useState("");
  const [szkicWersja, setSzkicWersja] = useState<number | null>(null);
  const [zrodlo, setZrodlo] = useState<number | null>(null);
  const [wskazowka, setWskazowka] = useState("");
  const [nowa, setNowa] = useState(false);
  const [err, setErr] = useState("");
  const [laduje, setLaduje] = useState(true);
  const wybranaRef = useRef<number | null>(null);

  async function wczytaj() {
    try {
      const d = await api("/api/obsluga/rozmowy");
      setRozmowy(d.rozmowy); setStan(d.stan); setErr("");
    } catch (x) { setErr((x as Error).message); } finally { setLaduje(false); }
  }
  useEffect(() => { wczytaj(); }, []);

  async function otworz(id: number) {
    wybranaRef.current = id; setZrodlo(null); setWskazowka(""); setNowa(false);
    history.replaceState(null, "", `/obsluga/skrzynka?rozmowa=${id}`);
    try {
      const d = await api(`/api/obsluga/rozmowy/${id}`);
      setWybrana(d.rozmowa); setOs(d.os);
      setSzkic(d.szkic?.body ?? ""); setSzkicWersja(d.szkic?.wersja ?? null);
    } catch (x) { setErr((x as Error).message); }
  }

  /* Jedna szyna zdarzeń zastępuje odpytywanie: nowa wiadomość klienta,
     zmiana właściciela i wynik z hali docierają same. Bez tego agent
     dowiadywałby się o nowej wiadomości dopiero przy następnym kliknięciu.

     Czytamy ją `fetch`em, nie `EventSource`: sesja jedzie nagłówkiem
     `x-session`, a EventSource nagłówków nie ustawia. Wariant z tokenem
     w adresie działałby, ale token lądowałby w logach żądań serwera. */
  useEffect(() => {
    const przerwij = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/conversations/events", {
          headers: { "x-session": localStorage.getItem("wertis-panel-token") || "" },
          signal: przerwij.signal,
        });
        if (!r.ok || !r.body) return;
        const czytnik = r.body.getReader();
        const dekoder = new TextDecoder();
        let bufor = "";
        for (;;) {
          const { done, value } = await czytnik.read();
          if (done) break;
          bufor += dekoder.decode(value, { stream: true });
          const ramki = bufor.split("\n\n");
          bufor = ramki.pop() ?? "";
          for (const ramka of ramki) {
            const dane = ramka.split("\n").find((l) => l.startsWith("data: "));
            if (!dane) continue;                     // komentarz `: keep-alive`
            const zdarzenie = JSON.parse(dane.slice(6));
            wczytaj();
            if (zdarzenie.conversationId !== wybranaRef.current) continue;
            if (zdarzenie.type === "message.created") setNowa(true);
            else otworz(zdarzenie.conversationId);
          }
        }
      } catch { /* zerwany strumień: lista i tak odświeża się przy kliknięciu */ }
    })();
    return () => przerwij.abort();
  }, []);

  async function przejmij() {
    if (!wybrana) return;
    try {
      await api(`/api/conversations/${wybrana.id}/claim`, {
        method: "POST", body: JSON.stringify({ expectedVersion: wybrana.wersja }),
      });
      otworz(wybrana.id); wczytaj();
    } catch (x) { setErr((x as Error).message); otworz(wybrana.id); }
  }

  /* Szkic jest współdzielony, więc zapis jest jawny i niesie wersję. Cicha
     autozapisywarka gubiłaby cudzą pracę przy dwóch agentach na jednej sprawie. */
  async function zapiszSzkic() {
    if (!wybrana) return;
    const ostatnia = [...os].reverse().find((w) => w.messageId)?.messageId ?? null;
    try {
      const d = await api(`/api/conversations/${wybrana.id}/draft`, {
        method: "PUT",
        body: JSON.stringify({ body: szkic, expectedLastMessageId: ostatnia, expectedVersion: szkicWersja }),
      });
      setSzkicWersja(d.version); setErr("");
    } catch (x) { setErr((x as Error).message); otworz(wybrana.id); }
  }

  async function zlec() {
    if (!wybrana || !zrodlo) return;
    try {
      await api("/api/obsluga/zadania/pomiar", {
        method: "POST",
        body: JSON.stringify({ rozmowaId: wybrana.id, wiadomoscId: zrodlo, instrukcja: wskazowka }),
      });
      setWskazowka(""); setZrodlo(null); otworz(wybrana.id);
    } catch (x) { setErr((x as Error).message); }
  }

  const bezOferty = os.some((w) => w.rodzaj === "wiadomosc" && w.odKlienta && !w.ofertaId);
  const moja = wybrana?.wlascicielId !== null && wybrana?.wlascicielId === mojeId;
  const cudza = wybrana?.wlascicielId != null && wybrana.wlascicielId !== mojeId;

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
          className={`block w-full border-b p-4 text-left hover:bg-slate-50 ${wybrana?.id === r.id ? "bg-amber-50" : ""}`}>
          <div className="flex items-center gap-2">
            <b className="truncate">{r.klient}</b>
            {r.nieprzeczytana && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold">NOWE</span>}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.ostatniaWiadomosc}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span>{czas(r.ostatniaWiadomoscAt)}</span>
            {r.wlasciciel && <span className="flex items-center gap-1 font-semibold text-slate-600"><UserCheck size={12} />{r.wlasciciel}</span>}
          </div>
        </button>)}
      </div>
    </section>

    <section className="card flex max-h-[75vh] flex-col overflow-hidden">
      {!wybrana && <div className="grid flex-1 place-items-center p-16 text-slate-500"><Inbox size={38} /><p className="mt-3 font-semibold">Wybierz rozmowę z listy</p></div>}
      {wybrana && <>
        <header className="flex flex-wrap items-center gap-3 border-b p-4">
          <b className="mr-auto">{wybrana.klient}</b>
          {wybrana.wlasciciel
            ? <span className={`flex items-center gap-1 text-sm font-semibold ${moja ? "text-emerald-700" : "text-slate-600"}`}>
                <UserCheck size={15} />{moja ? "Twoja rozmowa" : `Prowadzi ${wybrana.wlasciciel}`}</span>
            : <button className="btn-primary" onClick={przejmij}><UserCheck size={16} />PRZEJMIJ ROZMOWĘ</button>}
        </header>
        {nowa && <p className="flex items-center gap-2 border-b bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
          <Bell size={16} />Klient dopisał nową wiadomość.
          <button className="underline" onClick={() => otworz(wybrana.id)}>Pokaż</button></p>}
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
                {w.odKlienta && !cudza && <button className={`mt-2 text-xs font-bold ${zrodlo === w.messageId ? "text-amber-700" : "text-slate-500"}`}
                  onClick={() => setZrodlo(zrodlo === w.messageId ? null : w.messageId!)}>
                  {zrodlo === w.messageId ? "✓ źródło pomiaru" : "Zleć z tej wiadomości"}</button>}
              </article>)}
        </div>
        {zrodlo && <div className="border-t bg-amber-50 p-4">
          <label className="block text-sm font-semibold">Wskazówka dla hali <span className="font-normal text-slate-500">(opcjonalnie)</span>
            <input className="field mt-1" value={wskazowka} onChange={(e) => setWskazowka(e.target.value)} placeholder="Np. podaj wynik w milimetrach" /></label>
          <button className="btn-primary mt-3" onClick={zlec}><Ruler size={16} />ZLEĆ POMIAR</button>
        </div>}
        <div className="border-t p-4">
          {cudza && <p className="mb-2 flex items-center gap-2 text-xs text-slate-500"><Lock size={13} />Rozmowę prowadzi {wybrana.wlasciciel} — szkic zapisze tylko właściciel.</p>}
          <textarea className="field min-h-20" value={szkic} onChange={(e) => setSzkic(e.target.value)} placeholder="Szkic odpowiedzi — współdzielony z zespołem" />
          <div className="mt-2 flex gap-2">
            <button className="btn-secondary" onClick={zapiszSzkic} disabled={cudza}>ZAPISZ SZKIC</button>
            {/* Wysyłka do Allegro jest wyłączona w tym wydaniu: polityka
                odpowiedzi ma najpierw stanąć w docs/obsluga-klienta.md. */}
            <button className="btn-secondary" disabled title="Wysyłka do Allegro wchodzi w kolejnym wydaniu"><Send size={16} />WYŚLIJ (wkrótce)</button>
          </div>
        </div>
      </>}
    </section>
    {err && <p className="rounded-lg bg-red-50 p-4 text-red-700 lg:col-span-2">{err}</p>}
  </div>;
}
