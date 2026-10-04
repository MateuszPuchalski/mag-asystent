import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { HistoriaKlienta, OsRozmowy, SzkicCopilota, WiedzaDoboru } from "../api/typy";
import { NaglowekSekcji, Przycisk, dzien, ile, odmien, termin } from "../ui";
import { OfertaRozmowy } from "./OfertaRozmowy";
import { ZamowienieRozmowy } from "./ZamowienieRozmowy";
import { ZamowieniaKlienta } from "./ZamowieniaKlienta";
import { ZwrotRozmowy } from "./ZwrotRozmowy";
import { SprawyZakupu } from "../sprawy/Spoiwo";
import { TowarRozmowy } from "./TowarRozmowy";
import { Dobor } from "./Dobor";
import { Klient } from "./Klient";
import { Wiedza } from "./Wiedza";
import { Paczka } from "./Paczka";
import { PasmoOdpowiedzi } from "./PasmoOdpowiedzi";
import { Soczewka } from "./Soczewki";
import { useHistoriaKlienta, useWiedzaDoboru } from "../api/rozmowy";
import type { Towar } from "../wyszukiwarka";
import { NAZWA_STANU_DOBORU, STATUS_PACZKI } from "./statusy";
import { bramkaDoboru, coSwieci, historiaPozaZakupem, klientWKolumnie, ofertaWKarcie, paczkaWyzej,
  paraPasowania, pozycjeWKolumnie, pozycjiDoWskazania, towarOtwartyNaStart, wiedzaMaTresc,
  zwrotWToku } from "./kokpit";

