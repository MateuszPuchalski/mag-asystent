import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";

/* ── pdf.js: jedno wejście, ładowane dopiero przy pierwszym PDF-ie ──────────
   Biblioteka waży kilkaset kilobajtów, a jej worker ponad megabajt. Większość
   rozmów PDF-a nie ma, więc import jest LENIWY i trafia do osobnego kawałka
   pakietu. Główny pakiet panelu nie rośnie o ani jeden bajt pdf.js.

   Wersja `legacy`, bo zwykła woła `Map.getOrInsertComputed`, którego
   Chromium sprzed kilku miesięcy nie zna. Każdy PDF kończyłby się wtedy
   zdaniem „nie umiem otworzyć", a przeglądarki biura nie aktualizujemy sami.

   Worker przychodzi adresem `?url` z naszego serwera. Kopia z CDN-u
   wyprowadzałaby przeglądarkę biura poza własną sieć, a domyślny „fake
   worker” parsowałby obcy plik w wątku ekranu i zamrażał czat.

   CZEGO NIE WŁĄCZAMY. Rysujemy samo płótno: bez warstwy tekstu, adnotacji
   i formularzy, więc skrypty PDF-a nie mają gdzie się wykonać. Wygląd
   adnotacji (pieczątka, podpis) ląduje na płótnie jako obraz, bo to część
   treści dokumentu. XFA wyłączone jawnie, bo to formularz z własną logiką.
   Ta wersja pdf.js nie ma już drogi przez `eval`, więc opcji
   `isEvalSupported` nie ma czym ustawić — sprawdzone w `build/` paczki.
   Bezpieczeństwo samego adresu trasy trzyma serwer nagłówkiem
   `content-security-policy: sandbox`. */

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let ladowanie: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  ladowanie ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([modul, worker]) => {
    modul.GlobalWorkerOptions.workerSrc = worker.default;
    return modul;
  }).catch((e: unknown) => {
    /* Nieudany import NIE zostaje zapamiętany. Serwer bierze wydania sam,
       a kawałek pakietu ze starą nazwą znika w trakcie dnia pracy. Następna
       próba ma pytać od nowa, nie oddawać tej samej porażki do F5. */
    ladowanie = null;
    throw e;
  });
  return ladowanie;
}

/**
 * Katalog dekoderów obrazów skanu, z wersją biblioteki w nazwie.
 *
 * pdf.js dokleja do niego nazwę pliku i żąda ukośnika na końcu. Wtyczka
 * `dekoderyPdf` w `vite.config.ts` kładzie pliki pod tymi samymi nazwami.
 * Adres jest bezwzględny, bo worker liczyłby względny od własnego pliku.
 */
export const adresDekoderow = (wersja: string): string =>
  new URL(`${import.meta.env.BASE_URL}assets/pdfjs-${wersja}/`, location.href).href;

/** Otwarty dokument i jego sprzątanie; `zniszcz` działa też przed końcem ładowania. */
export type OtwieranyPdf = { dokument: Promise<PDFDocumentProxy>; zniszcz: () => void };

/**
 * Otwiera PDF z bajtów w pamięci.
 *
 * KOPIA bajtów, nie oryginał: pdf.js PRZEKAZUJE bufor do workera, a po
 * przekazaniu bufor w wołającym ma długość zero. Oryginał leży we wspólnym
 * wpisie zapytania, z którego czytają miniatura i okno, więc oddanie go
 * zostawiłoby oknu pusty plik.
 */
export function otworzPdf(bajty: Uint8Array): OtwieranyPdf {
  let zadanie: PDFDocumentLoadingTask | null = null;
  let zniszczone = false;
  const dokument = pdfjs().then((m) => {
    if (zniszczone) throw new Error("Podgląd zamknięty przed otwarciem dokumentu.");
    zadanie = m.getDocument({ data: bajty.slice(), enableXfa: false, wasmUrl: adresDekoderow(m.version) });
    return zadanie.promise;
  });
  return {
    dokument,
    zniszcz: () => {
      zniszczone = true;
      void zadanie?.destroy();
    },
  };
}

/** Proporcja strony: wysokość przez szerokość, przy obrocie z pliku. */
export const proporcja = (strona: PDFPageProxy): number => {
  const v = strona.getViewport({ scale: 1 });
  return v.height / v.width;
};

/**
 * Rysuje stronę na płótnie o szerokości `szerokoscCss` pikseli ekranu.
 *
 * Gęstość ekranu wchodzi w rozdzielczość płótna, bo inaczej tekst faktury
 * na ekranie z powiększeniem jest rozmazany. Sufit 2, bo każda strona to
 * osobne płótno, a pamięć karty biura ma granice.
 */
export function rysujStrone(strona: PDFPageProxy, plotno: HTMLCanvasElement, szerokoscCss: number): RenderTask {
  const podstawa = strona.getViewport({ scale: 1 });
  const gestosc = Math.min(window.devicePixelRatio || 1, 2);
  const widok = strona.getViewport({ scale: (szerokoscCss / podstawa.width) * gestosc });
  plotno.width = Math.max(1, Math.floor(widok.width));
  plotno.height = Math.max(1, Math.floor(widok.height));
  return strona.render({ canvas: plotno, viewport: widok });
}

/** Czy porażka to celowe przerwanie rysowania (zamknięte okno), a nie awaria pliku. */
export const przerwane = (e: unknown): boolean =>
  e instanceof Error && (e.name === "RenderingCancelledException" || /zamknięty przed/.test(e.message));
