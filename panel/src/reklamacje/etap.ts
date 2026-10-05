import type {
  Reklamacja, ReklamacjaUDostawcy, SladHistorii, SzczegolReklamacji, WiadomoscReklamacji,
} from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas, dniSlowo, ile, odmien } from "../ui";
import { SYGNALY } from "./Kolejka";
import {
  NAZWA_WERDYKTU, STATUS_ALLEGRO, ZDANIE_STANU_WERDYKTU, rozstrzygniecie, znanyStatus,
} from "./statusy";

/* ── CO SIĘ DZIEJE W SPRAWIE — dwa zdania z pól, które ekran już ma ─────────
   Uwaga właściciela: „w tym panelu nawet nie wiem co się dzieje". Etap mówią
   dwa zdania pod rzędem klienta, bo etykiety rozrzucone po czterech miejscach
   („Decyzja do:", „Allegro: KOD", „Ostatnie słowo: my") kazały składać go
   w głowie.

   ZDANIE A mówi o etapie i terminie. ZDANIE B mówi o rozmowie i towarze.
   Oba liczy jedna czysta funkcja z propsów głowicy, więc otwarcie sprawy
   niczego tu nie zapisuje, a każdą gałąź da się sprawdzić testem
   tabelarycznym (`etap.test.ts`).

   STOJĄ W GŁOWICY, NIE W KOLUMNIE FAKTÓW. Między `lg` a `2xl` kolumna faktów
   schodzi pod dowody, więc nie zawsze ją widać. Głowicę widać pierwszą
   zawsze. Prawa kolumna trzyma dane do decyzji i czynność, a o etapie
   milczy. Jeden dom na fakt.

   Daty idą przez `czas()` z `ui`, bo format pilnuje `Czas.test.ts`.
   Liczbę dni do terminu podaje serwer: zegar przeglądarki bywa przestawiony. */

/**
 * Jak człon zdania wygląda — słownik zamknięty, klasy dobiera głowica.
 *
 * Czysta funkcja nie zna Tailwinda. Zna ROLĘ członu, a głowica tłumaczy ją
 * na barwę i wagę w jednym miejscu.
 */
export type Ton =
  /** Główny człon zdania A: półgruby, atrament. */
  | "glowny"
  /** Coś poszło nie tak albo termin pali: półgruby, czerwień. */
  | "zle"
  /** Czeka na czyjś ruch: półgruby, brąz bursztynu — znaczy wyłącznie „uwaga". */
  | "uwaga"
  /** Potwierdzone przez Allegro: półgruby, zieleń. */
  | "ok"
  /** W drodze albo bez ruchu: półgruby grafit, bez alarmu. */
  | "spokojny"
  /** Zwykły tekst zdania. */
  | "tekst"
  /** Liczba dni do terminu: gruba, atrament. */
  | "termin"
  /** Liczba dni do terminu przy trzech dniach i mniej: gruba czerwień. */
  | "terminPilny"
  /** Data obok liczby dni: szarość, cyfry tabelaryczne. */
  | "data"
  /** Brak wiedzy powiedziany wprost: szarość. */
  | "cichy"
  /** Klient czeka na nas: kropka bursztynu i półgruby brąz. */
  | "czeka";

export interface Czlon { tekst: string; ton: Ton }

export interface CoSieDzieje {
  /** Etap i termin. */
  a: Czlon[];
  /** Rozmowa i towar; pusta tablica znaczy „nie ma czego powiedzieć". */
  b: Czlon[];
  /** Surowy status Allegro — trafia do podpowiedzi zdania A, nie na ekran. */
  kodAllegro: string | null;
}

const t = (tekst: string): Czlon => ({ tekst, ton: "tekst" });

/** Zdanie z członów, jak je przeczyta człowiek — dla testów i czytnika. */
export const zdanie = (czlony: Czlon[]): string => czlony.map((c) => c.tekst).join("");

/** Podpowiedź zdania A: dokładna wartość zostaje pod kursorem. */
export const tytulStatusu = (kod: string | null): string =>
  kod ? `Status w Allegro: ${kod}` : "Allegro nie podało statusu";

/** Kto ma ostatnie słowo — szukamy człowieka, automat Allegro nie czeka na nikogo. */
const LUDZIE = new Set(["BUYER", "SELLER", "ADMIN"]);