/**
 * Trzecia kolumna ekranu skrzynki (§10.1).
 *
 * Układ z trzema kolumnami stoi w projekcie od początku, a makieta
 * `docs/projekt-widokow/Main.dc.html` narysowała go poprawnie. Kontekst
 * leżał kiedyś w środkowej kolumnie, nad osią: cztery bloki jeden pod drugim
 * spychały pytanie klienta poniżej krawędzi okna, a to ono jest powodem,
 * dla którego agent tu przyszedł.
 *
 * ── DLACZEGO OFERTA I TOWAR TO JEDEN TEMAT ─────────────────────────────────
 * Właściciel przysłał zrzut z pracy: „powinniśmy wykorzystać puste miejsce
 * z boku". Osobna „Oferta" to jedenaście linijek w kolumnie wysokiej na
 * osiemset pikseli, a obok, niewidoczne, leżały zdjęcie towaru, stan, półka
 * i PARAMETRY KARTOTEKI. Klient pytał o wymiar gwintu korka, a parametr
 * „Gwint" stał w schowanej zakładce. Niewidoczne znaczyło nieistniejące.
 * Co klient kupuje i co mamy na półce to jeden temat oglądany z dwóch stron,
 * a odpowiedź prawie zawsze potrzebuje obu naraz.
 *
 * „Dobór" zostaje osobno, bo to nie karta faktów, tylko robota: własne
 * kroki, kandydaci, dowody i przyciski zmieniające stan rozmowy. „Wiedza"
 * stoi osobno, bo dowody wyszły z doboru i mają jedno miejsce, do którego
 * sięga się także po domkniętym doborze. „Klient" to czysty odczyt: login
 * wiąże zamówienia, rozmowy i maszyny z domkniętych doborów.
 *
 * Dwa zwrotne uchwyty idą ze `Skrzynka.tsx`, gdzie leży szkic i formularz
 * pomiaru: dobór wstawia zdanie do szkicu i podstawia kartotekę do zlecenia
 * — obu rzeczy nie ma prawa robić po cichu.
 *
 * ── CIEMNY KOKPIT ───────────────────────────────────────────────────────────
 * Nagranie właściciela pokazało zakładki i trzy kłopoty naraz. Nazwa towaru
 * stała cztery razy, zwrot do decyzji — jedyna rzecz z terminem — w połowie
 * przewijania, a zakładka z zerem kazała kliknąć, żeby usłyszeć „nic tu nie ma".
 *
 * Świeci to, co ma zegar albo czeka na ruch agenta: zwrot i sprawa w toku,
 * paczka poza zwykłą drogą, pozycja do wskazania i dobór w robocie. Stoi
 * w jednej ramie „Wymaga Ciebie". Dobór w ramie stoi zwinięty, bo kandydaci
 * zajmują kilkaset pikseli i zepchnęliby resztę ramy z kadru; jego stan mówi
 * streszczenie. Reszta to jedna linia na temat ze streszczeniem, rozwijana
 * kliknięciem. Reguły świecenia stoją w `kokpit.ts`, każda z testem, bo szara
 * linia jest bezpieczna tylko wtedy, gdy reguła „w normie" nie kłamie.
 *
 * ── JEDEN DOM FAKTU ─────────────────────────────────────────────────────────
 * Karta zakupu nad osią mówi zakup i klienta: towar, numer, sumę, kroki
 * z datami i historię w liczbach. Kolumna mówi Subiekt, paczkę i robotę.
 * Ten sam fakt w dwóch domach kazał sprawdzać, czy oba mówią to samo.
 * Fakt z karty wraca tu tylko jako odpowiedź, którą agent musi mieć bez
 * przewijania osi: wiersz „Zamówił" w paśmie i data doręczenia w bloku
 * paczki. Karta bywa poza kadrem, a obie rzeczy rozstrzygają odpowiedź.
 *
 * Kolumna niczego nie zapisuje przy rozwijaniu: wiersze to stan ekranu,
 * a treść pod nimi to te same odczyty, które i tak stoją w pamięci zapytań.
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
  /* Kategoria dla domyślnego rozwinięcia: człowieka, a bez niej modelu —
     ale nie awaryjna ani nieudana, bo te nie mówią, o co pyta klient. */
  const kop = dane.rozmowa.kopilot;
  const kategoria = kop?.kategoriaCzlowieka
    ?? (kop && kop.zrodlo !== "FALLBACK" && kop.status !== "FAILED" ? kop.kategoria : null);
  const [otwarte, setOtwarte] = useState<ReadonlySet<Temat>>(
    () => new Set<Temat>(towarOtwartyNaStart(swiatla, kategoria) ? ["towar"] : []));
  const przelacz = (t: Temat) => setOtwarte((o) => {
    const n = new Set(o);
    if (n.has(t)) n.delete(t); else n.add(t);
    return n;
  });
  /* „Szukaj mimo to" przy bramce doboru. Stan ekranu, nie zapis: bramka
     wraca przy następnym otwarciu rozmowy, bo towar dalej jest znany. */
  const [szukamMimoTo, setSzukamMimoTo] = useState(false);

  /* Historia i wiedza decydują, czy wiersze „Klient" i „Wiedza" w ogóle
     staną. To te same klucze, które wiersze wołają po rozwinięciu, więc przy
     rozwinięciu nic nie idzie drugi raz. Same odczyty: zero zapisu przy
     patrzeniu zostaje nietknięte. */
  const historia = useHistoriaKlienta(dane.rozmowa.id);
  const wiedza = useWiedzaDoboru(dane.rozmowa.id);

  const zwrotyWToku = dane.zwroty.filter(zwrotWToku);
  const zwrotyZamkniete = dane.zwroty.filter((z) => !zwrotWToku(z));
  const sprawyOtwarte = dane.sprawy.filter((x) => x.otwarta);
  const sprawyZamkniete = dane.sprawy.filter((x) => !x.otwarta);
  const bramka = bramkaDoboru(dane) && !szukamMimoTo;
  /* Dobór po „Szukaj mimo to" NIE świeci. Agent sam go otworzył, więc nie
     czeka na niego nic nowego, a wiersz staje otwarty tuż pod przyciskiem. */
  const doborSwieci = swiatla.includes("dobor");
  const paczkaSwieci = swiatla.includes("paczka");
  const pozycjaSwieci = swiatla.includes("pozycja");
  /* Licznik liczy każdą narysowaną pozycję osobno. Dwie sprawy pod jedną
     liczbą mówiły „1", a agent szukał drugiej na ślepo. */
  const ileSwieci = zwrotyWToku.length + sprawyOtwarte.length + (paczkaSwieci ? 1 : 0)
    + (pozycjaSwieci ? 1 : 0) + (doborSwieci ? 1 : 0);

  const zamowienieId = dane.zamowienie?.externalId ?? null;
  /* Pozycja tej oferty w zamówieniu: jej cena z chwili zakupu pozwala
     powiedzieć, że oferta dziś kosztuje inaczej. */
  const pozycjaRozmowy = dane.zamowienie?.pobrane?.pozycje
    .find((p) => p.offerId !== null && p.offerId === oferta?.externalId) ?? null;
  /* Paczka stoi w kolumnie dokładnie raz: w soczewce, w ramie albo tutaj. */
  const paczkaWRzedzie = dane.zamowienie !== null && !paczkaWyzej(dane);
  const pozycjeWRzedzie = pozycjeWKolumnie(dane) && !pozycjaSwieci;
  /* Zamówienie rozmowy ma dom w karcie zakupu. Na liście zakupów klienta
     stałoby drugi raz, a „to nie ta paczka?" wskazywałoby samo siebie. */
  const inneZakupy = dane.kandydaciZamowien.filter((k) => k.externalId !== zamowienieId);
  const zamowienieMaTresc = paczkaWRzedzie || pozycjeWRzedzie || inneZakupy.length > 0;
  const klient = historia.data && klientWKolumnie(historia.data, zamowienieId)
    ? historiaPozaZakupem(historia.data, zamowienieId) ?? null : null;

  const dobor = <Dobor key={dane.rozmowa.id} dobor={dane.dobor} rozmowaId={dane.rozmowa.id}
    onWstawDoSzkicu={onWstawDoSzkicu} onZlecPomiar={onZlecPomiar} />;

  return <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Kontekst">
    {/* PASMO ODPOWIEDZI NAD KOLUMNĄ. Trzy fakty, które rozstrzygają odpowiedź,
        stoją nad wszystkim innym i poza przewijaniem. Granice w
        `PasmoOdpowiedzi.tsx`. */}
    <PasmoOdpowiedzi dane={dane} />

    {/* JEDEN przewijak na kolumnę, jak przy zwrotach: dwa zagnieżdżone dają
        pasek w pasku, a treść bez `min-h-0` rozpycha kartę poza okno.
        KRESKĘ DAJE RODZIC. Każdy blok z własną kreską dawał podwójne linie
        w pięciu miejscach, bo sąsiad dokładał swoją. Żaden blok niżej nie ma
        więc ani `border-b`, ani `border-t`. */}
    <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto">
      {/* SOCZEWKA NAD WSZYSTKIM: odpowiedź na pytanie klienta stoi przed tym,
          co ma termin, bo po nią agent otwiera rozmowę. Niczego nie chowa —
          „Wymaga Ciebie" i wiersze stoją pod nią jak bez niej. */}
      <Soczewka dane={dane} onWstawDoSzkicu={onWstawDoSzkicu} />

      {/* JEDNA RAMA, NAGŁÓWEK W ŚRODKU. Ramka wokół każdej pozycji osobno
          dawała stos pudełek, a nagłówek nad nimi stał poza żadnym. Rama
          siedzi w opakowaniu, bo `divide-y` rodzica nadpisałby jej grubość
          u góry. 6 px wcięcia, 2 px ramy i 8 px pozycji trzymają tekst na
          osi 16 px, tej samej co w całej kolumnie. */}
      {ileSwieci > 0 && <div className="px-1.5 py-3">
        <section aria-label="Wymaga Ciebie" className="rounded-lg border-2 border-amber-400">
          <NaglowekSekcji jako="h3" ton="text-ranga-uwaga" className="px-2 pb-1 pt-2.5">
            Wymaga Ciebie · {ileSwieci}</NaglowekSekcji>
          {/* Kolejność zegara: zwrot i sprawa mają termin Allegro, paczka
              czeka na klienta, wskazanie i dobór to praca bez terminu. */}
          <div className="divide-y divide-slate-200">
            {zwrotyWToku.map((z) => <div key={`zwrot-${z.id}`} className="px-2 py-2.5">
              <ZwrotRozmowy zwrot={z} /></div>)}
            {/* Każda sprawa osobno, ta sama linijka co na zwrotach, reklamacjach
                i dyskusjach. Spoiwo daje elementowi `px-2`, więc tu go nie ma. */}
            {sprawyOtwarte.map((s) => <div key={`sprawa-${s.id}`} className="py-1.5">
              <SprawyZakupu sprawy={[s]} wSekcji /></div>)}
            {/* Zdanie prowadzące paczki jest tytułem tej pozycji. */}
            {paczkaSwieci && dane.zamowienie && <div className="px-2 py-2.5">
              <Paczka zamowienie={dane.zamowienie} rozmowaId={dane.rozmowa.id} /></div>}
            {/* Prośba jest tytułem pozycji, a liczba pozycji stoi przy niej.
                Osobne zdanie „Zamówienie ma N pozycji" mówiło to samo drugi raz. */}
            {pozycjaSwieci && dane.zamowienie && <div className="space-y-2 px-2 py-2.5">
              <p className="text-sm"><b className="text-wertis-ink">Wskaż pozycję, o którą pyta klient</b>
                <span className="text-xs text-slate-600"> · {ile(kilkaPozycji, "pozycja", "pozycje", "pozycji")}</span></p>
              <ZamowienieRozmowy zamowienie={dane.zamowienie} rozmowaId={dane.rozmowa.id} ofertaRozmowy={null} />
            </div>}
            {doborSwieci && <Wiersz wRamie tytul="Dobór" streszczenie={streszczenieDoboru(dane)}
              otwarty={otwarte.has("dobor")} onPrzelacz={() => przelacz("dobor")}>{dobor}</Wiersz>}
          </div>
        </section>
      </div>}

      {/* KOLEJNOŚĆ: oferta i towar, dobór, zamówienie, sprawy zamknięte,
          klient, wiedza. Od tego, co klient kupował, do tego, co wiemy. */}
      {/* BRAK OFERTY MÓWI SIĘ RAZ (decyzja właściciela z 28 września 2026).
          Baner nad rozmową mówi o braku razem z czynnościami, a przy
          zamówieniu z kilku pozycji prośbę niesie „Wymaga Ciebie". Wiersz
          zostaje streszczeniem bez treści do rozwinięcia: przycisk, który
          rozwija pustkę, to klik bez odpowiedzi. */}
      {oferta
        ? <Wiersz tytul="Oferta i towar" streszczenie={streszczenieOferty(dane)}
          otwarty={otwarte.has("towar")} onPrzelacz={() => przelacz("towar")}>
          {/* Tytuł, SKU i zdjęcie oferty stoją tu tylko wtedy, gdy karta
              zakupu ich nie pokazuje. Cena z zakupu pozwala ofercie powiedzieć
              wyłącznie różnicę. */}
          <OfertaRozmowy oferta={oferta} zTytulem={!ofertaWKarcie(dane)}
            cenaZakupuGrosze={pozycjaRozmowy?.cenaGrosze ?? null} />
          <TowarRozmowy oferta={oferta} rozmowaId={dane.rozmowa.id} />
          {/* „Szukaj innego towaru mimo to" stoi tutaj, a nie we własnym
              wierszu „Dobór: zbędny", który przy każdej takiej rozmowie mówił,
              że czegoś NIE trzeba robić. Kliknięcie OTWIERA dobór: bez tego
              wiersz wracał zwinięty i przycisk wyglądał, jakby nie zrobił nic.
              Bramka wymaga oferty, więc stoi wyłącznie w tej gałęzi. */}
          {bramka && <BramkaDoboru onSzukaj={() => {
            setSzukamMimoTo(true);
            setOtwarte((o) => new Set(o).add("dobor"));
          }} />}
        </Wiersz>
        /* WYJĄTEK: baner milknie, gdy zamówienie jest znane (`brakPowiazania`).
           Zamówienie bez oferty i nie z kilku pozycji zostawiało wtedy samo
           „bez oferty”, bez słowa, co zrobić — więc to jedno zdanie wraca tu. */
        : dane.zamowienie && !kilkaPozycji
          ? <Wiersz tytul="Oferta i towar" streszczenie={streszczenieOferty(dane)}
              otwarty={otwarte.has("towar")} onPrzelacz={() => przelacz("towar")}>
              <p className="text-sm text-slate-600">
                Zamówienie nie wskazuje oferty, więc nie ma z czego wywieść kartoteki.
                Wskaż ofertę przy rozmowie, a towar pojawi się tutaj.</p>
            </Wiersz>
          : <Wiersz tytul="Oferta i towar" streszczenie={streszczenieOferty(dane)} />}

      {/* DOBÓR POD TOWAREM. Bramka jest ostatnią linią bloku towaru, więc dobór
          otwiera się dokładnie w miejscu klikniętego przycisku i wzrok nie
          musi go szukać na dole kolumny. */}
      {!doborSwieci && !bramka && <Wiersz tytul="Dobór" streszczenie={streszczenieDoboru(dane)}
        otwarty={otwarte.has("dobor")} onPrzelacz={() => przelacz("dobor")}>
        {dobor}
      </Wiersz>}

      {/* ZAMÓWIENIE: paczka, gdy nie stoi wyżej, lista pozycji, gdy któraś nie
          jest ofertą rozmowy, i inne zakupy klienta. Wiersz stoi także bez
          zamówienia, bo zakupy klienta są wtedy jedyną drogą do powiązania.
          Bez żadnej z tych rzeczy jest samym streszczeniem, nie przyciskiem. */}
      <Wiersz tytul="Zamówienie" streszczenie={streszczenieZamowienia(dane)}
        {...(zamowienieMaTresc ? { otwarty: otwarte.has("zamowienie"), onPrzelacz: () => przelacz("zamowienie") } : {})}>
        {paczkaWRzedzie && dane.zamowienie && <Paczka zamowienie={dane.zamowienie} rozmowaId={dane.rozmowa.id} />}
        {pozycjeWRzedzie && dane.zamowienie && <ZamowienieRozmowy zamowienie={dane.zamowienie}
          rozmowaId={dane.rozmowa.id} ofertaRozmowy={oferta?.externalId ?? null} />}
        <ZamowieniaKlienta kandydaci={inneZakupy} rozmowaId={dane.rozmowa.id}
          maZamowienie={dane.zamowienie !== null} />
      </Wiersz>

      {(zwrotyZamkniete.length > 0 || sprawyZamkniete.length > 0) &&
        <Wiersz tytul="Zamknięte sprawy" streszczenie={streszczenieZamknietych(
          zwrotyZamkniete.length, sprawyZamkniete.length)}
          otwarty={otwarte.has("zamkniete")} onPrzelacz={() => przelacz("zamkniete")}>
          {zwrotyZamkniete.length > 0 && <ul className="divide-y divide-slate-200">
            {zwrotyZamkniete.map((z) => <li key={z.id} className="py-2"><ZwrotRozmowy zwrot={z} /></li>)}
          </ul>}
          {/* Bez drugiego nagłówka: tytuł wiersza mówi już, co leży pod nim. */}
          {sprawyZamkniete.length > 0 && <SprawyZakupu sprawy={sprawyZamkniete} wSekcji />}
        </Wiersz>}

      {/* Klient staje tylko z treścią POZA tym zakupem. Wpisy tego zakupu mają
          dom w karcie, w ramie, w „Zamkniętych sprawach" i w osi; reguła stoi
          w `kokpit.ts` przy `klientWKolumnie`. */}
      {klient && <Wiersz tytul="Klient" streszczenie={streszczenieWierszaKlienta(klient)}
        otwarty={otwarte.has("klient")} onPrzelacz={() => przelacz("klient")}>
        <Klient key={dane.rozmowa.id} rozmowaId={dane.rozmowa.id} onOtworzRozmowe={onOtworzRozmowe}
          zamowienieId={zamowienieId} />
      </Wiersz>}

      {/* Maszyna z DANYCH DOBORU, nie z historii klienta: pomiar ma pasować do
          tego, o co pyta ta rozmowa. Szkic Copilota jedzie tu, bo pasowanie
          rozpoznane w rozmowie jest pracą nad wiedzą, nie odpowiedzią klientowi. */}
      {wiedzaMaTresc(wiedza.data, dane.szkicCopilota) && <Wiersz tytul="Wiedza"
        streszczenie={streszczenieWiedzy(wiedza.data, dane.szkicCopilota)}
        otwarty={otwarte.has("wiedza")} onPrzelacz={() => przelacz("wiedza")}>
        <Wiedza key={dane.rozmowa.id} rozmowaId={dane.rozmowa.id}
          twId={dane.dobor.wybrany?.twId ?? null}
          maMaszyne={Boolean(dane.dobor.dane.marka && dane.dobor.dane.model)}
          propozycja={dane.szkicCopilota} />
      </Wiersz>}
    </div>
  </section>;
}

