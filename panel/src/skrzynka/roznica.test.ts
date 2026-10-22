import { describe, expect, it } from "vitest";
import { liczbaZmian, roznicaSlow, zakresyWNowym, type KawalekRoznicy } from "./roznica";

/* ── Różnica słów dwóch wersji szkicu ────────────────────────────────────────
   Agent wysyła tekst po poprawce Copilota i ma zobaczyć, CO się zmieniło.
   Różnica, która gubi albo przestawia choćby odstęp, pokazuje inny tekst niż
   ten w polu. Stąd test odbudowy: wspólne + usunięte daje DOKŁADNIE starą
   wersję, a wspólne + dodane nową — co do nowej linii.                     */

const przed = (r: KawalekRoznicy[]) => r.filter((k) => k.rodzaj !== "dodane").map((k) => k.tekst).join("");
const po = (r: KawalekRoznicy[]) => r.filter((k) => k.rodzaj !== "usuniete").map((k) => k.tekst).join("");

describe("roznicaSlow", () => {
  it("identyczne teksty to jeden kawałek wspólny", () => {
    expect(roznicaSlow("Dzień dobry, pasuje.", "Dzień dobry, pasuje."))
      .toEqual([{ rodzaj: "wspolne", tekst: "Dzień dobry, pasuje." }]);
    expect(roznicaSlow("", "")).toEqual([]);
  });

  it("samo dodanie: nowe słowa w środku, reszta wspólna", () => {
    expect(roznicaSlow("Nóż pasuje do kosiarki.", "Nóż na pewno pasuje do kosiarki.")).toEqual([
      { rodzaj: "wspolne", tekst: "Nóż " },
      { rodzaj: "dodane", tekst: "na pewno " },
      { rodzaj: "wspolne", tekst: "pasuje do kosiarki." },
    ]);
  });

  it("samo usunięcie", () => {
    expect(roznicaSlow("Nóż chyba pasuje.", "Nóż pasuje.")).toEqual([
      { rodzaj: "wspolne", tekst: "Nóż " },
      { rodzaj: "usuniete", tekst: "chyba " },
      { rodzaj: "wspolne", tekst: "pasuje." },
    ]);
  });

  it("zamiana: najpierw skreślenie, potem dopisanie, a odstęp za blokiem stoi po obu stronach", () => {
    expect(roznicaSlow("Gaźnik W09 kosztuje 120 zł.", "Gaźnik W10 Walbro kosztuje 120 zł.")).toEqual([
      { rodzaj: "wspolne", tekst: "Gaźnik " },
      { rodzaj: "usuniete", tekst: "W09 " },
      { rodzaj: "dodane", tekst: "W10 Walbro " },
      { rodzaj: "wspolne", tekst: "kosztuje 120 zł." },
    ]);
    /* Dwa słowa zamienione na dwa: jeden blok, nie „~~a~~b ~~c~~d”. */
    expect(roznicaSlow("x foo bar y", "x baz qux y")).toEqual([
      { rodzaj: "wspolne", tekst: "x " },
      { rodzaj: "usuniete", tekst: "foo bar " },
      { rodzaj: "dodane", tekst: "baz qux " },
      { rodzaj: "wspolne", tekst: "y" },
    ]);
  });

  it("nowe linie zostają co do znaku", () => {
    const a = "Dzień dobry,\n\nnóż pasuje.\nPozdrawiamy";
    const b = "Dzień dobry,\n\nnóż pasuje do LS 46.\n\nPozdrawiamy\nWERTIS";
    const r = roznicaSlow(a, b);
    expect(przed(r)).toBe(a);
    expect(po(r)).toBe(b);
    expect(r.find((k) => k.rodzaj === "dodane")?.tekst).toContain("\n");
  });

  it("odbudowuje obie wersje przy zmianach w wielu miejscach", () => {
    const a = "Dzień dobry, do gaźnika W09-0211 pasuje uszczelka LC170430140 (F3). Wysyłka jutro.";
    const b = "Dzień dobry Panie Janie, do gaźnika W09-0211 pasuje uszczelka LC170430140-0001. Wysyłka dziś.";
    const r = roznicaSlow(a, b);
    expect(przed(r)).toBe(a);
    expect(po(r)).toBe(b);
    /* Sąsiednie kawałki tego samego rodzaju są sklejone. */
    r.forEach((k, i) => { if (i > 0) expect(k.rodzaj).not.toBe(r[i - 1].rodzaj); });
  });

  it("tekst od zera: całość dodana", () => {
    expect(roznicaSlow("", "Dzień dobry.")).toEqual([{ rodzaj: "dodane", tekst: "Dzień dobry." }]);
  });
});

