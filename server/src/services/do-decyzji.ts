import { db } from "../db/db.js";
import { config } from "../config.js";
import { listUnresolved } from "./problems.js";
import { odpowiedziNieprzeczytane } from "./notatki.js";
import { listaKoszy, pominietePozycje } from "./kosze.js";
import { eanConflictReport } from "./ean.js";
import { stanPolaczenia } from "./allegro-token.js";
import { listaZwrotow } from "./zwroty.js";
import { listaReklamacji, progKolejki } from "./reklamacje.js";
import { listaDyskusji } from "./dyskusje.js";
import { listaRozmow } from "./skrzynka.js";

/* ── DO DECYZJI — jedna lista tego, co czeka na biuro (`docs/obsluga-klienta.md` §7) ──
   Cel biura zapisany przy decyzji o jednym froncie: biuro rozstrzyga to,
   czego hala nie rozstrzygnie sama. Do tej wersji te rozstrzygnięcia stały
   w siedmiu miejscach dwóch frontów — wyjątki dostaw w jednej karcie,
   odpowiedzi hali w drugiej, błędy zapisu do Subiekta pod STANEM SYSTEMU,
   kolizje kodów jeszcze niżej, a cztery kolejki klienta w osobnych
   zakładkach. Człowiek musiał pamiętać, gdzie zajrzeć — a dekalog (pkt 2)
   każe rozpoznawać, nie pamiętać.

   LICZONE W LOCIE, BEZ TABELI I BEZ STATUSU. `CLAUDE.md` zakazuje piątej
   tabeli ze wspólnym statusem nad kolejkami i ten zakaz obowiązuje tu
   dosłownie: każda pozycja jest ODCZYTEM ze źródła, które już istnieje,
   a rozstrzyga się ją w tym źródle, przy dowodach. Lista nie ma własnego
   „załatwione" — gaśnie, gdy zgaśnie przyczyna. Pilnuje tego test: w tym
   pliku nie ma `CREATE TABLE` ani zapisu, a odczyt nie zmienia bazy.

   KOLEJKI KLIENTA JADĄ LICZBĄ, NIE WIERSZAMI. Reklamacja czy rozmowa ma
   własny ekran z kolejką i dowodami, a trzydzieści rozmów przepisanych tutaj
   zrobiłoby z tej listy drugą skrzynkę. Jeden wiersz na kolejkę mówi „tam
   czeka tyle, najstarsze od wtedy" i prowadzi na miejsce. Magazyn jedzie
   wierszem na sprawę, bo jego spraw jest kilka, a nie kilkadziesiąt.

   KOLEJKI LICZĄ TE SAME FUNKCJE, CO ICH TRASY — `listaZwrotow`,
   `listaReklamacji` z tym samym progiem, `listaRozmow`. Własne zapytanie
   „ile czeka" rozjechałoby się z licznikiem na zakładce przy pierwszej
   poprawce kubełka, a objawem byłyby dwie różne liczby o jednej kolejce. */

export type Obszar = "magazyn" | "obsluga";

export type ZrodloDecyzji =
  | "dostawy" | "odpowiedzi" | "kosze" | "zapisy" | "kody" | "allegro"
  | "reklamacje" | "zwroty" | "skrzynka" | "dyskusje";

/**
 * Dokąd prowadzi wiersz — adres w panelu. Do 0.441.0 był tu też wariant
 * `{ biuro: "nadzor" }` dla stanu systemu, który mieszkał jeszcze w biurze;
 * przeszedł, a razem z nim zniknął ostatni wiersz prowadzący poza panel.
 * Stan systemu dostaje w adresie KARTĘ, bo wiersz ma trafić tam, gdzie
 * rozstrzyga się jego sprawa, a nie na górę ekranu.
 */
export type CelDecyzji = { panel: string };

export interface PozycjaDecyzji {
  /** Stały klucz wiersza — ta sama sprawa ma ten sam klucz w każdym odczycie. */
  klucz: string;
  obszar: Obszar;
  zrodlo: ZrodloDecyzji;
  /** Pytanie, na które biuro odpowiada — pierwsze, co się czyta. */
  pytanie: string;
  /** O czym jest sprawa: numer, dostawca, towar, liczba. */
  co: string;
  /** Od kiedy czeka (ISO). `null` = źródło tej daty nie zna. */
  od: string | null;
  /** Termin minął albo mija — wiersz idzie na górę bez względu na wiek. */
  pilne: boolean;
  cel: CelDecyzji;
}

export interface DoDecyzji {
  pozycje: PozycjaDecyzji[];
  liczniki: Record<"wszystko" | Obszar, number>;
}

