import React, { useState } from "react";
import { PackageSearch } from "lucide-react";
import type { OsRozmowy } from "../api/typy";
import { Zakladki } from "../ui";
import { OfertaRozmowy } from "./OfertaRozmowy";
import { ZamowienieRozmowy } from "./ZamowienieRozmowy";
import { ZwrotRozmowy } from "./ZwrotRozmowy";
import { TowarRozmowy } from "./TowarRozmowy";
import { Dobor } from "./Dobor";
import { Klient } from "./Klient";
import { Wiedza } from "./Wiedza";
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
 * CZTERY zakładki. Makieta miała pięć: „Oferta" i „Towar" zeszły się w jedną
 * (niżej), a „Klient" i „Wiedza" wróciły decyzją właściciela.
 *
 * ── DLACZEGO OFERTA I TOWAR ZESZŁY SIĘ W JEDNO (0.198.0) ────────────────────
 * Właściciel przysłał zrzut z pracy: „powinniśmy wykorzystać puste miejsce
 * z boku". Zakładka „Oferta" to jedenaście linijek — numer, tytuł, SKU, cena —
 * w kolumnie wysokiej na osiemset pikseli. Reszta świeciła bielą.
 *
 * A pod zakładką obok, niewidoczne, leżały: zdjęcie towaru, stan magazynowy,
 * półka i PARAMETRY KARTOTEKI. Na tamtym zrzucie klient pytał o wymiar gwintu
 * korka, a parametr „Gwint" stał w schowanej zakładce. Jeden klik dalej, ale
 * niewidoczny — czyli dla kogoś, kto nie wie, że tam jest, nieistniejący.
 *
 * §10.1 uzasadniał zakładki tym, że kolumna niesie „dwa RÓWNORZĘDNE tematy:
 * co klient kupuje i co mamy na półce". To jeden temat oglądany z dwóch stron
 * i odpowiedź prawie zawsze potrzebuje obu naraz. Argument o przewijaniu „obok
 * tematu, którego akurat nie czytasz" trzymał się, dopóki obie zakładki były
 * wysokie; oferta ma jedenaście linijek.
 *
 * „Dobór" ZOSTAJE osobno, bo to nie jest karta faktów, tylko robota: własne
 * kroki, kandydaci, dowody i przyciski zmieniające stan rozmowy.
 *
 * „Wiedza" i „Klient" wracają — obie z powodów, które unieważniły tamte dwa
 * zdania, a nie wbrew nim.
 *
 * Wiedzy odmawialiśmy, bo dowody stały już w „Doborze" i druga zakładka z tą
 * samą treścią kazałaby zgadywać, w której szukać. Argument był słuszny, więc
 * dowody STAMTĄD WYSZŁY: stoją w jednym miejscu, nie w dwóch. Dobór został
 * robotą (kroki, kandydaci, przyciski), Wiedza jest kartą faktów pod szkic —
 * sięga się po nią także wtedy, gdy dobór dawno domknięto.
 *
 * Klientowi odmawialiśmy, bo „historii maszyn kupującego nie trzyma żadna
 * tabela". To była prawda o TABELI, nie o danych: login kupującego wiąże jego
 * zamówienia, jego rozmowy i maszyny z domkniętych doborów. Zakładka jest
 * czystym odczytem i nie zakłada ani jednej nowej tabeli.
 *
 * Dwa zwrotne uchwyty idą ze `Skrzynka.tsx`, gdzie leży szkic i formularz
 * pomiaru: zakładka doboru wstawia zdanie do szkicu i podstawia kartotekę
 * do zlecenia — obu rzeczy nie ma prawa robić po cichu.
 */
type Widok = "towar" | "dobor" | "klient" | "wiedza";

