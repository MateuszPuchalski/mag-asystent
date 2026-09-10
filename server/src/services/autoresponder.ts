import { zloz } from "../tekst.js";

/**
 * Rozpoznanie NASZEJ automatycznej odpowiedzi na osi rozmowy.
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Skrzynka biura odbija każdy przychodzący e-mail potwierdzeniem „Dziękujemy
 * za kontakt". Wiadomość jest długa — godziny pracy, ta sama treść po polsku
 * i po angielsku — a niesie DOKŁADNIE ZERO informacji o sprawie klienta.
 * Na osi wygląda jak nasza odpowiedź i zajmuje tyle miejsca, co odpowiedź:
 * przy dwóch odbiciach pytanie klienta schodzi poniżej krawędzi okna.
 *
 * Właściciel: „zwijaj i oznaczaj". Zwijamy, a nie kasujemy, bo autoodpowiedź
 * jest FAKTEM w rozmowie — dowodzi, że list dotarł, i tłumaczy klientowi, skąd
 * wziął się kontakt bez treści. Ukrycie jej kazałoby przy sporze szukać
 * prawdy poza panelem.
 *
 * ── DLACZEGO PO TREŚCI, A NIE PO FLADZE ───────────────────────────────────
 * Nagłówków `Auto-Submitted` ani `X-Autoreply` nie mamy: kanał oddaje treść
 * wiadomości, nie kopertę. Zdanie niżej jest jednak NASZE — sami je napisaliśmy
 * w autoresponderze — więc nie zgadujemy tu cudzego kształtu, tylko rozpoznajemy
 * własny podpis. To różnica wobec zakazu z CLAUDE.md, który mówi o Allegro.
 *
 * PRÓBUJEMY JEDNEGO ZDANIA, nie całego bloku. Godziny pracy zmieniają się
 * przy pierwszej zmianie grafiku, powitanie — przy pierwszej korekcie stylu;
 * zdanie „ta wiadomość jest generowana automatycznie" jest tym, co autoodpowiedź
 * o sobie MÓWI, i przeżyje obie te zmiany.
 */
const PODPISY = [
  /* Polski i angielski stoją w jednej wiadomości, ale dopasowanie któregokolwiek
     wystarcza: przycięcie treści przez kanał ucina zwykle koniec, czyli angielski. */
  "wiadomosc jest generowana automatycznie",
  "message is generated automatically",
] as const;

/**
 * Czy treść jest naszą automatyczną odpowiedzią.
 *
 * WOŁAJ TO WYŁĄCZNIE DLA WIADOMOŚCI WYCHODZĄCYCH. Klient, który odpisuje
 * z cytatem naszego potwierdzenia pod spodem, niesie ten sam podpis w treści —
 * a jego wiadomość jest pytaniem, nie odbiciem, i zwinięcie jej byłoby
 * zgubieniem sprawy. Kierunek rozstrzyga o tym pewnie, treść nie rozstrzyga
 * wcale, więc warunek stoi po stronie wołającego — od 0.257.0 w jednym
 * miejscu, `flagaAutoodpowiedzi` w `conversations.ts`.
 */
export function czyAutoresponder(tresc: string): boolean {
  /* `zloz` zdejmuje wielkość liter i polskie znaki: autoresponder bywa
     przepisywany, a „wiadomość" z rozsypanym kodowaniem to wciąż ta sama
     wiadomość. Białe znaki zwijamy do jednej spacji, bo w oryginale zdanie
     łamie się w innym miejscu w mailu, a w innym po przejściu przez kanał. */
  const plaska = zloz(tresc).replace(/\s+/g, " ");
  return PODPISY.some((p) => plaska.includes(p));
}