/**
 * Jeden temat kolumny: tytuł, streszczenie, treść po rozwinięciu.
 *
 * Streszczenie jest ZAPACHEM informacji (Pirolli i Card): mówi, co jest pod
 * spodem, zanim ktoś kliknie. Tego nie umiała zakładka z samym zerem.
 * Wysokość 44 px, bo to cel dla myszy i dla palca na tablecie w hali.
 *
 * SZEWRON PO PRAWEJ. Z lewej spychał tytuł na 38 px, a treść po rozwinięciu
 * stała lewiej od własnego tytułu. Teraz tytuł, treść i pozycje ramy
 * zaczynają się na tej samej osi 16 px.
 */
function Wiersz({ tytul, streszczenie, otwarty = false, onPrzelacz, wRamie = false, children }: {
  tytul: string;
  streszczenie: React.ReactNode;
  otwarty?: boolean;
  /** Bez uchwytu wiersz jest samym streszczeniem — nie ma czego rozwijać. */
  onPrzelacz?: () => void;
  /** W ramie „Wymaga Ciebie" wcięcie daje po części rama, więc wiersz bierze mniej. */
  wRamie?: boolean;
  children?: React.ReactNode;
}) {
  const px = wRamie ? "px-2" : "px-4";
  /* Wiersz bez treści NIE jest przyciskiem. Ta sama wysokość i ta sama oś
     co wiersz rozwijany, tylko bez szewronu, bo szewron obiecuje rozwinięcie. */
  if (!onPrzelacz) {
    return <div className={`flex min-h-11 items-center gap-2 ${px} py-2`}>
      <b className="shrink-0 text-sm text-wertis-ink">{tytul}</b>
      <span className="min-w-0 truncate text-xs text-slate-600">{streszczenie}</span>
    </div>;
  }
  /* Streszczenie zostaje także po rozwinięciu: stan doboru niesie właśnie
     ono, a treść pod spodem bywa długa. */
  return <div>
    <button type="button" aria-expanded={otwarty} onClick={onPrzelacz}
      className={`flex min-h-11 w-full items-center gap-2 ${px} py-2 text-left hover:bg-slate-50`}>
      <b className="shrink-0 text-sm text-wertis-ink">{tytul}</b>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{streszczenie}</span>
      <ChevronDown size={14} aria-hidden
        className={`ml-auto shrink-0 text-slate-500 transition-transform ${otwarty ? "rotate-180" : ""}`} />
    </button>
    {otwarty && <div className={`space-y-4 ${px} pb-4 pt-1`}>{children}</div>}
  </div>;
}

