import { describe, expect, it } from "vitest";
import type {
  Reklamacja, ReklamacjaUDostawcy, SzczegolReklamacji, WiadomoscReklamacji,
} from "../api/typy";
import { czas } from "../ui";
import {
  coSieDzieje, doDostawcy, ileReklamacji, ostatnieSlowo, terminSlowem, tytulStatusu, zdanie,
  type Czlon,
} from "./etap";

/* ── Co się dzieje w sprawie: zdania A i B ───────────────────────────────────
   Jedna asercja na gałąź, w tabeli. Głowica rysuje te człony bez własnej
   logiki, więc to tutaj stoi cała reguła: która gałąź wygrywa, kiedy
   dochodzi termin i jakim tonem mówi każdy człon.

   Daty liczy `czas()`, ten sam formater co na ekranie. Strefa czasu biegacza
   testów nie jest strefą biura, więc oczekiwany napis też bierze się z niego. */

const DO = "2026-10-08T21:59:00.000Z";
const T = czas(DO);

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "2926143/2026", orderId: "ord-1", offerId: "of-1",
  kupujacyLogin: "jochana2", prawo: "COMPLAINT", powodTyp: "PRODUCT_DAMAGED_PARCEL_INTACT",
  powodOpis: null, temat: null, opis: null, oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
  waluta: "PLN", statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: DO, dniDoTerminu: 3, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 6, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null, otwartoAt: "2026-09-24T13:15:00.000Z",
  kupionoAt: null, kupionoZrodlo: null, dniOdZakupu: null, prowadzi: null, prowadziId: null,
  prowadziAt: null, tagi: [], notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false,
  notatka: null, werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1, wersja: 1, kubelek: "decyzja", sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null, ofertaNazwa: "CEWKA ZAPŁONOWA",
  ofertaZdjecie: "brak", twId: null, twSymbol: null, twZParagonu: false, ...n,
});

const wiad = (id: number, autorRola: string | null, utworzonoAt = "2026-09-25T07:48:00.000Z"):
  WiadomoscReklamacji => ({
  id, externalId: `w-${id}`, autorLogin: null, autorRola, tresc: "…", utworzonoAt, zalaczniki: [],
} as WiadomoscReklamacji);

const sprawa = (r: Partial<Reklamacja> = {}, n: Partial<SzczegolReklamacji> = {}): SzczegolReklamacji => ({
  reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [],
  zamowienie: null, przesylka: null, kartoteka: null, karta: null,
  historia: { towar: null, klient: null }, ...n,
});

const uDostawcy = (n: Partial<ReklamacjaUDostawcy> = {}): ReklamacjaUDostawcy => ({
  dostawca: "HURT-OGR", nrUDostawcy: null, zgloszonoAt: "2026-10-01T10:00:00.000Z",
  wynik: null, wynikAt: null, autor: "Ala", wersja: 1, ...n,
});

const A = (s: SzczegolReklamacji) => zdanie(coSieDzieje(s).a);
const B = (s: SzczegolReklamacji) => zdanie(coSieDzieje(s).b);
/** Ton członu, który niesie dany napis — tak głowica dobierze barwę. */
const ton = (czlony: Czlon[], tekst: string) => czlony.find((c) => c.tekst.includes(tekst))?.ton;

const UZNANA = {
  werdykt: "ACCEPTED_EXCHANGE", werdyktNazwa: "Uznana — wymiana", werdyktStatus: "sent",
} as const;