export function ostatnieSlowo(czat: WiadomoscReklamacji[]): WiadomoscReklamacji | null {
  for (let i = czat.length - 1; i >= 0; i -= 1) {
    if (LUDZIE.has(czat[i].autorRola ?? "")) return czat[i];
  }
  return null;
}

/**
 * Termin jako ogon zdania A — „— termin za 6 dni (24.09.2026, 23:59).".
 *
 * Pytanie przy sprawie brzmi „ile mam czasu", nie „który to dzień", więc
 * liczba dni idzie pierwsza, a data stoi obok w nawiasie. Czerwień od trzech
 * dni w dół, ten sam próg co czip „termin" na serwerze. Brak terminu mówi
 * o sobie, bo puste miejsce czytałoby się jak „zdąży się".
 */
export function terminSlowem(r: Pick<Reklamacja, "decyzjaDo" | "dniDoTerminu" | "poTerminie">): Czlon[] {
  const data = r.decyzjaDo ? czas(r.decyzjaDo) : null;
  const zData = (slowo: Czlon): Czlon[] =>
    [t(" — termin "), slowo, ...(data ? [t(" "), { tekst: `(${data})`, ton: "data" as const }] : []), t(".")];
  if (r.poTerminie || (r.dniDoTerminu !== null && r.dniDoTerminu < 0)) {
    return zData({ tekst: "minął", ton: "terminPilny" });
  }
  if (data === null || r.dniDoTerminu === null) return [{ tekst: " — Allegro nie podało terminu.", ton: "cichy" }];
  if (r.dniDoTerminu === 0) return zData({ tekst: "dziś", ton: "terminPilny" });
  return zData({ tekst: `za ${dniSlowo(r.dniDoTerminu)}`, ton: r.dniDoTerminu <= 3 ? "terminPilny" : "termin" });
}

/**
 * Czy sztuka idzie do dostawcy — głowica i blok werdyktu pytają tej jednej funkcji.
 *
 * Sztuka wraca, gdy uznaliśmy (tu albo w Centrum Sprzedaży) i towar ma być
 * odesłany. Zapisane zgłoszenie stoi zawsze, bo raz zapisanego się nie chowa.
 * Dwie kopie tej reguły rozjechałyby się przy pierwszej zmianie.
 */
export function doDostawcy(r: Pick<Reklamacja,
  "werdykt" | "werdyktStatus" | "statusAllegro" | "zwrotTowaru" | "zwrotWymagany">,
  uDostawcy: ReklamacjaUDostawcy | null): boolean {
  const uznana = String(r.werdykt ?? "").startsWith("ACCEPTED")
    || rozstrzygniecie(r.statusAllegro) === "uznana";
  return r.werdyktStatus !== "sending" && uznana
    && (r.zwrotTowaru === "wymagany" || r.zwrotWymagany === true || uDostawcy !== null);
}

/** Czy werdykt już zapadł — nasz w drodze albo wysłany, albo rozstrzygnięcie Allegro. */
export function poWerdykcie(r: Pick<Reklamacja, "werdyktStatus" | "statusAllegro">): boolean {
  /* `!= null`, nie `!== null`: starszy serwer pola nie zna, a brak ma znaczyć
     „werdyktu nie ma", nie „werdykt jest". */
  return (r.werdyktStatus != null && r.werdyktStatus !== "send_failed")
    || rozstrzygniecie(r.statusAllegro) !== null;
}

/** Nazwa naszego werdyktu: zdanie serwera, a bez niego nasza mapa. */
function nazwaWerdyktu(r: Reklamacja): string {
  if (r.werdyktNazwa) return r.werdyktNazwa;
  const kod = String(r.werdykt ?? "");
  return (NAZWA_WERDYKTU as Record<string, string>)[kod] ?? kod;
}

/**
 * Jeden człon dalszego kroku po rozstrzygnięciu, bez szczegółów bloku.
 *
 * Nazwa dostawcy, data i numer zgłoszenia stoją tylko w bloku „Po werdykcie".
 * Tu stoi wyłącznie, KTO ma ruch. W kubełku „Do odpowiedzi" ruch ogłasza
 * zdanie B w bursztynie, więc tu nie dochodzi nic.
 */
