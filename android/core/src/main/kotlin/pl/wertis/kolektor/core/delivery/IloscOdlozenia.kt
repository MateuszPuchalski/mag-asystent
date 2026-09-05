package pl.wertis.kolektor.core.delivery

/* ── Ile sztuk z pozycji idzie na półkę ─────────────────────────────────────
   Ta reguła stała w trzech miejscach ekranu rozkładania i w każdym znaczyła
   co innego. Że rozjazd przeżył dwadzieścia wydań, nie jest przypadkiem:
   mieszkał w ciele composable'a, a `:app` nie ma ani jednego testu i nie
   kompiluje się poza CI — więc nie było czym tego pokazać. Kosztował dwie
   usterki naraz.

   1. NADMIAR NIE DOCHODZIŁ DO SERWERA. Od 0.64.0 licznik `+` idzie ponad
      fakturę po jednym potwierdzeniu, bo nadmiar ma trafić do biura jako
      zgłoszenie wobec dostawcy — tak brzmiało zgłoszenie i tak liczy to
      serwer (`putawayLine` nie ma górnej granicy, `nadmiar-dostawy.test.ts`).
      Zapis mimo to ścinał ilość do reszty z dokumentu — `coerceIn(1.0,
      zostalo)` wpisane w 0.42.0, dwadzieścia dwa wydania przed tym, jak
      nadmiar stał się dozwolony. Kafel pokazywał 15, sygnał zapisu brzmiał
      normalnie, na półkę szło 10, a biuro nie dowiadywało się niczego.
   2. POPRAWKA NA POZYCJI ZAMKNIĘTEJ WYWALAŁA ZAPIS. Przy pozycji odłożonej
      w całości reszta wynosi zero, więc `coerceIn(1.0, 0.0)` rzucał
      `IllegalArgumentException` — łapany razem z błędami sieci i pokazywany
      jako „Błąd zapisu". Wiersz odłożony i jednocześnie rozwinięty zdarza się
      realnie; stoi o tym komentarz przy `TrybWiersza`.

   GÓRNEJ GRANICY NIE MA i to jest cała treść tej reguły. Bramką dla nadmiaru
   jest potwierdzenie w panelu, nie ścinanie liczby przy zapisie: ścięta ilość
   to cicha pomyłka co do stanu magazynu — najgorszy rodzaj, bo wygląda jak
   udany zapis.                                                                */

/**
 * Ile jeszcze zostało wg dokumentu.
 *
 * Nigdy ujemne: po odłożeniu nadmiaru `qtyDone` przekracza `qtyDoc`,
 * a „zostało minus dwa" nie jest ani zdaniem do pokazania człowiekowi, ani
 * liczbą do odjęcia od czegokolwiek.
 */
fun zostaloDoOdlozenia(qtyDoc: Double, qtyDone: Double): Double =
    (qtyDoc - qtyDone).coerceAtLeast(0.0)

/**
 * Ilość do wysłania na serwer; `null` = „cała reszta".
 *
 * `null` NIE jest tu podmieniane na wyliczoną liczbę i to jest celowe: pusta
 * wartość niesie intencję, a liczba zamrażałaby stan pozycji z chwili otwarcia
 * panelu. Resztę liczy serwer, w momencie zapisu.
 *
 * @param wybrana ilość ustawiona ręcznie przez magazyniera; `null` = nie tknął
 */
fun iloscDoOdlozenia(wybrana: Double?): Double? = wybrana?.coerceAtLeast(1.0)

/**
 * Ile pokazać w kaflu „ile idzie teraz".
 *
 * To ta sama liczba, którą dostanie serwer — tylko z rozwiniętym `null`.
 * Jedna funkcja dla kafla i dla zapisu, bo rozjazd między tym, co magazynier
 * widzi, a tym, co idzie na półkę, jest tu najdroższym możliwym błędem.
 *
 * Dolne `1` dotyczy wyłącznie kafla: pozycja odłożona w całości ma resztę
 * zero, a kafel z zerem nie jest odpowiedzią na pytanie „ile idzie teraz".
 * Echo zapisu (`odlozonePoZapisie`) tego nie robi — patrz komentarz tam.
 */
fun iloscNaKaflu(wybrana: Double?, qtyDoc: Double, qtyDone: Double): Double =
    iloscDoOdlozenia(wybrana) ?: zostaloDoOdlozenia(qtyDoc, qtyDone).coerceAtLeast(1.0)

/**
 * Ile pozycja będzie miała odłożone po tym zapisie — echo dla widoku z cache,
 * gdy operacja poszła do bufora offline i świeży odczyt nie przyjdzie.
 *
 * Liczy DOKŁADNIE to, co policzy serwer po wypchnięciu bufora, więc bez
 * podłogi `1` z kafla i bez sufitu `qtyDoc`. Sufit stał tu do teraz i pokazywał
 * „10 z 10" tam, gdzie na półce leży 15 — czyli kłamstwo o tę jedną sztukę,
 * o którą w całym zgłoszeniu chodzi.
 */
fun odlozonePoZapisie(wybrana: Double?, qtyDoc: Double, qtyDone: Double): Double =
    qtyDone + (iloscDoOdlozenia(wybrana) ?: zostaloDoOdlozenia(qtyDoc, qtyDone))