describe("liczbaZmian", () => {
  it("liczy słowa, nie znaki ani odstępy", () => {
    expect(liczbaZmian(roznicaSlow("Gaźnik W09 kosztuje.", "Gaźnik W10 Walbro kosztuje.")))
      .toEqual({ dodane: 2, usuniete: 1 });
    expect(liczbaZmian(roznicaSlow("a b", "a\n\nb"))).toEqual({ dodane: 0, usuniete: 0 });
  });
});

/* ── Sprzątanie po LCS: zdania, listy, okruchy i odstępy ─────────────────────
   Zgłoszenie właściciela ze zrzutem: przepisane zdanie rozsypało się na
   pojedyncze słowa, „Husqvarna” skleiło się z „dziękujemy”, a skreślone
   punkty listy stały na przemian z nowym tekstem. Przykłady są z tamtego
   zrzutu, bo na nich różnica okazała się nieczytelna.                      */

const zmiany = (r: KawalekRoznicy[]) => r.filter((k) => k.rodzaj !== "wspolne");
/** Tekst tak, jak go widać na ekranie: skreślenie i dopisanie stoją obok siebie. */
const naEkranie = (r: KawalekRoznicy[]) => r.map((k) => k.tekst).join("");

describe("roznicaSlow — sprzątanie", () => {
  it("(a) zdanie przepisane w większości: całe stare skreślone, całe nowe dopisane", () => {
    const a = "Obecne dane mamy: Husqvarna 345 łańcuch z 64 ogniwami.";
    const b = "dziękujemy za link. Ten zestaw to prowadnica Oregon 15 cali.";
    expect(roznicaSlow(a, b)).toEqual([
      { rodzaj: "usuniete", tekst: a },
      { rodzaj: "dodane", tekst: b },
    ]);
  });

  it("(a) to samo w środku szkicu: żadne słowo się nie skleja, akapit zostaje", () => {
    const a = "Dzień dobry,\n\nObecne dane mamy: Husqvarna 345 łańcuch z 64 ogniwami.\n\nPozdrawiamy";
    const b = "Dzień dobry,\n\ndziękujemy za link. Ten zestaw to prowadnica Oregon 15 cali.\n\nPozdrawiamy";
    const r = roznicaSlow(a, b);
    expect(przed(r)).toBe(a);
    expect(po(r)).toBe(b);
    expect(zmiany(r)).toEqual([
      { rodzaj: "usuniete", tekst: "Obecne dane mamy: Husqvarna 345 łańcuch z 64 ogniwami.\n\n" },
      { rodzaj: "dodane", tekst: "dziękujemy za link. Ten zestaw to prowadnica Oregon 15 cali.\n\n" },
    ]);
    expect(naEkranie(r)).not.toMatch(/Husqvarnadziękujemy|ogniwami\.dziękujemy/);
  });

  it("(b) drobna zmiana jednego słowa w długim zdaniu: tylko to słowo", () => {
    const a = "Dzień dobry, prowadnica Oregon 15 cali pasuje do Husqvarna 345 i łańcucha z 64 ogniwami.";
    const b = "Dzień dobry, prowadnica Oregon 16 cali pasuje do Husqvarna 345 i łańcucha z 64 ogniwami.";
    const z = zmiany(roznicaSlow(a, b));
    expect(z.map((k) => [k.rodzaj, k.tekst.trim()])).toEqual([["usuniete", "15"], ["dodane", "16"]]);
  });

  it("(c) usunięte punkty listy idą całymi liniami, nie słowo po słowie", () => {
    const a = "Mamy:\n- Husqvarna 345\n- łańcuch 64 ogniwa\nPozdrawiamy";
    const r = roznicaSlow(a, "Mamy:\nPozdrawiamy");
    expect(zmiany(r)).toEqual([{ rodzaj: "usuniete", tekst: "- Husqvarna 345\n- łańcuch 64 ogniwa\n" }]);
  });

  it("(c) punkt listy zmieniony jednym słowem idzie całą linią", () => {
    const r = roznicaSlow("- Husqvarna 345\n- łańcuch 64 ogniwa", "- Husqvarna 345\n- łańcuch 72 ogniwa");
    expect(zmiany(r).map((k) => [k.rodzaj, k.tekst.trim()])).toEqual([
      ["usuniete", "- łańcuch 64 ogniwa"], ["dodane", "- łańcuch 72 ogniwa"]]);
  });

  it("(c) skreślona lista i nowe zdanie to jeden blok, nie przeplatanka", () => {
    const a = "Dzień dobry,\nObecne dane:\n- Husqvarna 345\n- łańcuch 64 ogniwa\nPozdrawiamy";
    const b = "Dzień dobry,\ndziękujemy za link. Ten zestaw to prowadnica Oregon.\nPozdrawiamy";
    const r = roznicaSlow(a, b);
    expect(przed(r)).toBe(a);
    expect(po(r)).toBe(b);
    expect(zmiany(r).map((k) => k.rodzaj)).toEqual(["usuniete", "dodane"]);
    expect(zmiany(r)[0].tekst).toContain("- Husqvarna 345\n- łańcuch 64 ogniwa");
  });

  it("(d) odstęp między skreśleniem a dopisaniem zostaje na styku", () => {
    const r = roznicaSlow("A. Stare zdanie tutaj. B.", "A. Zupełnie inne słowa. B.");
    expect(r).toEqual([
      { rodzaj: "wspolne", tekst: "A. " },
      { rodzaj: "usuniete", tekst: "Stare zdanie tutaj. " },
      { rodzaj: "dodane", tekst: "Zupełnie inne słowa. " },
      { rodzaj: "wspolne", tekst: "B." },
    ]);
    /* Na końcu tekstu nie ma odstępu za blokiem, więc przechodzi ten sprzed niego. */
    const k = roznicaSlow("Nóż pasuje do kosiarki.", "Nóż pasuje do LS 46.");
    expect(zmiany(k)).toEqual([
      { rodzaj: "usuniete", tekst: " kosiarki." },
      { rodzaj: "dodane", tekst: " LS 46." },
    ]);
  });

  it("okruch do dwóch słów między zmianami dokleja się do zmiany", () => {
    const r = roznicaSlow(
      "Prowadnica ma 15 cali i 64 ogniwa, pasuje do pilarki od zaraz bez przeróbek.",
      "Prowadnica ma 16 cali i 72 ogniwa, pasuje do pilarki od zaraz bez przeróbek.");
    expect(zmiany(r).map((k) => [k.rodzaj, k.tekst.trim()])).toEqual([
      ["usuniete", "15 cali i 64"], ["dodane", "16 cali i 72"]]);
  });

  it("dwa dopisania rozdzielone wspólnym słowem zostają osobno — bez fałszywego skreślenia", () => {
    const r = roznicaSlow("Nóż i pilnik wysyłamy dziś kurierem.", "Nóż ostry i pilnik płaski wysyłamy dziś kurierem.");
    expect(r.filter((k) => k.rodzaj === "usuniete")).toEqual([]);
    expect(zmiany(r).map((k) => k.tekst.trim())).toEqual(["ostry", "płaski"]);
  });
});

