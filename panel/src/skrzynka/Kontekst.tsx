import React, { useState } from "react";
import { PackageSearch } from "lucide-react";
import type { OsRozmowy } from "../api/typy";
import { Zakladki } from "../ui";
import { OfertaRozmowy } from "./OfertaRozmowy";
import { ZamowienieRozmowy } from "./ZamowienieRozmowy";
import { TowarRozmowy } from "./TowarRozmowy";
import { Dobor } from "./Dobor";
import type { Towar } from "../wyszukiwarka";

/**
 * Trzecia kolumna ekranu skrzynki (§10.1, 0.180.0).
 *
 * Układ z trzema kolumnami stoi w projekcie od początku, a makieta
 * `docs/projekt-widokow/Main.dc.html` narysowała go poprawnie — front po
 * prostu do niej nie doszedł. Do 0.179.0 kontekst leżał w środkowej kolumnie,
 * nad osią: cztery bloki jeden pod drugim spychały pytanie klienta poniżej
 * krawędzi okna, a to ono jest powodem, dla którego agent tu przyszedł.
 *
 * TRZY zakładki, nie pięć z makiety. „Dobór" doszła w etapie E1, gdy dostała
 * byt (`dobor_rozmowy`). Zakładka, która zawsze mówi „wkrótce", uczy nie klikać.
 *
 * „Wiedza" ma źródło od E2 (`/api/obsluga/wiedza/*`) i mimo to nie wraca tutaj:
 * dowody wybranej kartoteki stoją już w zakładce „Dobór", a druga zakładka
 * z tą samą treścią kazałaby zgadywać, w której szukać. „Klient" nadal nie ma
 * bytu — historii maszyn kupującego nie trzyma żadna tabela.
 *
 * Dwa zwrotne uchwyty idą ze `Skrzynka.tsx`, gdzie leży szkic i formularz
 * pomiaru: zakładka doboru wstawia zdanie do szkicu i podstawia kartotekę
 * do zlecenia — obu rzeczy nie ma prawa robić po cichu.
 */
type Widok = "oferta" | "towar" | "dobor";

export function Kontekst({ dane, onWstawDoSzkicu, onZlecPomiar }: {
  dane: OsRozmowy;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: Towar) => void;
}) {
  const [widok, setWidok] = useState<Widok>("oferta");
  const oferta = dane.oferta;

  return <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Kontekst">
    <Zakladki<Widok> wybrana={widok} onWybierz={setWidok} pozycje={[
      { klucz: "oferta", etykieta: "Oferta" },
      { klucz: "towar", etykieta: "Towar" },
      { klucz: "dobor", etykieta: "Dobór" },
    ]} />

    {/* JEDEN scroller na kolumnę, jak przy zwrotach: dwa zagnieżdżone dają
        pasek w pasku, a treść bez `min-h-0` rozpycha kartę poza okno. */}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {widok === "oferta" && <>
        {oferta
          ? <OfertaRozmowy oferta={oferta} />
          : <p className="p-4 text-sm text-slate-500">
              Ta rozmowa nie jest powiązana z ofertą. Panel nie zgaduje towaru
              z treści pytania — numer wskazuje agent albo dopytuje klienta.
            </p>}
        {dane.zamowienie && <ZamowienieRozmowy zamowienie={dane.zamowienie} />}
      </>}

      {widok === "towar" && (oferta
        ? <TowarRozmowy oferta={oferta} rozmowaId={dane.rozmowa.id}
            onWstawDoSzkicu={onWstawDoSzkicu} />
        /* Bez numeru oferty nie ma z czego wywieść kartoteki. Ekran mówi to
           wprost, zamiast pokazywać pustą sekcję. */
        : <p className="flex items-start gap-2 p-4 text-sm text-slate-500">
            <PackageSearch size={16} className="mt-0.5 shrink-0" />
            <span>Bez powiązanej oferty nie ma z czego wywieść kartoteki.
              Wskaż ofertę przy rozmowie, a towar pojawi się tutaj.</span>
          </p>)}

      {widok === "dobor" && <Dobor key={dane.rozmowa.id} dobor={dane.dobor} rozmowaId={dane.rozmowa.id}
        onWstawDoSzkicu={onWstawDoSzkicu} onZlecPomiar={onZlecPomiar} />}
    </div>
  </section>;
}