const najstarsza = (daty: Array<string | null | undefined>): string | null =>
  daty.filter((d): d is string => Boolean(d)).sort()[0] ?? null;

/** Ile czegoś — z odmianą, bo „3 wyjątek" na liście, którą czyta się w biegu, zatrzymuje oko. */
function ile(n: number, jeden: string, dwa: string, piec: string): string {
  const r10 = n % 10, r100 = n % 100;
  const forma = n === 1 ? jeden : r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? dwa : piec;
  return `${n} ${forma}`;
}

/* ── MAGAZYN ────────────────────────────────────────────────────────────── */

/**
 * Dostawy z otwartym wyjątkiem — wiersz na DOKUMENT, nie na wyjątek.
 *
 * Reklamuje się fakturę, nie pojedynczą pozycję: protokół dla dostawcy
 * obejmuje wszystkie wyjątki dokumentu naraz. Sześć wierszy o jednej fakturze
 * kazałoby sześć razy wejść w to samo miejsce.
 */
function dostawyZWyjatkiem(): PozycjaDecyzji[] {
  const otwarte = listUnresolved();
  const wgDostawy = new Map<number, typeof otwarte>();
  const bezDostawy: typeof otwarte = [];
  for (const p of otwarte) {
    if (p.deliveryId == null) { bezDostawy.push(p); continue; }
    const lista = wgDostawy.get(p.deliveryId) ?? [];
    lista.push(p);
    wgDostawy.set(p.deliveryId, lista);
  }
  /* Numer dokumentu Subiekta po `deliveryId` — ekran dostaw ma adres po
     `dokId`, bo dokumentu nietkniętego nie da się inaczej nazwać. */
  const dostawy = wgDostawy.size
    ? db().prepare(`SELECT id, sgt_dok_id AS dokId, sgt_dok_numer AS nr, dostawca
        FROM delivery WHERE id IN (${[...wgDostawy.keys()].map(() => "?").join(",")})`)
      .all(...wgDostawy.keys()) as Array<{ id: number; dokId: number; nr: string; dostawca: string | null }>
    : [];
  const wiersze: PozycjaDecyzji[] = dostawy.map((d) => {
    const lista = wgDostawy.get(d.id) ?? [];
    return {
      klucz: `dostawa:${d.dokId}`, obszar: "magazyn", zrodlo: "dostawy",
      pytanie: "Reklamować u dostawcy czy zamknąć wyjątki?",
      co: [d.nr, d.dostawca, ile(lista.length, "wyjątek", "wyjątki", "wyjątków")]
        .filter(Boolean).join(" · "),
      od: najstarsza(lista.map((p) => p.createdAt)),
      pilne: false,
      cel: { panel: `/obsluga/dostawy/${d.dokId}` },
    };
  });
  /* Towar SPOZA dokumentu nie ma faktury, przy której usiąść — ale dalej
     czeka na decyzję. Schowanie go byłoby zgubieniem zgłoszenia. */
  if (bezDostawy.length) {
    wiersze.push({
      klucz: "dostawa:bez-dokumentu", obszar: "magazyn", zrodlo: "dostawy",
      pytanie: "Co z towarem spoza dokumentu?",
      co: ile(bezDostawy.length, "wyjątek bez dostawy", "wyjątki bez dostawy", "wyjątków bez dostawy"),
      od: najstarsza(bezDostawy.map((p) => p.createdAt)),
      pilne: false,
      cel: { panel: "/obsluga/dostawy" },
    });
  }
  return wiersze;
}

/** Odpowiedź hali na notatkę biura — wiersz na odpowiedź, bo każda jest o innym pytaniu. */
function odpowiedziHali(): PozycjaDecyzji[] {
  return odpowiedziNieprzeczytane().map((o) => ({
    klucz: `odpowiedz:${o.id}`, obszar: "magazyn" as const, zrodlo: "odpowiedzi" as const,
    pytanie: "Przeczytać odpowiedź z hali",
    co: [o.nrPelny, o.odpBy, o.odpowiedz].filter(Boolean).join(" · "),
    od: o.odpAt,
    pilne: false,
    cel: { panel: `/obsluga/dostawy/${o.dokId}` },
  }));
}

/**
 * Kosze: pominięta pozycja i koszyk zwrotów, który czeka na zamknięcie.
 *
 * Koszyk bez pozycji NIE wchodzi. Pusty otwarty koszyk to stan spoczynku,
 * a nie decyzja — wiersz „zamknąć?" przy zerze sztuk pytałby o nic.
 */
