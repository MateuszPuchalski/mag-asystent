import { describe, expect, it } from "vitest";
import { rozbierzFormularz, scisle, zawieraOpis } from "./tresc";

/* ── Treść wiadomości reklamacyjnej (0.415.0) ────────────────────────────────
   WEJŚCIA SĄ PRAWDZIWE, nie wymyślone, i to jest cała lekcja tego wydania.
   0.412.0 miało test dubla, test przechodził, a na produkcji poprawka nie
   zadziałała ani razu — bo karmiliśmy ją parą, którą sami napisaliśmy. Tekst
   niżej jest przepisany ze zrzutu właściciela ze sprawy szarpaka.            */

const OPIS = "Po kilku użyciach szarpak przestał wciągać sznurek do środka .";

const FORMULARZ = [
  "Problem: wada wykryta podczas używania",
  "",
  `Opis: ${OPIS}`,
  "",
  "Oczekiwane rozwiązanie: wymiana",
  "",
  "Warunki reklamacji: reklamacja ustawowa Adres kupującego:",
  "Krzysztof Mołczan",
  "Starowiejska 10",
  "38-516 Czaszyn",
  "++48 663509353",
].join("\n");

describe("Dubel zgłoszenia liczy się przez ZAWARCIE", () => {
  it("łapie opis schowany w formularzu Allegro — to przepuściło 0.412.0", () => {
    expect(zawieraOpis(FORMULARZ, OPIS)).toBe(true);
  });

  it("łapie go także przy innym łamaniu wierszy — porównujemy treść, nie oddech", () => {
    expect(zawieraOpis(FORMULARZ, "Po kilku użyciach szarpak przestał\n wciągać sznurek do środka ."))
      .toBe(true);
  });

  it("nie uznaje za dubel krótkiego zdania, które trafia się wszędzie", () => {
    /* „Dzień dobry" mieści się w niemal każdej wiadomości i nie znaczy, że
       opis sprawy jest jej częścią. */
    expect(zawieraOpis("Dzień dobry, proszę o wymianę.", "Dzień dobry")).toBe(false);
  });

  it("nie uznaje za dubel opisu, którego w wiadomości nie ma", () => {
    expect(zawieraOpis(FORMULARZ, "Zamówiłem nóż 46 cm, przyszedł 56 cm.")).toBe(false);
  });

  it("scisle zbija oddech, a nie treść", () => {
    expect(scisle("  a\n\n b  ")).toBe("a b");
  });
});

describe("Formularz Allegro rozbiera się po ETYKIETACH", () => {
  it("wyjmuje zdanie klienta i zostawia całość do pokazania", () => {
    const f = rozbierzFormularz(FORMULARZ);
    expect(f?.opis).toBe(OPIS);
    expect(f?.calosc).toBe(FORMULARZ);
  });

  it("nie rusza zwykłej wiadomości — jedna etykieta to za mało", () => {
    /* Klient potrafi zacząć zdanie od słowa „Opis”. Wymagamy DWÓCH trafionych
       etykiet, żeby zwykła wiadomość nie udawała formularza. */
    expect(rozbierzFormularz("Opis: pękła obudowa po tygodniu")).toBe(null);
  });

  it("MILCZY, gdy etykiety są, ale pola „Opis” nie ma", () => {
    /* Składanie wiadomości, z której nie umiemy wyjąć treści, zostawiłoby na
       ekranie samą zapowiedź „pokaż całość” nad pustym miejscem. */
    expect(rozbierzFormularz(
      "Problem: wada wykryta podczas używania\n\nOczekiwane rozwiązanie: wymiana")).toBe(null);
  });

  it("MILCZY, gdy Allegro zmieni etykiety — psujemy się w stronę ciszy", () => {
    expect(rozbierzFormularz(
      "Rodzaj problemu: wada\n\nTreść: szarpak nie działa\n\nŻądanie: wymiana")).toBe(null);
  });

  it("kończy pole „Opis” na NAJBLIŻSZEJ etykiecie, nie na pierwszej z listy", () => {
    /* Kolejność pól w formularzu nie jest niczym obiecana, a Allegro potrafi
       dołożyć pole. Bez tego opis wchłonąłby wszystko do „Problem:”. */
    const f = rozbierzFormularz(
      "Opis: szarpak nie wciąga\n\nAdres kupującego: Czaszyn\n\nProblem: wada");
    expect(f?.opis).toBe("szarpak nie wciąga");
  });
});
