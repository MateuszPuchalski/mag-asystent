/**
 * Kopiowanie do schowka, które działa TAKŻE po zwykłym HTTP (0.228.0).
 *
 * ── BLIZNA ────────────────────────────────────────────────────────────────
 * `navigator.clipboard` istnieje wyłącznie w „bezpiecznym kontekście": HTTPS
 * albo `localhost`. Biuro pracuje pod `http://serwer:3001` i pod
 * `http://mag.wertis.local:3001` (DEPLOY.md §„Kolektory"), czyli ANI JEDNO,
 * ANI DRUGIE — obiekt jest tam `undefined`.
 *
 * Do 0.227.0 przyciski kopiowania przy zwrotach wołały `navigator.clipboard?.`
 * z `.catch(() => {})` na końcu. Na biurowej przeglądarce nie kopiowały więc
 * NIC i nie mówiły o tym ani słowa: ikona mrugała „skopiowano", a schowek
 * zostawał pusty. Cisza była gorsza od braku przycisku, bo człowiek wkleja
 * dopiero gdzie indziej i dowiaduje się o niepowodzeniu po fakcie.
 *
 * ── DLACZEGO `execCommand`, SKORO JEST PRZESTARZAŁY ───────────────────────
 * Bo to jedyna droga, którą przeglądarka daje w niezabezpieczonym kontekście.
 * Przestarzały i działający bije nowoczesny i nieobecny. Gdy biuro kiedyś
 * stanie za HTTPS, pierwsza gałąź weźmie wszystko i ta druga zwyczajnie
 * przestanie się wykonywać.
 *
 * Zwracamy `boolean`, a nie `void`: wołający MA obowiązek pokazać, że się nie
 * udało. To jest cała różnica wobec poprzedniej wersji.
 */
export async function kopiujDoSchowka(tekst: string): Promise<boolean> {
  /* Nowoczesna droga — HTTPS albo localhost. Może odmówić także wtedy, gdy
     użytkownik nie zgodził się na dostęp do schowka, więc `catch` schodzi do
     drogi zapasowej zamiast kończyć niepowodzeniem. */
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(tekst);
      return true;
    } catch { /* spadamy do `execCommand` niżej */ }
  }
  return kopiujPrzezPoleTekstowe(tekst);
}

/**
 * Droga zapasowa: zaznaczenie w niewidocznym polu i `document.execCommand`.
 *
 * Pole musi BYĆ W DOKUMENCIE i dać się zaznaczyć, więc nie może mieć
 * `display: none` ani `hidden`. Stąd wyprowadzenie poza ekran zamiast ukrycia
 * — i `readOnly`, żeby na telefonie nie wyskoczyła klawiatura.
 */
function kopiujPrzezPoleTekstowe(tekst: string): boolean {
  const pole = document.createElement("textarea");
  pole.value = tekst;
  pole.setAttribute("readonly", "");
  pole.setAttribute("aria-hidden", "true");
  pole.style.position = "fixed";
  pole.style.top = "-1000px";
  pole.style.opacity = "0";
  document.body.appendChild(pole);
  try {
    pole.select();
    /* `execCommand` nie istnieje w jsdom i bywa wycięty w przyszłych
       przeglądarkach — brak metody znaczy „nie udało się", nie wyjątek. */
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    pole.remove();
  }
}
