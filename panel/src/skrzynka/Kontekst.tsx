import React, { useState } from "react";
import { ChevronRight, PackageSearch } from "lucide-react";
import type { OsRozmowy } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Przycisk, Pusto, dzien, odmien } from "../ui";
import { OfertaRozmowy } from "./OfertaRozmowy";
import { STATUS as STATUS_PACZKI, ZamowienieRozmowy } from "./ZamowienieRozmowy";
import { ZamowieniaKlienta } from "./ZamowieniaKlienta";
import { ZwrotRozmowy } from "./ZwrotRozmowy";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { TowarRozmowy } from "./TowarRozmowy";
import { Dobor } from "./Dobor";
import { Klient } from "./Klient";
import { Wiedza } from "./Wiedza";
import { PasmoOdpowiedzi } from "./PasmoOdpowiedzi";
import { Soczewka } from "./Soczewki";
import { useHistoriaKlienta, useWiedzaDoboru } from "../api/rozmowy";
import type { Towar } from "../wyszukiwarka";
import { NAZWA_DOBORU } from "./statusy";
import { bramkaDoboru, coSwieci, doborWToku, paczkaOdchylenie, pozycjiDoWskazania,
  towarOtwartyNaStart, zwrotWToku } from "./kokpit";

/**
 * Trzecia kolumna ekranu skrzynki (§10.1, 0.180.0).
 *
 * Układ z trzema kolumnami stoi w projekcie od początku, a makieta
 * `docs/projekt-widokow/Main.dc.html` narysowała go poprawnie — front po
 * prostu do niej nie doszedł. Do 0.179.0 kontekst leżał w środkowej kolumnie,
 * nad osią: cztery bloki jeden pod drugim spychały pytanie klienta poniżej
 * krawędzi okna, a to ono jest powodem, dla którego agent tu przyszedł.
 *
 * ZAKŁADEK JUŻ NIE MA (0.498.0) — patrz „Ciemny kokpit" niżej. Do tego
 * wydania były cztery: „Oferta" i „Towar" zeszły się w jedną, a „Klient"
 * i „Wiedza" wróciły decyzją właściciela. Uzasadnienia tamtych decyzji
 * zostają poniżej, bo te same tematy żyją dziś jako wiersze.
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
 * pomiaru: dobór wstawia zdanie do szkicu i podstawia kartotekę do zlecenia
 * — obu rzeczy nie ma prawa robić po cichu.
 *
 * ── CIEMNY KOKPIT ZAMIAST ZAKŁADEK (0.498.0) ───────────────────────────────
 * Nagranie właściciela pokazało cztery zakładki i trzy kłopoty naraz. W „Ofercie
 * i towarze" nazwa towaru stała cztery razy, a zwrot do decyzji — jedyna
 * rzecz z terminem — w połowie przewijania. „Klient 2" i „Wiedza 0" niosły po
 * zdaniu na całą kolumnę. Zakładka z zerem kazała kliknąć, żeby dowiedzieć się,
 * że nic tam nie ma.
 *
 * Kolumna ma teraz dwie części. „Wymaga Ciebie" świeci i jest rozwinięte.
 * „W normie" to jedna linia na temat ze streszczeniem, rozwijana kliknięciem.
 * Reguły świecenia stoją w `kokpit.ts`, każda z testem — szara linia jest
 * bezpieczna tylko wtedy, gdy reguła „w normie" nie kłamie.
 *
 * STRESZCZENIE MÓWI TO, CZEGO NIE MÓWI PASMO (D z kanwy). Nazwa, SKU i stan
 * stoją raz, w paśmie nad kolumną. Wiersz dokłada tylko to, co jego źródło ma
 * inne: oferta cenę i stan, zamówienie datę i paczkę, dobór swój status.
 *
 * Kolumna niczego nie zapisuje przy rozwijaniu: wiersze to stan ekranu,
 * a treść pod nimi to te same odczyty, co w dawnych zakładkach.
 */
