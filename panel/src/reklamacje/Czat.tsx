import React from "react";
import type { Reklamacja, WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { useZdjecieZalacznikaReklamacji } from "../towar/useZdjecie";
import { KartaZalacznika, ListaZalacznikow } from "../towar/Zalacznik";
import { NaglowekSekcji, czas } from "../ui";

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

/**
 * Zdjęcie klienta WPROST na osi (0.223.0), od wydania „wspólny załącznik"
 * tą samą powłoką co skrzynka (`towar/Zalacznik.tsx`).
 *
 * W sklepie z częściami zdjęcie pękniętego elementu bywa CAŁYM zgłoszeniem,
 * a nazwa pliku nie mówi o nim nic. Ta sama lekcja, którą skrzynka kupiła
 * w 0.218.0 — tylko że tam bramką był stan `SAFE` z Centrum Wiadomości,
 * a tu rozstrzygają BAJTY po stronie serwera.
 *
 * `podglad` to podpowiedź z NAZWY pliku, więc bywa nieprawdziwa: plik nazwany
 * `usterka.jpg`, który obrazem nie jest, dostaje z trasy 415 i zostaje przy
 * samej nazwie z pobraniem. To odpowiedź, nie awaria. Awaria (502 Allegro
 * odmówiło, 503 droga do Allegro) MÓWI zdaniem pod nazwą i daje ponowienie —
 * do tego wydania czat reklamacji milczał w obu przypadkach jednakowo.
 *
 * Opakowanie per źródło, bo obraz wisi na haku REKLAMACJI, a haka nie wolno
 * wołać w pętli ani warunkowo.
 */
function ZalacznikReklamacji({ reklamacjaId, z }: {
  reklamacjaId: number; z: ZalacznikReklamacji;
}) {
  const obraz = useZdjecieZalacznikaReklamacji(reklamacjaId, z.podglad ? z.id : null);
  /* Zawsze do pobrania: `PostPurchaseIssueAttachment` nie niesie stanu
     `SAFE`/`UNSAFE`, więc nie mamy podstaw, żeby pobranie zablokować. */
  return <KartaZalacznika nazwa={z.nazwa || "załącznik"} podglad={z.podglad} obraz={obraz}
    pobierz={() => pobierzZalacznik(reklamacjaId, z.id, z.nazwa)} />;
}

function Zalaczniki({ reklamacjaId, lista }: {
  reklamacjaId: number; lista: ZalacznikReklamacji[];
}) {
  if (!lista.length) return null;
  return <ListaZalacznikow>
    {lista.map((z) => <ZalacznikReklamacji key={z.id} reklamacjaId={reklamacjaId} z={z} />)}
  </ListaZalacznikow>;
}

/**
 * Tyle o sprawie, ile ten komponent naprawdę czyta.
 *
 * KSZTAŁT STRUKTURALNY, nie `Reklamacja`, od 0.245.0 — bo ten sam czat rysuje
 * dyskusję, a dyskusja nie ma ani powodu, ani oferty, ani terminu. Trzymanie
 * tu pełnego typu reklamacji kazałoby albo zduplikować komponent, albo podać
 * dyskusji dwadzieścia pól z `null`, z których żadne nie jest prawdą o niej.
 *
 * `opisZgloszenia` skleja go WOŁAJĄCY: przy reklamacji to `powodOpis` z zejściem
 * na `opis`, przy dyskusji sam `opis`. Rozstrzyganie tego tutaj wymagałoby
 * z powrotem wiedzy o rodzaju sprawy.
 */
export interface SprawaCzatu {
  id: number;
  /** Zgłoszenie własnymi słowami klienta; `null`, gdy nic nie napisał. */
  opisZgloszenia: string | null;
  /** Ile wiadomości widzi Allegro — po tym poznaje się rozmowę niepełną. */
  wiadomosciIle: number;
}

export function Czat({ sprawa, czat, zalaczniki, edytor }: {
  sprawa: SprawaCzatu;
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
  const brakuje = Math.max(0, sprawa.wiadomosciIle - czat.length);

  return <div className="flex min-h-0 flex-col gap-3">
    {/* Zgłoszenie: powód, oczekiwanie i opis własnymi słowami klienta. */}
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <NaglowekSekcji jako="h3">Zgłoszenie</NaglowekSekcji>
      <p className="mt-1 text-sm text-slate-800">
        {sprawa.opisZgloszenia ?? "Klient nie opisał sprawy własnymi słowami."}
      </p>
      <Zalaczniki reklamacjaId={sprawa.id} lista={zalaczniki} />
    </section>

    {brakuje > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <b>Ta rozmowa jest niepełna:</b> Allegro widzi {sprawa.wiadomosciIle} wiadomości,
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
                <span className="ml-auto text-slate-500">{czas(w.utworzonoAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{w.tresc}</p>
              <Zalaczniki reklamacjaId={sprawa.id} lista={w.zalaczniki} />
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