describe("Zdanie A — etap i termin, pierwsza pasująca gałąź wygrywa", () => {
  const przypadki: Array<[string, SzczegolReklamacji, string]> = [
    ["1. nieudany werdykt każe go poprawić, a termin zostaje, bo werdyktu nie ma",
      sprawa({ ...UZNANA, werdyktStatus: "send_failed", werdyktBlad: "400" }),
      `Werdykt nie przeszedł — popraw go w bloku Werdykt i wyślij jeszcze raz — termin za 3 dni (${T}).`],
    ["2. werdykt w drodze nie ma terminu",
      sprawa({ ...UZNANA, werdyktStatus: "sending" }),
      "Werdykt „Uznana — wymiana” jest w drodze do Allegro."],
    ["3. niepewny los mówi, czego NIE robić",
      sprawa({ ...UZNANA, werdyktStatus: "send_uncertain" }),
      "Nie wiemy, czy werdykt „Uznana — wymiana” doszedł — sprawdź w Centrum Sprzedaży i nie wysyłaj go drugi raz."],
    ["4. wysłany, a Allegro jeszcze nie potwierdziło — z kwotą po spacji",
      sprawa({ werdykt: "ACCEPTED_PARTIAL_REFUND", werdyktNazwa: "Uznana — częściowy zwrot pieniędzy",
        werdyktStatus: "sent", werdyktKwotaGrosze: 4000 }),
      "Werdykt „Uznana — częściowy zwrot pieniędzy” 40,00 PLN wysłany — czekamy, aż Allegro potwierdzi."],
    ["5. potwierdzony nasz werdykt z kwotą po przecinku",
      sprawa({ werdykt: "ACCEPTED_PARTIAL_REFUND", werdyktNazwa: "Uznana — częściowy zwrot pieniędzy",
        werdyktStatus: "sent", werdyktKwotaGrosze: 4000, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" }),
      "Uznana — częściowy zwrot pieniędzy, 40,00 PLN — potwierdzone przez Allegro. Nic tu nie czeka na nasz ruch."],
    ["5. uznana w Centrum Sprzedaży mówi, skąd jest decyzja",
      sprawa({ statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" }),
      "Uznana w Centrum Sprzedaży, poza panelem. Nic tu nie czeka na nasz ruch."],
    ["5. odrzucona w Centrum Sprzedaży też",
      sprawa({ statusAllegro: "CLAIM_REJECTED", kubelek: "zamknieta" }),
      "Odrzucona w Centrum Sprzedaży, poza panelem. Nic tu nie czeka na nasz ruch."],
    ["5a. kupujący nie wie o towarze — ruch należy do nas",
      sprawa({ ...UZNANA, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta", sygnaly: ["towar_do_decyzji"] }),
      "Uznana — wymiana — potwierdzone przez Allegro. Kupujący nie wie jeszcze, czy odsyłać towar — ruch należy do nas."],
    ["5b. sztuka ma wrócić, a u dostawcy jeszcze nic",
      sprawa({ ...UZNANA, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta", zwrotTowaru: "wymagany" }),
      "Uznana — wymiana — potwierdzone przez Allegro. Dalej: sztuka wraca do nas, potem reklamacja u dostawcy."],
    ["5c. zgłoszone u dostawcy bez wyniku — nazwy dostawcy tu nie ma, stoi w bloku",
      sprawa({ ...UZNANA, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta", zwrotTowaru: "wymagany" },
        { uDostawcy: uDostawcy() }),
      "Uznana — wymiana — potwierdzone przez Allegro. Dalej: czekamy na odpowiedź dostawcy."],
    ["5d. dostawca odpowiedział — w kubełku zamkniętym nic nie czeka",
      sprawa({ ...UZNANA, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta", zwrotTowaru: "wymagany" },
        { uDostawcy: uDostawcy({ wynik: "uznal" }) }),
      "Uznana — wymiana — potwierdzone przez Allegro. Nic tu nie czeka na nasz ruch."],
    ["5e. klient pisze dalej — ruch ogłasza zdanie B, A podaje sam werdykt",
      sprawa({ ...UZNANA, statusAllegro: "CLAIM_ACCEPTED", kubelek: "odpowiedz" }),
      "Uznana — wymiana — potwierdzone przez Allegro."],
    ["6. bez ruchu podaje, kiedy minął termin",
      sprawa({ kubelek: "bez_ruchu", czatAktywny: false, poTerminie: true, dniDoTerminu: -40 }),
      `Nic tu nie zrobimy: Allegro zamknęło rozmowę, a termin minął ${T}.`],
    ["6. bez ruchu i bez daty mówi to wprost",
      sprawa({ kubelek: "bez_ruchu", czatAktywny: false, decyzjaDo: null, dniDoTerminu: null }),
      "Nic tu nie zrobimy: Allegro zamknęło rozmowę i nie podało terminu."],
    ["7. czeka na naszą decyzję — ta sprawa, dosłownie",
      sprawa(),
      `Czeka na naszą decyzję — termin za 3 dni (${T}).`],
    ["7. status null to też decyzja przed nami",
      sprawa({ statusAllegro: null, dniDoTerminu: 6 }),
      `Czeka na naszą decyzję — termin za 6 dni (${T}).`],
    ["8. spór w kubełku decyzji dostaje termin",
      sprawa({ statusAllegro: "DISPUTE_ONGOING" }),
      `Allegro prowadzi spór z kupującym w tej sprawie — termin za 3 dni (${T}).`],
    ["8. spór poza kubełkiem decyzji — bez terminu",
      sprawa({ statusAllegro: "DISPUTE_CLOSED", kubelek: "odpowiedz" }),
      "Allegro zamknęło spór w tej sprawie."],
    ["8. spór nierozstrzygnięty",
      sprawa({ statusAllegro: "DISPUTE_UNRESOLVED", kubelek: "odpowiedz" }),
      "Allegro uznało spór za nierozstrzygnięty."],
    ["9. kod spoza słownika stoi jawnie, z terminem w kubełku decyzji",
      sprawa({ statusAllegro: "CLAIM_COS_NOWEGO" }),
      `Allegro podało status, którego nie znamy: CLAIM_COS_NOWEGO — termin za 3 dni (${T}).`],
  ];

  it.each(przypadki)("%s", (_, s, oczekiwane) => {
    expect(A(s)).toBe(oczekiwane);
  });

  it("tony: termin od trzech dni w dół czerwony, dalej atrament; los próby i potwierdzenie mają swoje barwy", () => {
    expect(ton(coSieDzieje(sprawa()).a, "za 3 dni")).toBe("terminPilny");
    expect(ton(coSieDzieje(sprawa({ dniDoTerminu: 6 })).a, "za 6 dni")).toBe("termin");
    expect(ton(coSieDzieje(sprawa()).a, "Czeka na naszą decyzję")).toBe("glowny");
    expect(ton(coSieDzieje(sprawa({ ...UZNANA, werdyktStatus: "send_failed" })).a, "nie przeszedł")).toBe("zle");
    expect(ton(coSieDzieje(sprawa({ ...UZNANA, werdyktStatus: "send_uncertain" })).a, "Nie wiemy")).toBe("zle");
    expect(ton(coSieDzieje(sprawa(UZNANA)).a, "wysłany")).toBe("uwaga");
    expect(ton(coSieDzieje(sprawa({ ...UZNANA, werdyktStatus: "sending" })).a, "w drodze")).toBe("spokojny");
    expect(ton(coSieDzieje(sprawa({ ...UZNANA, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" })).a,
      "Uznana — wymiana")).toBe("ok");
    expect(ton(coSieDzieje(sprawa({ kubelek: "bez_ruchu", czatAktywny: false })).a, "Nic tu")).toBe("spokojny");
  });

  it("surowy kod Allegro nie stoi w zdaniu — idzie do podpowiedzi", () => {
    const s = sprawa();
    expect(A(s)).not.toContain("CLAIM_SUBMITTED");
    expect(coSieDzieje(s).kodAllegro).toBe("CLAIM_SUBMITTED");
    expect(tytulStatusu("CLAIM_SUBMITTED")).toBe("Status w Allegro: CLAIM_SUBMITTED");
    expect(tytulStatusu(null)).toBe("Allegro nie podało statusu");
  });
});

describe("Termin tylko przed werdyktem", () => {
  /* Po werdykcie liczba dni nie rozstrzyga niczego, a czerwień stałaby przy
     sprawie zamkniętej. Nieudana próba werdyktem nie jest, więc tam termin
     zostaje. Gałęzie 1, 7, 8 i 9 — i tylko one. */
  it("żaden stan po werdykcie nie mówi o terminie, choć termin minął", () => {
    const poTerminie = { poTerminie: true, dniDoTerminu: -3 } as const;
    for (const s of [
      sprawa({ ...UZNANA, ...poTerminie }),
      sprawa({ ...UZNANA, ...poTerminie, werdyktStatus: "sending" }),
      sprawa({ ...UZNANA, ...poTerminie, werdyktStatus: "send_uncertain" }),
      sprawa({ ...UZNANA, ...poTerminie, statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" }),
      sprawa({ ...poTerminie, statusAllegro: "CLAIM_REJECTED", kubelek: "zamknieta" }),
    ]) expect(A(s)).not.toMatch(/termin/);
  });

  it("przed werdyktem termin stoi zawsze, także po nieudanej próbie", () => {
    expect(A(sprawa({ ...UZNANA, werdyktStatus: "send_failed", poTerminie: true, dniDoTerminu: -1 })))
      .toContain(`— termin minął (${T}).`);
  });
});

describe("Ogon terminu słowem", () => {
  const ogon = (r: Partial<Reklamacja>) => zdanie(terminSlowem(rek(r)));
  it.each([
    ["za N dni z datą", { dniDoTerminu: 6 }, ` — termin za 6 dni (${T}).`],
    ["jeden dzień w liczbie pojedynczej", { dniDoTerminu: 1 }, ` — termin za 1 dzień (${T}).`],
    ["dziś, nie „za 0 dni”", { dniDoTerminu: 0 }, ` — termin dziś (${T}).`],
    ["minął, nie „za −1 dzień”", { dniDoTerminu: -1, poTerminie: true }, ` — termin minął (${T}).`],
    ["brak terminu mówi o sobie", { decyzjaDo: null, dniDoTerminu: null }, " — Allegro nie podało terminu."],
  ] as Array<[string, Partial<Reklamacja>, string]>)("%s", (_, r, oczekiwane) => {
    expect(ogon(r)).toBe(oczekiwane);
  });

  it("dziś i minął palą się na czerwono, brak terminu stoi szarością", () => {
    expect(terminSlowem(rek({ dniDoTerminu: 0 })).find((c) => c.tekst === "dziś")?.ton).toBe("terminPilny");
    expect(terminSlowem(rek({ poTerminie: true, dniDoTerminu: -2 })).find((c) => c.tekst === "minął")?.ton)
      .toBe("terminPilny");
    expect(terminSlowem(rek({ decyzjaDo: null, dniDoTerminu: null }))[0].ton).toBe("cichy");
  });
});

describe("Zdanie B — rozmowa i towar", () => {
  const PISAL = czas("2026-09-25T07:48:00.000Z");
  const przypadki: Array<[string, SzczegolReklamacji, string]> = [
    ["ta sprawa, dosłownie: my ostatni, doradca w sprawie, towar ma wrócić",
      sprawa({ sygnaly: ["doradca", "zwrot_wymagany"], zwrotWymagany: true },
        { czat: [wiad(1, "BUYER"), wiad(2, "SELLER")] }),
      `Ostatnia wiadomość nasza: ${PISAL}. W rozmowie jest doradca Allegro. Towar ma wrócić do nas (tak podaje Allegro).`],
    ["klient napisał ostatni i czeka",
      sprawa({ sygnaly: ["klient_czeka"] }, { czat: [wiad(1, "BUYER")] }),
      `Ostatnia wiadomość od klienta: ${PISAL} — czeka na naszą odpowiedź.`],
    ["klient napisał ostatni, ale sygnału nie ma — bez bursztynu",
      sprawa({}, { czat: [wiad(1, "BUYER")] }),
      `Ostatnia wiadomość od klienta: ${PISAL}.`],
    ["sygnał klient_czeka przy rozmowie w tyle — osobne zdanie, nie zgadywanie",
      sprawa({ sygnaly: ["klient_czeka"] }, { czat: [wiad(1, "SELLER")] }),
      `Allegro podaje, że klient czeka na naszą odpowiedź. Ostatnia wiadomość nasza: ${PISAL}.`],
    ["ostatni pisał doradca — bez osobnego zdania o doradcy",
      sprawa({ sygnaly: ["doradca"] }, { czat: [wiad(1, "BUYER"), wiad(2, "ADMIN")] }),
      `Ostatnia wiadomość od doradcy Allegro: ${PISAL}.`],
    ["automat Allegro nie przejmuje ostatniego słowa",
      sprawa({}, { czat: [wiad(1, "SELLER"), wiad(2, "BUYER"), wiad(3, "SYSTEM")] }),
      `Ostatnia wiadomość od klienta: ${PISAL}.`],
    ["rozmowa zamknięta przez Allegro",
      sprawa({ czatAktywny: false }),
      "Allegro zamknęło rozmowę — nowej wiadomości nie przyjmie."],
    ["w kubełku bez ruchu zamkniętą rozmowę mówi już zdanie A",
      sprawa({ czatAktywny: false, kubelek: "bez_ruchu" }),
      ""],
    ["towar zostaje u klienta wg Allegro",
      sprawa({ zwrotWymagany: false }),
      "Towar zostaje u klienta (tak podaje Allegro)."],
    ["po werdykcie los towaru mieszka w bloku, nie w zdaniu",
      sprawa({ ...UZNANA, zwrotWymagany: true }),
      ""],
    ["bez rozmowy i bez sygnałów — brak danych nie daje zdania",
      sprawa(),
      ""],
  ];

  it.each(przypadki)("%s", (_, s, oczekiwane) => {
    expect(B(s)).toBe(oczekiwane);
  });

  it("bursztyn niesie wyłącznie zdanie o czekającym kliencie", () => {
    const b = coSieDzieje(sprawa({ sygnaly: ["klient_czeka", "doradca"] }, { czat: [wiad(1, "BUYER")] })).b;
    expect(ton(b, "czeka na naszą odpowiedź")).toBe("czeka");
    expect(ton(b, "doradca")).toBe("tekst");
  });
});

describe("Wspólne reguły głowicy i bloku werdyktu", () => {
  it("sztuka idzie do dostawcy po uznaniu z odesłaniem — tu albo w Centrum Sprzedaży", () => {
    expect(doDostawcy(rek({ ...UZNANA, zwrotTowaru: "wymagany" }), null)).toBe(true);
    expect(doDostawcy(rek({ statusAllegro: "CLAIM_ACCEPTED", zwrotWymagany: true }), null)).toBe(true);
    /* Zapisanego zgłoszenia się nie chowa. */
    expect(doDostawcy(rek(UZNANA), uDostawcy())).toBe(true);
    expect(doDostawcy(rek({ ...UZNANA, zwrotTowaru: "niewymagany", zwrotWymagany: false }), null)).toBe(false);
    expect(doDostawcy(rek({ werdykt: "REJECTED_OTHER", werdyktStatus: "sent", zwrotWymagany: true }), null))
      .toBe(false);
    /* W drodze kroku jeszcze nie ma — werdykt mógł nie dojść. */
    expect(doDostawcy(rek({ ...UZNANA, werdyktStatus: "sending", zwrotTowaru: "wymagany" }), null)).toBe(false);
  });

  it("ostatnie słowo należy do człowieka", () => {
    expect(ostatnieSlowo([wiad(1, "BUYER"), wiad(2, "SYSTEM")])?.id).toBe(1);
    expect(ostatnieSlowo([wiad(1, "SYSTEM")])).toBeNull();
  });

  it("licznik historii mówi liczbą i rozstrzygnięciami, a zer nie wymienia", () => {
    expect(ileReklamacji({ ile: 2, uznanych: 1, odrzuconych: 1 })).toBe("2 reklamacje (1 uznana, 1 odrzucona)");
    expect(ileReklamacji({ ile: 5, uznanych: 0, odrzuconych: 0 })).toBe("5 reklamacji");
    expect(ileReklamacji({ ile: 2, uznanych: 1, odrzuconych: 1 }, " u nas"))
      .toBe("2 reklamacje u nas (1 uznana, 1 odrzucona)");
  });
});