type Temat = "towar" | "zamowienie" | "zamkniete" | "dobor" | "klient" | "wiedza";

export function Kontekst(p: {
  dane: OsRozmowy;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: Towar) => void;
  onOtworzRozmowe: (id: number) => void;
}) {
  /* KLUCZ Z ROZMOWY: rozwinięte wiersze to stan TEJ rozmowy. Bez klucza
     dobór rozwinięty przy jednej sprawie stałby rozwinięty przy następnej,
     a domyślne „towar otwarty" liczyłoby się tylko raz, przy pierwszej. */
  return <Kolumna key={p.dane.rozmowa.id} {...p} />;
}

function Kolumna({ dane, onWstawDoSzkicu, onZlecPomiar, onOtworzRozmowe }: {
  dane: OsRozmowy;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: Towar) => void;
  onOtworzRozmowe: (id: number) => void;
}) {
  const oferta = dane.oferta;
  const kilkaPozycji = pozycjiDoWskazania(dane);
  const swiatla = coSwieci(dane);
  const [otwarte, setOtwarte] = useState<ReadonlySet<Temat>>(
    () => new Set<Temat>(towarOtwartyNaStart(swiatla) ? ["towar"] : []));
  const przelacz = (t: Temat) => setOtwarte((o) => {
    const n = new Set(o);
    if (n.has(t)) n.delete(t); else n.add(t);
    return n;
  });
  /* „Szukaj mimo to" przy bramce doboru. Stan ekranu, nie zapis: bramka
     wraca przy następnym otwarciu rozmowy, bo towar dalej jest znany. */
  const [szukamMimoTo, setSzukamMimoTo] = useState(false);

  /* ── LICZNIKI Z ZAKŁADEK ŻYJĄ JAKO STRESZCZENIA (23 września 2026) ─────────
     Oba zapytania to te same klucze, które wiersze i tak wołają po rozwinięciu
     — przy rozwinięciu nic nie idzie drugi raz. To są odczyty: zero zapisu
     przy patrzeniu zostaje nietknięte. */
  const historia = useHistoriaKlienta(dane.rozmowa.id);
  const wiedza = useWiedzaDoboru(dane.rozmowa.id);

  const zwrotyWToku = dane.zwroty.filter(zwrotWToku);
  const zwrotyZamkniete = dane.zwroty.filter((z) => !zwrotWToku(z));
  const sprawyOtwarte = dane.sprawy.filter((x) => x.otwarta);
  const sprawyZamkniete = dane.sprawy.filter((x) => !x.otwarta);
  const bramka = bramkaDoboru(dane) && !szukamMimoTo;
  const doborSwieci = swiatla.includes("dobor") || (szukamMimoTo && doborWToku(dane.dobor.status));
  /* Zamówienie idzie do świecącej części, gdy to ono wymaga ruchu: paczka
     poza zwykłą drogą albo pozycja do wskazania. Wtedy nie stoi drugi raz
     w wierszu „Zamówienie" — ta sama karta w dwóch miejscach to dokładnie
     powtórzenie, które to wydanie zdejmuje. */
  const zamowienieSwieci = Boolean(dane.zamowienie) && (paczkaOdchylenie(dane) || kilkaPozycji > 0);
  const ileSwieci = zwrotyWToku.length + sprawyOtwarte.length + (zamowienieSwieci ? 1 : 0)
    + (doborSwieci ? 1 : 0);

  const dobor = <Dobor key={dane.rozmowa.id} dobor={dane.dobor} rozmowaId={dane.rozmowa.id}
    propozycja={dane.szkicCopilota}
    onWstawDoSzkicu={onWstawDoSzkicu} onZlecPomiar={onZlecPomiar} />;

  return <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Kontekst">
    {/* ── PASMO ODPOWIEDZI NAD KOLUMNĄ (0.404.0) ──────────────────────────────
        Trzy fakty, które rozstrzygają odpowiedź, stoją nad wszystkim innym.
        Od 0.498.0 to także JEDYNE miejsce nazwy, SKU i stanu towaru —
        wiersze niżej ich nie powtarzają. Granice w `PasmoOdpowiedzi.tsx`. */}
    <PasmoOdpowiedzi dane={dane} />

    {/* JEDEN scroller na kolumnę, jak przy zwrotach: dwa zagnieżdżone dają
        pasek w pasku, a treść bez `min-h-0` rozpycha kartę poza okno. */}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* SOCZEWKA NAD WSZYSTKIM (0.499.0): odpowiedź na pytanie klienta stoi
          przed tym, co ma termin, bo po nią agent otwiera rozmowę. Niczego nie
          chowa — „Wymaga Ciebie" i wiersze stoją pod nią jak bez niej. */}
      <Soczewka dane={dane} onWstawDoSzkicu={onWstawDoSzkicu} />
      {ileSwieci > 0 && <section aria-label="Wymaga Ciebie" className="space-y-2 pb-3">
        <h3 className="px-4 pt-3 text-podpis font-bold uppercase tracking-wide text-amber-900">
          Wymaga Ciebie · {ileSwieci}</h3>
        {/* Zwrot POD zamówieniem był zwrotem tego zakupu (0.221.0) — dziś
            stoi NAD nim, bo ma termin, a zamówienie nie. Jeden zakup miewa
            kilka zwrotów, stąd lista. */}
        {zwrotyWToku.map((z) => <Rama key={z.id}><ZwrotRozmowy zwrot={z} /></Rama>)}
        {/* Reklamacje i dyskusje tego zakupu (S1 spoiwa) — mają zegar,
            którego pytanie nie ma. */}
        {sprawyOtwarte.length > 0 && <Rama><SprawyZakupu sprawy={sprawyOtwarte} /></Rama>}
        {zamowienieSwieci && dane.zamowienie && <Rama>
          {kilkaPozycji > 0 && <Pusto waga="lista">
            Zamówienie ma {kilkaPozycji} pozycje — wskaż tę, o którą pyta klient,
            a oferta i kartoteka pojawią się niżej.
          </Pusto>}
          <ZamowienieRozmowy zamowienie={dane.zamowienie} rozmowaId={dane.rozmowa.id}
            ofertaRozmowy={oferta?.externalId ?? null} />
        </Rama>}
        {doborSwieci && <Rama>
          <Wiersz tytul="Dobór" streszczenie={streszczenieDoboru(dane)}
            otwarty={otwarte.has("dobor")} onPrzelacz={() => przelacz("dobor")}>{dobor}</Wiersz>
        </Rama>}
      </section>}

      <DrogaZakupu droga={dane.droga} tutaj={{ rodzaj: "rozmowa", id: dane.rozmowa.id }} />

      {ileSwieci > 0 && <h3 className="px-4 pb-1 pt-3 text-podpis font-bold uppercase tracking-wide text-slate-600">
        W normie</h3>}

      {/* KOLEJNOŚĆ: oferta i towar, zamówienie, sprawy zamknięte, dobór,
          klient, wiedza. Od tego, co klient kupował, do tego, co wiemy. */}
      <Wiersz tytul="Oferta i towar" streszczenie={streszczenieOferty(dane)}
        otwarty={otwarte.has("towar")} onPrzelacz={() => przelacz("towar")}>
        {oferta
          ? <OfertaRozmowy oferta={oferta} />
          /* Zamówienie z kilku pozycji (0.215.0): oferta jest do WSKAZANIA przy
             pozycji, nie do wpisania z ręki. Prośba stoi w „Wymaga Ciebie"
             nad wierszem; drugi raz tutaj byłaby tym samym zdaniem. */
          : kilkaPozycji ? null
            : <Pusto waga="lista">
                Ta rozmowa nie jest powiązana z ofertą. Panel nie zgaduje towaru
                z treści pytania — numer wskazuje agent albo dopytuje klienta.
              </Pusto>}
        {oferta
          /* Wstawki tu NIE MA od 0.404.0 — zeszła do pasma odpowiedzi,
             gdzie nie trzeba po nią przewijać kolumny. */
          ? <TowarRozmowy oferta={oferta} rozmowaId={dane.rozmowa.id} />
          /* Bez numeru oferty nie ma z czego wywieść kartoteki. Ekran mówi to
             wprost, zamiast pokazywać pustą sekcję. */
          : <p className="flex items-start gap-2 border-t p-4 text-sm text-slate-500">
              <PackageSearch size={16} className="mt-0.5 shrink-0" />
              <span>Bez powiązanej oferty nie ma z czego wywieść kartoteki.
                {kilkaPozycji
                  ? " Wskaż pozycję zamówienia wyżej, a towar pojawi się tutaj."
                  : " Wskaż ofertę przy rozmowie, a towar pojawi się tutaj."}</span>
            </p>}
      </Wiersz>

      {/* ── ZAKUPY TEGO KLIENTA (0.397.0) ──────────────────────────────────
          Blok stoi w wierszu zamówienia, bo odpowiada na to samo pytanie —
          „o którą paczkę chodzi" — a przy braku powiązania jest jedyną drogą
          do niego. Wiersz stoi więc także wtedy, gdy zamówienia nie ma. */}
      <Wiersz tytul="Zamówienie" streszczenie={streszczenieZamowienia(dane)}
        otwarty={otwarte.has("zamowienie")} onPrzelacz={() => przelacz("zamowienie")}>
        {dane.zamowienie && !zamowienieSwieci && <ZamowienieRozmowy zamowienie={dane.zamowienie}
          rozmowaId={dane.rozmowa.id} ofertaRozmowy={oferta?.externalId ?? null} />}
        <ZamowieniaKlienta kandydaci={dane.kandydaciZamowien} rozmowaId={dane.rozmowa.id}
          maZamowienie={dane.zamowienie !== null} />
      </Wiersz>

      {(zwrotyZamkniete.length > 0 || sprawyZamkniete.length > 0) &&
        <Wiersz tytul="Zamknięte sprawy" streszczenie={streszczenieZamknietych(
          zwrotyZamkniete.length, sprawyZamkniete.length)}
          otwarty={otwarte.has("zamkniete")} onPrzelacz={() => przelacz("zamkniete")}>
          {zwrotyZamkniete.map((z) => <ZwrotRozmowy key={z.id} zwrot={z} />)}
          {sprawyZamkniete.length > 0 && <SprawyZakupu sprawy={sprawyZamkniete} />}
        </Wiersz>}

      {!doborSwieci && <Wiersz tytul="Dobór"
        streszczenie={bramka ? "zbędny — towar znany z zamówienia" : streszczenieDoboru(dane)}
        otwarty={otwarte.has("dobor")} onPrzelacz={() => przelacz("dobor")}>
        {bramka ? <BramkaDoboru dane={dane} onSzukaj={() => setSzukamMimoTo(true)} /> : dobor}
      </Wiersz>}

      <Wiersz tytul="Klient" streszczenie={streszczenieKlienta(historia.data)}
        otwarty={otwarte.has("klient")} onPrzelacz={() => przelacz("klient")}>
        <Klient key={dane.rozmowa.id} rozmowaId={dane.rozmowa.id} onOtworzRozmowe={onOtworzRozmowe} />
      </Wiersz>

      {/* Maszyna z DANYCH DOBORU, nie z historii klienta: pomiar ma pasować do
          tego, o co pyta ta rozmowa. */}
      <Wiersz tytul="Wiedza" streszczenie={streszczenieWiedzy(wiedza.data)}
        otwarty={otwarte.has("wiedza")} onPrzelacz={() => przelacz("wiedza")}>
        <Wiedza key={dane.rozmowa.id} rozmowaId={dane.rozmowa.id}
          twId={dane.dobor.wybrany?.twId ?? null}
          maMaszyne={Boolean(dane.dobor.dane.marka && dane.dobor.dane.model)} />
      </Wiersz>
    </div>
  </section>;
}