describe("zakresyWNowym", () => {
  it("zakres dopisanego trafia co do znaku, z polskimi literami i nową linią", () => {
    const a = "Dzień dobry,\nłańcuch ma 64 ogniwa.\nPozdrawiamy";
    const b = "Dzień dobry,\nłańcuch ma 72 ogniwa — źródło: karta.\nPozdrawiamy";
    const m = zakresyWNowym(a, b);
    expect(m).toHaveLength(1);
    const dopisane = b.slice(m[0].od, m[0].do);
    expect(dopisane.trim()).toBe(roznicaSlow(a, b).find((k) => k.rodzaj === "dodane")!.tekst.trim());
    expect(dopisane).toContain("72");
    expect(m[0].usuniete).toContain("64");
  });

  it("odbudowa: poza zakresami stoi dokładnie wspólny tekst", () => {
    const a = "Dzień dobry, Panie Janie,\n\nnóż pasuje.\n- prowadnica 15 cali\nŻyczymy miłego dnia.";
    const b = "Dzień dobry,\n\nnóż pasuje do LS 46.\n- prowadnica 16 cali\n- łańcuch 64 ogniwa\nŻyczymy miłego dnia.";
    const r = roznicaSlow(a, b);
    let poza = "";
    let poz = 0;
    for (const z of zakresyWNowym(a, b)) { poza += b.slice(poz, z.od); poz = z.do; }
    poza += b.slice(poz);
    expect(poza).toBe(r.filter((k) => k.rodzaj === "wspolne").map((k) => k.tekst).join(""));
  });

  it("samo skreślenie to miejsce o zerowej szerokości w nowym tekście", () => {
    expect(zakresyWNowym("Nóż chyba pasuje.", "Nóż pasuje.")).toEqual([{ od: 4, do: 4, usuniete: "chyba " }]);
  });

  it("samo dopisanie nie ma skreślonego tekstu; bez zmian nie ma miejsc", () => {
    expect(zakresyWNowym("Nóż pasuje.", "Nóż na pewno pasuje.")).toEqual([{ od: 4, do: 13, usuniete: "" }]);
    expect(zakresyWNowym("Bez zmian.", "Bez zmian.")).toEqual([]);
  });
});
