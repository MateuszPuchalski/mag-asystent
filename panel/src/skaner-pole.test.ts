import { describe, expect, it } from "vitest";
import { MIN_DLUGOSC, PRZERWA_MS, SeriaWPolu } from "./skaner";

/* ── Skan w polu szukania zastępuje, nie dopisuje (0.329.0) ──────────────────
   Zgłoszenie właściciela: „skan powinien najpierw wyczyścić pole szukania,
   a nie dopisywać się na końcu tego, co już w nim stoi".

   Ta reguła psuje się w DWIE strony i obie kosztują:

   — zbyt leniwa zostawia sklejone dwa numery, a szukanie po nich nie znajduje
     nic i wygląda na zepsuty czytnik;
   — zbyt gorliwa kasuje numer wpisywany ręką, w środku pisania. Tego biuro nie
     nazwie usterką, tylko „znowu mi zjadło", i nikt tego nie zgłosi.

   Dlatego testy pilnują OBU stron, a zegar jest wstrzykiwany: bez niego
   „szybko" i „po namyśle" różniłyby się w teście tylko nadzieją.            */

const znak = (k: string) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false });

/** Wysyła serię znaków co `co` ms i oddaje wynik ostatniego. */
function wystukaj(s: SeriaWPolu, tekst: string, wPolu: string, od: number, co: number) {
  let pole = wPolu;
  let ostatni = { podmien: null as string | null, kod: null as string | null };
  [...tekst].forEach((k, i) => {
    ostatni = s.klawisz(znak(k), pole, od + i * co);
    /* Tak jak przeglądarka: znak wpada do pola, chyba że go podmieniliśmy. */
    pole = ostatni.podmien ?? pole + k;
  });
  return { wynik: ostatni, pole };
}

describe("Skan w polu szukania", () => {
  it("czytnik ZASTĘPUJE to, co stało w polu", () => {
    /* Operator zeskanował jedną etykietę, potem drugą. Bez tej reguły szuka
       po sklejeniu dwóch numerów i nie znajduje nic. */
    const s = new SeriaWPolu();
    const { pole } = wystukaj(s, "600000367616", "N4QZ/2026", 10_000, 10);
    expect(pole).toBe("600000367616");
  });

  it("pole PUSTE zostaje nietknięte — nie ma czego zastępować", () => {
    const s = new SeriaWPolu();
    const { pole, wynik } = wystukaj(s, "600000367616", "", 10_000, 10);
    expect(wynik.podmien).toBeNull();
    expect(pole).toBe("600000367616");
  });

  it("numer wpisywany RĘKĄ nie znika w połowie", () => {
    /* Człowiek stuka wolniej niż czytnik. Skasowanie mu pola w środku pisania
       jest gorsze niż sklejenie: sklejenie widać, zniknięcie wygląda na duch. */
    const s = new SeriaWPolu();
    const { pole, wynik } = wystukaj(s, "N4QZ2026", "stare", 10_000, PRZERWA_MS + 50);
    expect(wynik.podmien).toBeNull();
    expect(pole).toBe("stareN4QZ2026");
  });

  it("poprawka Backspace'em przerywa serię", () => {
    /* Po poprawce ręką to już nie jest skan, choćby dalsze znaki leciały
       gęsto — a gdyby był, zjadłby właśnie poprawiony numer. */
    const s = new SeriaWPolu();
    s.klawisz(znak("6"), "stare", 10_000);
    s.klawisz({ key: "Backspace" }, "stare6", 10_010);
    const { wynik } = wystukaj(s, "000003676", "stare", 10_020, 10);
    expect(wynik.podmien).toBeNull();
  });

  it("krótka gęsta seria to NIE kod", () => {
    /* Żaden numer listu ani zwrotu nie jest krótszy niż `MIN_DLUGOSC`. */
    const s = new SeriaWPolu();
    const { wynik } = wystukaj(s, "600", "stare", 10_000, 10);
    expect(wynik.podmien).toBeNull();
    expect("600".length).toBeLessThan(MIN_DLUGOSC);
  });

  it("Enter oddaje SERIĘ, a nie sklejenie — nawet gdy podmiana nie zaszła", () => {
    /* Ostatnia szansa na poprawienie pola: czytnik bez Entera pośrodku,
       pole puste w chwili startu serii, kod krótszy od progu podmiany. */
    const s = new SeriaWPolu();
    wystukaj(s, "600000367616", "", 10_000, 10);
    const koniec = s.klawisz(znak("Enter"), "600000367616", 10_130);
    expect(koniec.kod).toBe("600000367616");
  });

  it("Enter po pisaniu ręką NIE podstawia żadnego kodu", () => {
    /* Wtedy szuka się po całej treści pola — tak jak dotąd. */
    const s = new SeriaWPolu();
    wystukaj(s, "N4QZ", "", 10_000, PRZERWA_MS + 50);
    expect(s.klawisz(znak("Enter"), "N4QZ", 20_000).kod).toBeNull();
  });

  it("skrót z klawiszem sterującym przecina serię na pół", () => {
    /* Ctrl+A i spółka to człowiek przy klawiaturze. Znaki sprzed skrótu nie
       mają prawa doliczyć się do kodu zeskanowanego po nim. */
    const s = new SeriaWPolu();
    wystukaj(s, "60000", "stare", 10_000, 10);
    s.klawisz({ key: "a", ctrlKey: true }, "stare60000", 10_060);
    const { wynik } = wystukaj(s, "367616", "stare60000", 10_070, 10);
    expect(wynik.podmien).toBe("367616");
  });
});
