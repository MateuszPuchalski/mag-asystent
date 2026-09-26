/* ── Tekst z PDF-u dla sita pasowania z sieci (@wydanie) ─────────────────────

   Najlepsze źródła pasowania — rysunki i wykazy części producentów — to
   najczęściej PDF-y. Do tego wydania automat je pomijał: `web_fetch` oddaje
   PDF jako bajty, a sito sprawdza cytat na TEKŚCIE strony. Bez tekstu każde
   znalezisko z katalogu producenta odpadało jako „strona nieprzeczytana”,
   czyli odrzucaliśmy dokładnie te źródła, którym ufamy najbardziej.

   `unpdf` to pdf.js w wersji bez natywnych zależności — instaluje się na
   serwerze biura bez kompilatora. Ładowany leniwie, bo jest ciężki, a PDF
   trafia się w części przebiegów, nie w każdym.

   Nic tu nie idzie do sieci: bajty przyszły już z odpowiedzi dostawcy. */

export type CzytnikPdf = (bajty: Uint8Array) => Promise<string>;

/** Większego PDF-u nie czytamy: katalog na setki stron to minuty procesora. */
export const SUFIT_BAJTOW_PDF = 20 * 1024 * 1024;
/** Ile PDF-ów z jednego przebiegu. Model czyta najwyżej kilka stron naraz. */
const SUFIT_PDF = 5;

export const czytajPdf: CzytnikPdf = async (bajty) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bajty);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
};

/**
 * PDF-y z przebiegu → strony z tekstem. PDF, którego nie da się przeczytać
 * (skan bez warstwy tekstu, uszkodzony plik, za duży), po prostu odpada —
 * jego znaleziska sito odrzuci jako „strona nieprzeczytana”, i to jest
 * właściwy wynik: cytatu nie ma czym sprawdzić.
 */
export async function tekstyPdf(
  pdfy: Array<{ url: string; base64: string }>, czytnik: CzytnikPdf = czytajPdf,
): Promise<Array<{ url: string; tekst: string }>> {
  const wynik: Array<{ url: string; tekst: string }> = [];
  for (const p of pdfy.slice(0, SUFIT_PDF)) {
    const bajty = Buffer.from(p.base64, "base64");
    if (bajty.length > SUFIT_BAJTOW_PDF) continue;
    try {
      const tekst = (await czytnik(new Uint8Array(bajty))).trim();
      if (tekst) wynik.push({ url: p.url, tekst });
    } catch {
      /* Nieczytelny PDF nie wywraca przebiegu — patrz nagłówek funkcji. */
    }
  }
  return wynik;
}