/** Ramka świecącej pozycji. Bursztyn, bo to rodzina „uwaga", nie zaznaczenie. */
function Rama({ children }: { children: React.ReactNode }) {
  return <div className="mx-3 overflow-hidden rounded-lg border-2 border-amber-400 bg-white">{children}</div>;
}

/**
 * Jeden temat kolumny: tytuł, streszczenie, treść po rozwinięciu.
 *
 * Streszczenie jest ZAPACHEM informacji (Pirolli i Card): mówi, co jest pod
 * spodem, zanim ktoś kliknie. Tego nie umiała zakładka z samym zerem.
 * Wysokość 44 px, bo to cel dla myszy i dla palca na tablecie w hali.
 */
function Wiersz({ tytul, streszczenie, otwarty, onPrzelacz, children }: {
  tytul: string;
  streszczenie: string;
  otwarty: boolean;
  onPrzelacz: () => void;
  children: React.ReactNode;
}) {
  return <div className="border-t first:border-t-0">
    <button type="button" aria-expanded={otwarty} onClick={onPrzelacz}
      className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50">
      <ChevronRight size={14} aria-hidden
        className={`shrink-0 text-slate-500 transition-transform ${otwarty ? "rotate-90" : ""}`} />
      <b className="shrink-0 text-sm text-wertis-ink">{tytul}</b>
      <span className="min-w-0 truncate text-xs text-slate-600">{streszczenie}</span>
    </button>
    {otwarty && <div>{children}</div>}
  </div>;
}