function kosze(): PozycjaDecyzji[] {
  const pominiete: PozycjaDecyzji[] = pominietePozycje().map((p) => ({
    klucz: `pominieta:${p.pozycjaId}`, obszar: "magazyn", zrodlo: "kosze",
    pytanie: "Pominięta pozycja — załatwione?",
    co: `${p.symbol} · ${p.kod}${p.powod ? ` · ${p.powod}` : ""}`,
    od: p.at,
    pilne: false,
    /* Kosze mieszkają od 0.438.0 w zakładce Zwroty, bo tam powstają. */
    cel: { panel: "/obsluga/zwroty/kosze" },
  }));
  const otwarte: PozycjaDecyzji[] = listaKoszy()
    .filter((k) => k.status === "otwarty" && (k.rodzaj ?? "zwroty") === "zwroty" && k.pozycji > 0)
    .map((k) => ({
      klucz: `kosz:${k.id}`, obszar: "magazyn", zrodlo: "kosze",
      pytanie: "Zamknąć koszyk i wysłać na halę?",
      co: `${k.kod} · ${ile(k.pozycji, "pozycja", "pozycje", "pozycji")}`,
      od: k.utworzonoAt,
      pilne: false,
      /* Koszyk zwrotów zamyka się w ZWROTACH, obok tego, co do niego wpadło. */
      cel: { panel: "/obsluga/zwroty" },
    }));
  return [...pominiete, ...otwarte];
}

/**
 * Zapis do Subiekta w błędzie — wiersz na zadanie.
 *
 * PILNY, bo stoi za nim rozjazd stanu między halą a bazą firmy, który rośnie
 * z każdą godziną: towar leży na półce, której Subiekt nie zna.
 */
function zapisyWBledzie(): PozycjaDecyzji[] {
  const wiersze = db().prepare(`SELECT id, type, label, error_msg, created_at
    FROM sfera_queue WHERE status='error' ORDER BY id`).all() as Array<{
      id: number; type: string; label: string | null; error_msg: string | null; created_at: string }>;
  return wiersze.map((w) => ({
    klucz: `zapis:${w.id}`, obszar: "magazyn" as const, zrodlo: "zapisy" as const,
    pytanie: "Ponowić czy anulować zapis do Subiekta?",
    co: [w.label || w.type, w.error_msg].filter(Boolean).join(" · "),
    od: w.created_at,
    pilne: true,
    cel: { panel: "/obsluga/stan?karta=kolejka" },
  }));
}

/**
 * Kolizja kodu kreskowego czekająca na biuro.
 *
 * Czeka, gdy nikt się jeszcze nie wypowiedział ALBO gdy obiecana poprawka nie
 * zadziałała — trafienia po `poprawione` są dowodem, nie opinią. `dopuszczone`
 * z trafieniami nie czeka: tam trafienia mają wracać.
 */
function kodyKreskowe(): PozycjaDecyzji[] {
  return eanConflictReport()
    .filter((k) => !k.rozstrzygniecie
      || (k.rozstrzygniecie.rodzaj === "poprawione" && k.trafienPoDecyzji > 0))
    .map((k) => ({
      klucz: `kod:${k.ean}`, obszar: "magazyn" as const, zrodlo: "kody" as const,
      pytanie: k.rozstrzygniecie
        ? "Poprawka kodu nie zadziałała — co dalej?"
        : "Poprawić kartotekę czy dopuścić kod?",
      co: `${k.ean} · ${k.towary.map((t) => t.sym).join(", ")} · ${
        ile(k.hits, "zatrzymanie", "zatrzymania", "zatrzymań")}`,
      od: k.lastSeen,
      pilne: false,
      cel: { panel: "/obsluga/stan?karta=kody" },
    }));
}

/** Konto Allegro bez połączenia — bez niego stoją zwroty, reklamacje i skrzynka naraz. */
function kontoAllegro(): PozycjaDecyzji[] {
  const s = stanPolaczenia();
  if (s.stan !== "niepolaczone" && s.stan !== "zle_srodowisko") return [];
  return [{
    klucz: "allegro", obszar: "magazyn", zrodlo: "allegro",
    pytanie: s.stan === "niepolaczone" ? "Połączyć konto Allegro" : "Sparować konto Allegro ponownie",
    co: s.stan === "niepolaczone"
      ? "Konto niepołączone — zwroty, reklamacje i skrzynka stoją"
      : "Token z innego środowiska niż ustawione",
    od: null,
    pilne: true,
    cel: { panel: "/obsluga/stan?karta=allegro" },
  }];
}

/* ── OBSŁUGA KLIENTA ────────────────────────────────────────────────────── */

