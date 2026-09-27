import axe from "axe-core";

/* ── STRAŻNIK DOSTĘPNOŚCI EKRANÓW (0.546.0) ─────────────────────────────────
   Po każdym teście ekranu (`src/ekrany/`, `src/druk/`) axe-core sprawdza
   wyrenderowany DOM regułami WCAG 2.2 A i AA. Test ekranu ma już dane, które
   agent widzi w pracy: sprawy, wiadomości, zwroty. Pomiar na nich łapie to,
   czego pusta kolejka w przeglądarce nie pokaże.

   DLACZEGO TU, A NIE W PRZEGLĄDARCE. Bramki przed wypchnięciem nie uruchamiają
   Playwrighta, a strażnik poza bramkami nie jest strażnikiem. Koszt zmierzony
   przy wprowadzeniu: 367 testów ekranów, +16 s na całym przebiegu.

   CZEGO NIE PILNUJE. Kontrastu: jsdom nie liczy układu ani barw, więc reguła
   `color-contrast` jest tu wyłączona. Ten kontrast mierzy się w przeglądarce
   (`tools/audyt-dostepnosci.mjs`), a znane złe pary pilnuje `Kontrast.test.ts`.
   Nie widzi też fokusu, kolejności tabulatora ani celów dotyku. Zielony wynik
   znaczy: nazwy, etykiety, role i struktura są w porządku. Nie znaczy: ekran
   przechodzi WCAG w całości.

   Przy wprowadzeniu 1410 testów obsługi klienta i ekranów dało zero naruszeń,
   więc próg jest zerowy od pierwszego dnia i nie ma listy wyjątków. */

const OBSZAR = /\/src\/(ekrany|druk)\//;

const OPCJE: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  rules: { "color-contrast": { enabled: false } },
};

/** Opis naruszeń do komunikatu testu — reguła, waga i pierwsze elementy. */
function opisz(naruszenia: axe.Result[]): string {
  return naruszenia.map((v) => `  ${v.id} (${v.impact}): ${v.help}\n` + v.nodes.slice(0, 3)
    .map((n) => `    ${n.target.join(" ")} :: ${n.html.slice(0, 140)}`).join("\n")).join("\n");
}

/** Sprawdza bieżący DOM, jeśli test należy do obszaru ekranów. */
export async function sprawdzDostepnosc(sciezkaTestu: string | undefined): Promise<void> {
  if (!sciezkaTestu || !OBSZAR.test(sciezkaTestu)) return;
  if (!document.body.textContent?.trim()) return;
  const wynik = await axe.run(document.body, OPCJE);
  if (wynik.violations.length) {
    throw new Error(`Naruszenia dostępności (WCAG 2.2 AA) w DOM ekranu:\n${opisz(wynik.violations)}`);
  }
}