function dalszyKrok(s: SzczegolReklamacji): Czlon[] {
  const r = s.reklamacja;
  const uDostawcy = s.uDostawcy ?? null;
  if (r.sygnaly.includes("towar_do_decyzji")) {
    return [t(" "), { tekst: "Kupujący nie wie jeszcze, czy odsyłać towar — ruch należy do nas.", ton: "uwaga" }];
  }
  if (doDostawcy(r, uDostawcy) && uDostawcy === null) {
    return [t(" Dalej: sztuka wraca do nas, potem reklamacja u dostawcy.")];
  }
  if (doDostawcy(r, uDostawcy) && uDostawcy !== null && uDostawcy.wynik === null) {
    return [t(" Dalej: czekamy na odpowiedź dostawcy.")];
  }
  if (r.kubelek === "zamknieta") return [t(" Nic tu nie czeka na nasz ruch.")];
  return [];
}

/** Zdanie A — etap i termin. Wygrywa pierwsza pasująca gałąź. */
function zdanieA(s: SzczegolReklamacji): Czlon[] {
  const r = s.reklamacja;
  const status = r.werdyktStatus;
  const nazwa = nazwaWerdyktu(r);
  const kwota = r.werdyktKwotaGrosze != null ? zlote(r.werdyktKwotaGrosze, r.waluta) : null;
  const decyzja = r.kubelek === "decyzja";

  /* 1–3. Los NASZEJ próby mówi pierwszy, bo tylko on każe coś zrobić albo
     czegoś NIE robić. Nieudana próba werdyktem nie jest, więc termin zostaje. */
  if (status === "send_failed") return [{ tekst: ZDANIE_STANU_WERDYKTU.send_failed(nazwa, kwota), ton: "zle" },
    ...terminSlowem(r)];
  if (status === "sending") return [{ tekst: ZDANIE_STANU_WERDYKTU.sending(nazwa, kwota), ton: "spokojny" }];
  if (status === "send_uncertain") return [{ tekst: ZDANIE_STANU_WERDYKTU.send_uncertain(nazwa, kwota), ton: "zle" }];

  const koniec = rozstrzygniecie(r.statusAllegro);
  /* 4. Wysłany, a Allegro jeszcze nie przestawiło statusu. Zieleń należy się
     dopiero potwierdzeniu z synchronizacji, więc stoi brąz „czekamy". */
  if (status === "sent" && koniec === null) {
    return [{ tekst: ZDANIE_STANU_WERDYKTU.sent(nazwa, kwota), ton: "uwaga" }];
  }
  /* 5. Rozstrzygnięta. Werdykt z Centrum Sprzedaży mówi o sobie wprost, bo
     pochodzenie decyzji jest informacją. */
  if (koniec !== null) {
    const glowa: Czlon[] = r.werdykt
      ? [{ tekst: `${nazwa}${kwota ? `, ${kwota}` : ""}`, ton: "ok" }, t(" — potwierdzone przez Allegro.")]
      : [{ tekst: `${STATUS_ALLEGRO[koniec === "uznana" ? "CLAIM_ACCEPTED" : "CLAIM_REJECTED"].slowo}.`,
        ton: "ok" }];
    return [...glowa, ...dalszyKrok(s)];
  }
  /* 6. Bez ruchu: rozmowa zamknięta, termin dawno za nami. To nie alarm,
     tylko wyjaśnienie, czemu sprawa zeszła z pracy — stąd grafit. */
  if (r.kubelek === "bez_ruchu") {
    return [{ tekst: r.decyzjaDo
      ? `Nic tu nie zrobimy: Allegro zamknęło rozmowę, a termin minął ${czas(r.decyzjaDo)}.`
      : "Nic tu nie zrobimy: Allegro zamknęło rozmowę i nie podało terminu.", ton: "spokojny" }];
  }
  /* 7. Czeka na nas. Pytania „Uznać czy odrzucić?" tu nie ma, bo zadają je
     przyciski Uznaję i Odrzucam (dekalog, punkt 5). */
  if (r.statusAllegro === null || r.statusAllegro === "CLAIM_SUBMITTED") {
    return [{ tekst: STATUS_ALLEGRO.CLAIM_SUBMITTED.slowo, ton: "glowny" }, ...terminSlowem(r)];
  }
  /* 8. Spór słowem z mapy. 9. Kod spoza słownika stoi jawnie, bo trzeba go
     do niego dopisać — pusty slot nikogo by o tym nie powiadomił. */
  const slowo = znanyStatus(r.statusAllegro)
    ? STATUS_ALLEGRO[r.statusAllegro].slowo
    : `Allegro podało status, którego nie znamy: ${r.statusAllegro}`;
  return [{ tekst: slowo, ton: "glowny" }, ...(decyzja ? terminSlowem(r) : [t(".")])];
}