/**
 * Bramka doboru — reguła i powód w `kokpit.ts` przy `towarZnany`.
 *
 * Nazwy i SKU tu nie ma, bo mówi je karta zakupu, a „Pasuje do" stoi w tym
 * samym bloku wyżej. Zostaje fakt, że dobór nie szuka, i droga, żeby mimo to
 * zaczął.
 */
function BramkaDoboru({ onSzukaj }: { onSzukaj: () => void }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600">
    <span><b className="text-slate-900">Towar znany z zamówienia.</b> Dobór części nie szuka innego.</span>
    <Przycisk className="text-xs" onClick={onSzukaj}>Szukaj innego towaru mimo to</Przycisk>
  </div>;
}

/* ── STRESZCZENIA WIERSZY ──────────────────────────────────────────────────
   Każde mówi WYŁĄCZNIE to, czego nie mówi pasmo ani karta zakupu: bez nazwy,
   SKU, stanu, ceny, numeru, sumy i dat zakupu. Fakt z cudzego domu byłby
   tu drugim zapisem, który trzeba porównywać z pierwszym. */

const STATUS_OFERTY: Record<string, string> = {
  ACTIVE: "aktywna", ENDED: "zakończona", INACTIVE: "nieaktywna", ACTIVATING: "aktywuje się",
};

