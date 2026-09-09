import React, { useState } from "react";
import { Paperclip } from "lucide-react";
import type { Reklamacja, WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { useObrazZalacznikaReklamacji } from "../towar/useZdjecie";
import { Powiekszenie } from "../towar/Powiekszenie";
import { czas } from "../ui";

/* ── Rozmowa w sprawie reklamacyjnej ─────────────────────────────────────────
   Treść zgłoszenia i czat są tym, po co agent otwiera ten ekran, więc stoją
   w GŁÓWNYM oknie — tak samo jak produkty przy zwrocie od 0.167.0. Kolumna
   dowodów niesie fakty o sprawie, nie jej treść.

   ROLA AUTORA JEST PODPISEM, a nie ozdobą. Rozmowa reklamacyjna bywa
   trójstronna: `BUYER`, `SELLER` i `ADMIN`, czyli doradca Allegro. Bez
   wyraźnego podpisu agent odpowiadałby doradcy tak, jak odpowiada klientowi. */

const ROLE: Record<string, { etykieta: string; klasa: string; nasza: boolean }> = {
  BUYER: { etykieta: "Klient", klasa: "bg-white border-slate-200", nasza: false },
  SELLER: { etykieta: "My", klasa: "bg-amber-50 border-amber-200", nasza: true },
  ADMIN: { etykieta: "Doradca Allegro", klasa: "bg-sky-50 border-sky-200", nasza: false },
  SYSTEM: { etykieta: "Allegro (automat)", klasa: "bg-slate-50 border-slate-200", nasza: false },
  FULFILLMENT: { etykieta: "Magazyn Allegro", klasa: "bg-slate-50 border-slate-200", nasza: false },
};

/** Przycisk pobrania — jedyna droga dla plików, których nie narysujemy. */
function DoPobrania({ reklamacjaId, z }: { reklamacjaId: number; z: ZalacznikReklamacji }) {
  /* PRZYCISK, nie odnośnik. Sesja jedzie nagłówkiem `x-session`, którego
     `<a href>` nie niesie — pobranie załącznika rozmowy było z tego powodu
     zepsute od 0.155.0 do 0.219.1 i wyglądało, jakby działało. */
  return <button type="button"
    onClick={() => { void pobierzZalacznik(reklamacjaId, z.id, z.nazwa); }}
    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white
      px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
    <Paperclip size={12} />{z.nazwa || "załącznik"}
  </button>;
}

/**
 * Zdjęcie klienta WPROST na osi (0.223.0).
 *
 * W sklepie z częściami zdjęcie pękniętego elementu bywa CAŁYM zgłoszeniem,
 * a nazwa pliku nie mówi o nim nic. Ta sama lekcja, którą skrzynka kupiła
 * w 0.218.0 — tylko że tam bramką był stan `SAFE` z Centrum Wiadomości,
 * a tu rozstrzygają BAJTY po stronie serwera.
 *
 * SPADEK NA PRZYCISK JEST CZĘŚCIĄ PROJEKTU, nie obsługą awarii. `podglad`
 * to podpowiedź z NAZWY pliku, więc bywa nieprawdziwa: plik nazwany
 * `usterka.jpg`, który obrazem nie jest, dostaje z trasy 415, hak oddaje
 * `null`, a kafel zamienia się w przycisk pobrania. Ekran nie ma prawa
 * pokazać zepsutej ikony obrazu — to była pierwsza wersja podglądu
 * w 0.218.0 i właśnie tak wyglądała u właściciela.
 */
function ZdjecieZalacznika({ reklamacjaId, z }: {
  reklamacjaId: number; z: ZalacznikReklamacji;
}) {
  const [powiekszone, setPowiekszone] = useState(false);
  const url = useObrazZalacznikaReklamacji(reklamacjaId, z.id);
  if (url === null) return <DoPobrania reklamacjaId={reklamacjaId} z={z} />;
  return <>
    <button type="button" onClick={() => url && setPowiekszone(true)}
      title={`${z.nazwa} — kliknij, żeby powiększyć`}
      className="block overflow-hidden rounded border border-slate-200 bg-slate-100">
      {/* Stały rozmiar także PRZED pobraniem: kafel, który rośnie po
          doładowaniu, przesuwa treść pod kursorem. */}
      {url
        ? <img src={url} alt={z.nazwa} loading="lazy"
            className="h-32 w-32 object-cover" />
        : <span className="flex h-32 w-32 items-center justify-center text-xs text-slate-400">
            wczytuję…</span>}
    </button>
    {powiekszone && url && <Powiekszenie url={url} nazwa={z.nazwa} symbol={null}
      zamknij={() => setPowiekszone(false)} />}
  </>;
}

function Zalaczniki({ reklamacjaId, lista }: {
  reklamacjaId: number; lista: ZalacznikReklamacji[];
}) {
  if (!lista.length) return null;
  return <div className="mt-2 flex flex-wrap items-start gap-2">
    {lista.map((z) => z.podglad
      ? <ZdjecieZalacznika key={z.id} reklamacjaId={reklamacjaId} z={z} />
      : <DoPobrania key={z.id} reklamacjaId={reklamacjaId} z={z} />)}
  </div>;
}

export function Czat({ reklamacja, czat, zalaczniki, edytor }: {
  reklamacja: Reklamacja;
  czat: WiadomoscReklamacji[];
  /** Załączniki SAMEJ sprawy — te spoza rozmowy. */
  zalaczniki: ZalacznikReklamacji[];
  /* Edytor wstrzykiwany, nie wołany stąd: cały katalog `reklamacje/` trzyma
     komponenty czyste, a mutacje mieszkają w ekranie (wzorzec `skrzynka/`). */
  edytor?: React.ReactNode;
}) {
  /* Ile wiadomości Allegro widzi, a ilu jeszcze nie mamy. Rozmowa dociąga się
     taktem synchronizacji, więc świeża sprawa bywa przez chwilę niepełna —
     i ekran ma to POWIEDZIEĆ, zamiast pokazywać urwaną rozmowę jak całą. */
  const brakuje = Math.max(0, reklamacja.wiadomosciIle - czat.length);

  return <div className="flex min-h-0 flex-col gap-3">
    {/* Zgłoszenie: powód, oczekiwanie i opis własnymi słowami klienta. */}
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Zgłoszenie</h3>
      <p className="mt-1 text-sm text-slate-800">
        {reklamacja.powodOpis ?? reklamacja.opis ?? "Klient nie opisał sprawy własnymi słowami."}
      </p>
      <Zalaczniki reklamacjaId={reklamacja.id} lista={zalaczniki} />
    </section>

    {brakuje > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <b>Ta rozmowa jest niepełna:</b> Allegro widzi {reklamacja.wiadomosciIle} wiadomości,
      a mamy {czat.length}. Reszta dojdzie następną synchronizacją.
    </p>}

    {czat.length === 0
      ? <p className="p-6 text-center text-sm text-slate-500">
          Rozmowy jeszcze nie pobrano.</p>
      : <ol className="flex flex-col gap-2">
          {czat.map((w) => {
            const rola = ROLE[w.autorRola ?? ""] ?? {
              etykieta: w.autorRola ?? "Nieznany autor",
              klasa: "bg-white border-slate-200", nasza: false,
            };
            return <li key={w.id}
              className={`rounded-lg border p-3 ${rola.klasa} ${rola.nasza ? "ml-8" : "mr-8"}`}>
              <div className="flex items-center gap-2 text-xs">
                <b className="text-slate-700">{rola.etykieta}</b>
                {/* Login bywa PUSTY i to jest udokumentowane: schemat mówi „not
                    present if role is ADMIN, SYSTEM or FULFILLMENT". */}
                {w.autorLogin && <span className="text-slate-500">{w.autorLogin}</span>}
                <span className="ml-auto text-slate-400">{czas(w.utworzonoAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{w.tresc}</p>
              <Zalaczniki reklamacjaId={reklamacja.id} lista={w.zalaczniki} />
            </li>;
          })}
        </ol>}

    {/* Od 0.224.0 pod rozmową stoi EDYTOR, a nie zdanie o tym, że odpowiedź
        wysyła się gdzie indziej. Zdanie było prawdziwe przez dwa wydania
        i przestało być — komentarz, który skłamał, jest gorszy od jego braku.
        Werdykt ma własny pasek NAD rozmową (`Werdykt.tsx`), bo rozstrzyga
        całą sprawę, a nie jedną wiadomość. */}
    {edytor}
  </div>;
}