/** Zdanie B — rozmowa i towar. Każda część tylko wtedy, gdy zachodzi. */
function zdanieB(s: SzczegolReklamacji): Czlon[] {
  const r = s.reklamacja;
  const czesci: Czlon[] = [];
  const slowo = ostatnieSlowo(s.czat ?? []);
  /* Bursztyn bierze się z SYGNAŁU serwera, ten sam predykat co czip
     „klient czeka" w kolejce. Kto i kiedy biorą się z rozmowy. Gdy rozmowa
     jest w tyle za sygnałem, mówi to osobne zdanie, a nie zgadywanie. */
  const czeka = r.sygnaly.includes("klient_czeka");
  if (czeka && slowo?.autorRola !== "BUYER") {
    czesci.push({ tekst: "Allegro podaje, że klient czeka na naszą odpowiedź.", ton: "czeka" });
  }
  if (slowo) {
    const kiedy = czas(slowo.utworzonoAt);
    if (slowo.autorRola === "BUYER") {
      czesci.push(czeka
        ? { tekst: `Ostatnia wiadomość od klienta: ${kiedy} — czeka na naszą odpowiedź.`, ton: "czeka" }
        : t(`Ostatnia wiadomość od klienta: ${kiedy}.`));
    } else if (slowo.autorRola === "SELLER") {
      czesci.push(t(`Ostatnia wiadomość nasza: ${kiedy}.`));
    } else {
      czesci.push(t(`Ostatnia wiadomość od doradcy Allegro: ${kiedy}.`));
    }
  }
  /* „W rozmowie jest", nigdy „doradca pisał ostatni" bez dowodu w rozmowie. */
  if (r.sygnaly.includes("doradca") && slowo?.autorRola !== "ADMIN") {
    czesci.push(t(`${SYGNALY.doradca.tytul}.`));
  }
  /* W kubełku „Bez ruchu" zamkniętą rozmowę mówi już zdanie A. */
  if (!r.czatAktywny && r.kubelek !== "bez_ruchu") {
    czesci.push(t("Allegro zamknęło rozmowę — nowej wiadomości nie przyjmie."));
  }
  /* Po werdykcie los towaru mieszka w kroku „Towar do odesłania?" bloku. */
  if (!poWerdykcie(r) && r.zwrotWymagany !== null) {
    czesci.push(t(r.zwrotWymagany
      ? "Towar ma wrócić do nas (tak podaje Allegro)."
      : "Towar zostaje u klienta (tak podaje Allegro)."));
  }
  return czesci.flatMap((c, i) => (i === 0 ? [c] : [t(" "), c]));
}

/**
 * Co się dzieje w sprawie — dwa zdania z pól, które głowica już dostaje.
 *
 * Zdanie A: etap i termin; termin tylko przed werdyktem. Zdanie B: kto pisał
 * ostatni, czy klient czeka, doradca, zamknięta rozmowa i los towaru wg Allegro.
 */
export function coSieDzieje(s: SzczegolReklamacji): CoSieDzieje {
  return { a: zdanieA(s), b: zdanieB(s), kodAllegro: s.reklamacja.statusAllegro };
}

/**
 * „3 reklamacje (2 uznane, 1 odrzucona)" — licznik historii jednym zdaniem.
 *
 * Głowica mówi tak o kliencie, a kolumna faktów o towarze. Jedna funkcja,
 * żeby ta sama liczba nie brzmiała w dwóch miejscach inaczej. `dopisek`
 * staje przed nawiasem: „2 reklamacje u nas (1 uznana, 1 odrzucona)".
 */
export function ileReklamacji(s: SladHistorii, dopisek = ""): string {
  const ogon = [
    s.uznanych > 0 ? `${s.uznanych} ${odmien(s.uznanych, "uznana", "uznane", "uznanych")}` : null,
    s.odrzuconych > 0
      ? `${s.odrzuconych} ${odmien(s.odrzuconych, "odrzucona", "odrzucone", "odrzuconych")}` : null,
  ].filter(Boolean).join(", ");
  return `${ile(s.ile, "reklamacja", "reklamacje", "reklamacji")}${dopisek}${ogon ? ` (${ogon})` : ""}`;
}