export function streszczenieOferty(dane: OsRozmowy): string {
  const o = dane.oferta;
  /* „bez oferty": streszczenie jest jedynym miejscem braku w kolumnie,
     a słowo „powiązanej" niesie już baner nad rozmową. */
  if (!o) return pozycjiDoWskazania(dane) ? "do wskazania w zamówieniu" : "bez oferty";
  if (!o.pobrana) return "treść oferty jeszcze nie pobrana";
  /* Stan oferty słowem i to, skąd mamy kartotekę. Cenę mówi karta zakupu,
     a stałe „kartoteka, ceny, opis" nie było daną, tylko spisem treści. */
  const status = o.pobrana.status ? STATUS_OFERTY[o.pobrana.status] ?? o.pobrana.status : null;
  const k = o.kartoteka;
  const kartoteka = k.pewnosc === "sku" ? "kartoteka po SKU" : k.pewnosc === "pamiec" ? "kartoteka wskazana"
    : k.twId !== null ? "propozycja kartoteki" : "bez kartoteki";
  return [status, kartoteka].filter(Boolean).join(" · ");
}

export function streszczenieZamowienia(dane: OsRozmowy): string {
  const z = dane.zamowienie;
  if (!z) {
    const n = dane.kandydaciZamowien.length;
    return n ? `niepowiązane · ${n} ${odmien(n, "zakup", "zakupy", "zakupów")} klienta` : "niepowiązane";
  }
  /* PACZKA PIERWSZA: wzrok czyta początek wiersza i pomija resztę (NN/g,
     wzorzec F). O zamówieniu pytają najczęściej „gdzie paczka". Gdy paczka
     stoi wyżej, w soczewce albo w ramie, streszczenie jej nie powtarza.
     Daty doręczenia tu nie ma: mówi ją karta zakupu i blok paczki. */
  const s = z.przesylka;
  const paczka = paczkaWyzej(dane) ? null
    : s?.dostarczonoAt ? "doręczona"
      : s?.status ? STATUS_PACZKI[s.status] ?? s.status
        : s?.sprawdzonoAt ? (s.waybill ? "nadana, bez statusu" : "bez numeru przesyłki")
          : "paczki nie sprawdzano";
  /* Metoda dostawy odpowiada na „kurier czy paczkomat". Liczba pozycji staje
     tylko wtedy, gdy lista pod wierszem naprawdę stoi. */
  const lista = pozycjeWKolumnie(dane) && !pozycjiDoWskazania(dane);
  return [paczka, z.pobrane ? z.pobrane.dostawaMetoda : "treść jeszcze nie pobrana",
    lista ? ile(z.pobrane?.pozycje.length ?? 0, "pozycja", "pozycje", "pozycji") : null]
    .filter(Boolean).join(" · ") || "paczka wyżej";
}