function kolejkiKlienta(teraz: number): PozycjaDecyzji[] {
  const wiersze: PozycjaDecyzji[] = [];

  const reklamacje = listaReklamacji(db(), teraz, progKolejki(db(), teraz).od)
    .filter((r) => r.kubelek === "decyzja");
  if (reklamacje.length) {
    wiersze.push({
      klucz: "kolejka:reklamacje", obszar: "obsluga", zrodlo: "reklamacje",
      pytanie: "Uznać czy odrzucić?",
      co: `${ile(reklamacje.length, "reklamacja czeka", "reklamacje czekają", "reklamacji czeka")} na werdykt`,
      od: najstarsza(reklamacje.map((r) => r.otwartoAt)),
      pilne: reklamacje.some((r) => r.poTerminie || (r.dniDoTerminu != null && r.dniDoTerminu <= 1)),
      cel: { panel: "/obsluga/reklamacje" },
    });
  }

  const zwroty = listaZwrotow(db(), teraz).filter((z) => z.kubelek === "decyzja");
  if (zwroty.length) {
    wiersze.push({
      klucz: "kolejka:zwroty", obszar: "obsluga", zrodlo: "zwroty",
      pytanie: "Przyjąć czy odrzucić?",
      co: `${ile(zwroty.length, "zwrot czeka", "zwroty czekają", "zwrotów czeka")} na decyzję`,
      od: najstarsza(zwroty.map((z) => z.dostarczonoAt ?? z.paczkaAt)),
      pilne: zwroty.some((z) => z.sygnaly.includes("termin")),
      cel: { panel: "/obsluga/zwroty" },
    });
  }

  /* Rozmowa czeka, gdy ostatnie słowo należy do klienta — `czekaOdMs` liczy
     to samo, co kolumna oczekiwania w skrzynce. Zamknięte i spam zeszły
     z biurka i tu też nie wracają. */
  const rozmowy = listaRozmow()
    .filter((r) => r.czekaOdMs != null && r.status !== "closed" && r.status !== "spam");
  if (rozmowy.length) {
    const najdluzej = Math.max(...rozmowy.map((r) => r.czekaOdMs ?? 0));
    wiersze.push({
      klucz: "kolejka:skrzynka", obszar: "obsluga", zrodlo: "skrzynka",
      pytanie: "Odpowiedzieć klientowi",
      co: `${ile(rozmowy.length, "rozmowa bez odpowiedzi", "rozmowy bez odpowiedzi", "rozmów bez odpowiedzi")}`,
      od: new Date(teraz - najdluzej).toISOString(),
      pilne: rozmowy.some((r) => r.poTerminie),
      cel: { panel: "/obsluga/skrzynka" },
    });
  }

  const prog = progKolejki(db(), teraz, config.allegro.reklamacjeOd, "DISPUTE");
  const dyskusje = listaDyskusji(db(), teraz, prog.od).filter((d) => d.kubelek === "odpowiedz");
  if (dyskusje.length) {
    wiersze.push({
      klucz: "kolejka:dyskusje", obszar: "obsluga", zrodlo: "dyskusje",
      pytanie: "Odpowiedzieć w dyskusji",
      co: `${ile(dyskusje.length, "dyskusja czeka", "dyskusje czekają", "dyskusji czeka")} na nas`,
      od: najstarsza(dyskusje.map((d) => d.ostatniaWiadomoscAt ?? d.otwartoAt)),
      pilne: dyskusje.some((d) => d.dlugoCzeka),
      cel: { panel: "/obsluga/dyskusje" },
    });
  }
  return wiersze;
}

/**
 * Wszystko, co czeka na biuro — najpilniejsze pierwsze, potem najstarsze.
 *
 * KOLEJNOŚĆ LICZY SERWER i panel jej nie zmienia — ta sama zasada co przy
 * kolejce zwrotów: dwie reguły sortowania rozjechałyby się przy pierwszej
 * poprawce jednej z nich. Wiersz bez daty idzie na koniec swojej grupy
 * pilności, bo nie ma czym się zmierzyć z resztą.
 */
export function doDecyzji(teraz = Date.now()): DoDecyzji {
  const pozycje = [
    ...kontoAllegro(), ...zapisyWBledzie(), ...dostawyZWyjatkiem(), ...odpowiedziHali(),
    ...kosze(), ...kodyKreskowe(), ...kolejkiKlienta(teraz),
  ].sort((a, b) =>
    Number(b.pilne) - Number(a.pilne)
    || Number(a.od == null) - Number(b.od == null)
    || (a.od ?? "").localeCompare(b.od ?? ""));
  const magazyn = pozycje.filter((p) => p.obszar === "magazyn").length;
  return {
    pozycje,
    liczniki: { wszystko: pozycje.length, magazyn, obsluga: pozycje.length - magazyn },
  };
}
