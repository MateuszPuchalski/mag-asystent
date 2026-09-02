import React, { useState } from "react";
import { PackageSearch } from "lucide-react";
import type { OsRozmowy } from "../api/typy";
import { Zakladki } from "../ui";
import { OfertaRozmowy } from "./OfertaRozmowy";
import { ZamowienieRozmowy } from "./ZamowienieRozmowy";
import { TowarRozmowy } from "./TowarRozmowy";

/**
 * Trzecia kolumna ekranu skrzynki (§10.1, 0.180.0).
 *
 * Układ z trzema kolumnami stoi w projekcie od początku, a makieta
 * `docs/projekt-widokow/Main.dc.html` narysowała go poprawnie — front po
 * prostu do niej nie doszedł. Do 0.179.0 kontekst leżał w środkowej kolumnie,
 * nad osią: cztery bloki jeden pod drugim spychały pytanie klienta poniżej
 * krawędzi okna, a to ono jest powodem, dla którego agent tu przyszedł.
 *
 * DWIE zakładki, nie pięć z makiety. „Dobór", „Klient" i „Wiedza" nie mają
 * dziś skąd wziąć danych — tabel `part`, `fitment`, `customer`
 * i `customer_machine` nie ma wcale (etapy E i F z §24). Zakładka, która
 * zawsze mówi „wkrótce", uczy nie klikać.
 */
type Widok = "oferta" | "towar";

export function Kontekst({ dane }: { dane: OsRozmowy }) {
  const [widok, setWidok] = useState<Widok>("oferta");
  const oferta = dane.oferta;

  return <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Kontekst">
    <Zakladki<Widok> wybrana={widok} onWybierz={setWidok} pozycje={[
      { klucz: "oferta", etykieta: "Oferta" },
      { klucz: "towar", etykieta: "Towar" },
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
        ? <TowarRozmowy oferta={oferta} rozmowaId={dane.rozmowa.id} />
        /* Bez numeru oferty nie ma z czego wywieść kartoteki. Ekran mówi to
           wprost, zamiast pokazywać pustą sekcję. */
        : <p className="flex items-start gap-2 p-4 text-sm text-slate-500">
            <PackageSearch size={16} className="mt-0.5 shrink-0" />
            <span>Bez powiązanej oferty nie ma z czego wywieść kartoteki.
              Wskaż ofertę przy rozmowie, a towar pojawi się tutaj.</span>
          </p>)}
    </div>
  </section>;
}