export function streszczenieZamknietych(zwrotow: number, spraw: number): string {
  return [zwrotow ? `${zwrotow} ${odmien(zwrotow, "zwrot", "zwroty", "zwrotów")}` : null,
    spraw ? `${spraw} ${odmien(spraw, "sprawa", "sprawy", "spraw")}` : null].filter(Boolean).join(" · ");
}

/* Stan i to, co go opisuje: przy wybranej części jej symbol, przy reszcie
   to, czego klient szuka. Symbol wygrywa, bo po wyniku liczy się odpowiedź. */
export function streszczenieDoboru(dane: OsRozmowy): string {
  const d = dane.dobor;
  const stan = NAZWA_STANU_DOBORU[d.stan] ?? d.stan;
  if (d.wybrany) return `${stan} · ${d.wybrany.symbol}`;
  const czego = [d.dane.nazwaCzesci, d.dane.marka, d.dane.model].filter(Boolean).join(" ");
  return czego ? `${stan} · ${czego}` : stan;
}

/**
 * Streszczenie wiersza „Klient": tylko to, czego karta zakupu nie ma.
 *
 * Liczniki („2 zakupy · 1 zwrot") mówi karta jako „Wcześniej u nas". Tu
 * zostaje sprawa klienta z następnym krokiem, maszyna z domkniętego doboru
 * i data ostatniego kontaktu. Historia przychodzi już bez tego zakupu.
 */