/** Bramka doboru (E z kanwy) — reguła i powód w `kokpit.ts` przy `towarZnany`. */
function BramkaDoboru({ dane, onSzukaj }: { dane: OsRozmowy; onSzukaj: () => void }) {
  const o = dane.oferta;
  const status = dane.dobor.status;
  return <div className="space-y-2 px-4 pb-4 pt-1 text-sm">
    <p><b>Towar znany z zamówienia.</b> Klient pisze o{" "}
      {o?.pobrana?.nazwa ?? `ofercie ${o?.externalId ?? ""}`}
      {o?.pobrana?.sku && <> (<span className="font-mono">{o.pobrana.sku}</span>)</>}, który
      kupił w tym zamówieniu. Dobór nie ma tu czego szukać.</p>
    {doborWToku(status) && <p className="text-xs text-slate-600">
      Automat zaczął szukać ({NAZWA_DOBORU[status]}) — kandydaci czekają pod przyciskiem.</p>}
    <p className="text-xs text-slate-600">
      Czy towar pasuje do maszyny klienta, mówi lista „Pasuje do" w ofercie i wiersz Wiedza.</p>
    <Przycisk className="text-sm" onClick={onSzukaj}>Szukaj innego towaru mimo to</Przycisk>
  </div>;
}

/* ── STRESZCZENIA WIERSZY ──────────────────────────────────────────────────
   Każde mówi WYŁĄCZNIE to, czego nie ma w paśmie: bez nazwy, SKU i stanu. */