export function Kontekst({ dane, onWstawDoSzkicu, onZlecPomiar, onOtworzRozmowe }: {
  dane: OsRozmowy;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: Towar) => void;
  onOtworzRozmowe: (id: number) => void;
}) {
  const [widok, setWidok] = useState<Widok>("towar");
  const oferta = dane.oferta;
  /* Liczba pozycji, gdy jest ich więcej niż jedna; z jednej serwer wywodzi
     ofertę sam, więc ten przypadek nie dochodzi do tego zdania. */
  const pozycji = dane.zamowienie?.pobrane?.pozycje.length ?? 0;
  const kilkaPozycji = pozycji > 1 ? pozycji : 0;

  return <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Kontekst">
    <Zakladki<Widok> wybrana={widok} onWybierz={setWidok} pozycje={[
      { klucz: "towar", etykieta: "Oferta i towar" },
      { klucz: "dobor", etykieta: "Dobór" },
      { klucz: "klient", etykieta: "Klient" },
      { klucz: "wiedza", etykieta: "Wiedza" },
    ]} />

    {/* JEDEN scroller na kolumnę, jak przy zwrotach: dwa zagnieżdżone dają
        pasek w pasku, a treść bez `min-h-0` rozpycha kartę poza okno. */}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* KOLEJNOŚĆ: oferta, zamówienie, kartoteka. Od tego, co klient widział
          kupując, do tego, co my mamy na półce — a nie odwrotnie. */}
      {widok === "towar" && <>
        {oferta
          ? <OfertaRozmowy oferta={oferta} />
          : kilkaPozycji
            /* Zamówienie z kilku pozycji (0.215.0): oferta jest do WSKAZANIA
               przy pozycji niżej, nie do wpisania z ręki i nie do zgadnięcia. */
            ? <p className="p-4 text-sm text-slate-500">
                Zamówienie ma {kilkaPozycji} pozycje — wskaż niżej tę, o którą pyta klient,
                a oferta i kartoteka pojawią się tutaj.
              </p>
            : <p className="p-4 text-sm text-slate-500">
                Ta rozmowa nie jest powiązana z ofertą. Panel nie zgaduje towaru
                z treści pytania — numer wskazuje agent albo dopytuje klienta.
              </p>}
        {dane.zamowienie && <ZamowienieRozmowy zamowienie={dane.zamowienie} rozmowaId={dane.rozmowa.id}
          ofertaRozmowy={oferta?.externalId ?? null} />}
        {/* Zwrot POD zamówieniem, bo to zwrot tego zakupu (0.221.0). Jeden
            zakup miewa kilka zwrotów, stąd lista. */}
        {dane.zwroty.map((z) => <ZwrotRozmowy key={z.id} zwrot={z} />)}
        {oferta
          ? <TowarRozmowy oferta={oferta} rozmowaId={dane.rozmowa.id}
              onWstawDoSzkicu={onWstawDoSzkicu} />
          /* Bez numeru oferty nie ma z czego wywieść kartoteki. Ekran mówi to
             wprost, zamiast pokazywać pustą sekcję. */
          : <p className="flex items-start gap-2 border-t p-4 text-sm text-slate-500">
              <PackageSearch size={16} className="mt-0.5 shrink-0" />
              <span>Bez powiązanej oferty nie ma z czego wywieść kartoteki.
                {kilkaPozycji
                  ? " Wskaż pozycję zamówienia wyżej, a towar pojawi się tutaj."
                  : " Wskaż ofertę przy rozmowie, a towar pojawi się tutaj."}</span>
            </p>}
      </>}

      {widok === "dobor" && <Dobor key={dane.rozmowa.id} dobor={dane.dobor} rozmowaId={dane.rozmowa.id}
        onWstawDoSzkicu={onWstawDoSzkicu} onZlecPomiar={onZlecPomiar} />}

      {widok === "klient" && <Klient key={dane.rozmowa.id} rozmowaId={dane.rozmowa.id}
        onOtworzRozmowe={onOtworzRozmowe} />}

      {/* Maszyna z DANYCH DOBORU, nie z historii klienta: pomiar ma pasować do
          tego, o co pyta ta rozmowa. */}
      {widok === "wiedza" && <Wiedza key={dane.rozmowa.id} rozmowaId={dane.rozmowa.id}
        twId={dane.dobor.wybrany?.twId ?? null}
        maMaszyne={Boolean(dane.dobor.dane.marka && dane.dobor.dane.model)} />}
    </div>
  </section>;
}