export function streszczenieWierszaKlienta(h: HistoriaKlienta): React.ReactNode {
  const czesci: React.ReactNode[] = [];
  const s = h.sprawa;
  if (s?.stan === "w_toku") {
    czesci.push(<>sprawa: {s.krok} · {termin(s.krokDo)}
      {s.poTerminie && <b className="text-ranga-zle"> po terminie</b>}</>);
  }
  const m = h.maszyny[0];
  if (m) {
    czesci.push([m.marka, m.nazwa, m.wariant].filter(Boolean).join(" ")
      + (m.rocznik ? ` (${m.rocznik})` : "")
      + (h.maszyny.length > 1 ? ` +${h.maszyny.length - 1}` : ""));
  }
  /* Wpis bez czytelnej daty pomijamy: „ostatnio —" nie mówi nic. */
  const ostatni = h.wpisy.find((w) => Boolean(w.at) && !Number.isNaN(Date.parse(w.at)));
  if (ostatni) czesci.push(`ostatnio ${dzien(ostatni.at)}`);
  if (czesci.length === 0) return s ? "sprawa klienta zakończona" : "historia u nas";
  return czesci.map((c, i) => <React.Fragment key={i}>{i > 0 && " · "}{c}</React.Fragment>);
}

const RODZAJ_HISTORII: Record<string, [string, string, string]> = {
  zakup: ["zakup", "zakupy", "zakupów"],
  rozmowa: ["rozmowa", "rozmowy", "rozmów"],
  zwrot: ["zwrot", "zwroty", "zwrotów"],
  reklamacja: ["reklamacja", "reklamacje", "reklamacji"],
  dyskusja: ["dyskusja", "dyskusje", "dyskusji"],
};