const STATUS_OFERTY: Record<string, string> = {
  ACTIVE: "aktywna", ENDED: "zakończona", INACTIVE: "nieaktywna", ACTIVATING: "aktywuje się",
};

export function streszczenieOferty(dane: OsRozmowy): string {
  const o = dane.oferta;
  if (!o) return pozycjiDoWskazania(dane) ? "do wskazania w zamówieniu" : "bez powiązanej oferty";
  if (!o.pobrana) return `oferta ${o.externalId} · treść jeszcze nie pobrana`;
  const status = o.pobrana.status ? STATUS_OFERTY[o.pobrana.status] ?? o.pobrana.status : null;
  const cena = o.pobrana.cenaGrosze !== null ? zlote(o.pobrana.cenaGrosze, o.pobrana.waluta ?? "PLN") : null;
  return [status, cena, "kartoteka, ceny, opis"].filter(Boolean).join(" · ");
}

export function streszczenieZamowienia(dane: OsRozmowy): string {
  const z = dane.zamowienie;
  if (!z) {
    const n = dane.kandydaciZamowien.length;
    return n ? `niepowiązane · ${n} ${odmien(n, "zakup", "zakupy", "zakupów")} klienta` : "niepowiązane";
  }
  const p = z.pobrane;
  const paczka = z.przesylka?.dostarczonoAt
    ? `doręczona ${dzien(z.przesylka.dostarczonoAt)}`
    : z.przesylka?.status ? STATUS_PACZKI[z.przesylka.status] ?? z.przesylka.status
      : "paczki nie sprawdzano";
  /* PACZKA PIERWSZA (0.500.0): wzrok czyta początek wiersza i pomija resztę
     (NN/g, wzorzec F, potwierdzony w 2017). O zamówieniu pytają najczęściej
     „gdzie paczka", więc to słowo ma stać tam, gdzie oko na pewno trafi. */
  if (!p) return `${paczka} · treść jeszcze nie pobrana`;
  return [paczka, p.kupionoAt ? dzien(p.kupionoAt) : null,
    p.sumaGrosze !== null ? zlote(p.sumaGrosze, p.waluta) : null].filter(Boolean).join(" · ");
}

export function streszczenieZamknietych(zwrotow: number, spraw: number): string {
  return [zwrotow ? `${zwrotow} ${odmien(zwrotow, "zwrot", "zwroty", "zwrotów")}` : null,
    spraw ? `${spraw} ${odmien(spraw, "sprawa", "sprawy", "spraw")}` : null].filter(Boolean).join(" · ");
}

export function streszczenieDoboru(dane: OsRozmowy): string {
  const d = dane.dobor;
  if (d.wybrany) return `${NAZWA_DOBORU[d.status]} · ${d.wybrany.symbol}`;
  const czego = [d.dane.nazwaCzesci, d.dane.marka, d.dane.model].filter(Boolean).join(" ");
  return czego ? `${NAZWA_DOBORU[d.status]} · ${czego}` : NAZWA_DOBORU[d.status];
}

const RODZAJ_HISTORII: Record<string, [string, string, string]> = {
  zakup: ["zakup", "zakupy", "zakupów"],
  rozmowa: ["rozmowa", "rozmowy", "rozmów"],
  zwrot: ["zwrot", "zwroty", "zwrotów"],
  reklamacja: ["reklamacja", "reklamacje", "reklamacji"],
  dyskusja: ["dyskusja", "dyskusje", "dyskusji"],
};

export function streszczenieKlienta(h: { wpisy: Array<{ rodzaj: string }>; maszyny: unknown[] } | undefined): string {
  if (!h) return "wczytuję…";
  const ile = new Map<string, number>();
  for (const w of h.wpisy) ile.set(w.rodzaj, (ile.get(w.rodzaj) ?? 0) + 1);
  const czesci = [...ile].map(([r, n]) => {
    const f = RODZAJ_HISTORII[r];
    return f ? `${n} ${odmien(n, f[0], f[1], f[2])}` : `${n} × ${r}`;
  });
  if (h.maszyny.length) czesci.push(`${h.maszyny.length} ${odmien(h.maszyny.length, "maszyna", "maszyny", "maszyn")}`);
  return czesci.length ? czesci.join(" · ") : "bez wcześniejszych spraw u nas";
}

export function streszczenieWiedzy(w: { zastosowanie: { dowody: unknown[] } | null; pomiary: unknown[] } | undefined): string {
  if (!w) return "wczytuję…";
  const n = (w.zastosowanie?.dowody.length ?? 0) + w.pomiary.length;
  return n ? `${n} ${odmien(n, "dowód", "dowody", "dowodów")}` : "brak wpisu dla tej pary";
}