/**
 * Historia w liczbach — „Wcześniej u nas" w karcie zakupu.
 *
 * Jedynym użytkownikiem jest karta: wiersz „Klient" liczników nie mówi,
 * bo karta mówi je już nad osią. Funkcja stoi tutaj, bo słownik rodzajów
 * jest wspólny z resztą streszczeń kolumny.
 */
export function streszczenieKlienta(h: HistoriaKlienta): string {
  const liczby = new Map<string, number>();
  for (const w of h.wpisy) liczby.set(w.rodzaj, (liczby.get(w.rodzaj) ?? 0) + 1);
  const czesci = [...liczby].map(([r, n]) => {
    const f = RODZAJ_HISTORII[r];
    return f ? `${n} ${odmien(n, f[0], f[1], f[2])}` : `${n} × ${r}`;
  });
  if (h.maszyny.length) czesci.push(`${h.maszyny.length} ${odmien(h.maszyny.length, "maszyna", "maszyny", "maszyn")}`);
  return czesci.join(" · ");
}

export function streszczenieWiedzy(w: WiedzaDoboru | undefined, szkic: SzkicCopilota | null = null): string {
  const para = paraPasowania(szkic) ? "pasowanie od Copilota" : null;
  if (!w || (w.zastosowanie === null && w.pomiary.length === 0)) return para ?? "wpis bez dowodów";
  const n = (w.zastosowanie?.dowody.length ?? 0) + w.pomiary.length;
  /* Wiersz staje tylko z treścią, więc zero dowodów znaczy tu wpis bez nich. */
  return [n ? `${n} ${odmien(n, "dowód", "dowody", "dowodów")}` : "wpis bez dowodów", para]
    .filter(Boolean).join(" · ");
}
