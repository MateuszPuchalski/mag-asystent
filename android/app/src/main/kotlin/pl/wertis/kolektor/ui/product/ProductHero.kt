package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.product.liniaWDostawie
import pl.wertis.kolektor.core.product.liniaZamowione
import pl.wertis.kolektor.core.product.liniaZlotaStrefa
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Nagłówek karty towaru i karta faktów ───────────────────────────────────
   Codzienne pytanie brzmi „ile jest i gdzie leży". Odpowiedź na oba mieści się
   w jednej karcie: liczba dostępna po lewej, adres pickingowy po prawej.
   Dawne dwa kafle (MAG i MGP) zajmowały pół ekranu na to samo, a MGP i tak
   jest dopowiedzeniem — dlatego zeszło do podlinijki.                        */

/**
 * @param adres pastylka adresu pickingowego (albo pusty stan) — rysuje ją
 *   `ProductScreen`, bo tylko on wie, co zrobić z dotknięciem.
 * @param zdjecie miniatura kartoteki — jak wyżej: `ProductScreen` wie, skąd
 *   wziąć bajty i co zrobić z dotknięciem, nagłówek wie tylko, GDZIE ją
 *   narysować.
 */
@Composable
fun ProductHero(
    p: ProductCard,
    onPrzesunZMgp: (() -> Unit)? = null,
    /** Otwarcie arkusza nadania kodu kreskowego (0.37.0). */
    onEan: () -> Unit = {},
    zdjecie: @Composable () -> Unit = {},
    adres: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 12.dp),
    ) {
        /* Zdjęcie idzie OBOK tożsamości, nie pod nią: odpowiada na pytanie
           zerowe („czy to na pewno TO"), zadawane zanim ktokolwiek spojrzy na
           stan. Rząd z symbolem ma na nie zapas wysokości, a dolny — ten
           z liczbą 44 sp i pastylką adresu — nie ma i nie wolno go ścieśniać. */
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                /* Symbol stoi PIERWSZY i największy. To jedyny identyfikator,
                   którym magazynier posługuje się przy regale: nazwy się
                   powtarzają („nóż kosiarki" ma kilkanaście kartotek), a EAN-u
                   nie da się przeczytać z ręki. Nazwa jest potwierdzeniem, że
                   to ten towar — nie sposobem na jego znalezienie. */
                Text(
                    p.sym,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 30.sp,
                    lineHeight = 32.sp,
                    color = Ink,
                )
                Text(
                    p.name,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 17.sp,
                    color = InkSoft,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 1.dp),
                )
                /* Linia EAN-u jest KLIKALNA (0.37.0). Kartoteka bez kodu ma tu
                   myślnik, a myślnik był dotąd końcem drogi: magazynier trzymał
                   karton z kodem i nie miał gdzie go wpisać. Cel dotyku 48 dp,
                   bo klika się w rękawicach.

                   Jednostka STĄD WYSZŁA (0.50.1). Stała tu obok wielkiej liczby
                   dostępnych, która i tak podpisuje się „szt dostępne" — więc
                   mówiła to samo dwa razy, w linii mającej jedno zadanie: podać
                   kod albo drogę do jego nadania. */
                Text(
                    if (p.ean.isEmpty()) "EAN —  ✎ NADAJ KOD" else "EAN ${p.ean}",
                    fontSize = 11.sp,
                    color = if (p.ean.isEmpty()) AmberInk else InkMute,
                    fontWeight = if (p.ean.isEmpty()) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier
                        .padding(top = 2.dp)
                        .heightIn(min = 48.dp)
                        .clickable(onClick = onEan)
                        .wrapContentHeight(),
                )
            }
            zdjecie()
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        formatQty(p.mag.avail),
                        fontFamily = BarlowCond,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 44.sp,
                        lineHeight = 44.sp,
                        color = Ink,
                    )
                    Text(
                        "${p.unit.ifEmpty { "szt" }} dostępne",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = InkMute,
                        modifier = Modifier.padding(start = 5.dp, bottom = 7.dp),
                    )
                }
                /* Rezerwacja, stan łączny i strefa przyjęć w jednej linijce.
                   Wszystkie trzy odpowiadają na pytanie zadane dopiero wtedy,
                   gdy wielka liczba nie zgadza się z półką — więc mają być
                   czytelne, a nie widoczne z drugiego końca alejki. MGP jest
                   pogrubione i bursztynowe, bo jako jedyne z tej trójki
                   oznacza czynność: towar leży w przyjęciach, idź po niego.
                   Od 0.22.0 ta czynność jest wykonalna jednym dotknięciem —
                   wcześniej trzeba było otworzyć sesję kontenerową. */
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "rez. ${formatQty(p.mag.rez)} · razem ${formatQty(p.mag.stan)}",
                        fontSize = 11.sp,
                        color = InkSoft,
                    )
                    if (p.mgp.stan > 0) {
                        /* Jedyne wejście w przesunięcie z MGP było celem
                           wysokim na 15 dp — tekst 11 sp bez żadnego marginesu.
                           40 dp to kompromis: rękawica trafia, a nagłówek nie
                           puchnie o pełne 48. */
                        Text(
                            " · MGP ${formatQty(p.mgp.stan)} — PRZESUŃ",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = AmberInk,
                            modifier = if (onPrzesunZMgp == null) Modifier
                            else Modifier
                                .heightIn(min = 40.dp)
                                .clickable(onClick = onPrzesunZMgp)
                                .wrapContentHeight(),
                        )
                    }
                }
            }
            adres()
        }
    }
}

/**
 * Karta faktów — po jednej linii na fakt.
 *
 * Od 0.50.0 bywa tu też linia przeslotowania („Zbierany 12×/dzień — przenieś
 * do strefy złotej") — jedyna, która prosi o decyzję, więc stoi pierwsza.
 *
 * Dwie rzeczy, które kafel stanu przemilcza. „W dostawie" mówi: jest u nas,
 * poszukaj w przyjęciach — przy dostawie krajowej towar figuruje na MAG od
 * zaksięgowania dokumentu, więc liczba nad tą kartą nie odróżnia „leży
 * w regale" od „stoi na palecie". „Zamówione" mówi: nie ma i trzeba poczekać.
 *
 * Obie linie stoją na jednej powierzchni, a rozróżnia je tusz i ikona:
 * bursztyn przy dostawie (jest co zrobić), szarość przy zamówieniu (nie ma).
 * Karta jest NIEKLIKALNA i to jest decyzja, nie niedoróbka — wejście
 * w dokument z karty towaru otwierałoby rozkładanie jako skutek uboczny
 * zwykłego zaglądania na kartę, bez zamiaru magazyniera. Numer dokumentu
 * w zupełności wystarcza, żeby znaleźć paletę.
 */
@Composable
fun FaktyCard(p: ProductCard) {
    if (p.wDostawie.isEmpty() && p.zamowione.isEmpty() && p.zlotaStrefa == null) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = AmberBgSoft, borderColor = AmberLine)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        /* Przeslotowanie idzie PIERWSZE: dostawy i zamówienia opisują stan,
           a ta linia jako jedyna prosi o decyzję. Rysuje ją serwer — pole jest
           obecne tylko, gdy towar rotuje szybko I stoi poza strefą złotą. */
        p.zlotaStrefa?.let { z ->
            FaktLinia(WIcons.Pin, AmberInk, liniaZlotaStrefa(z), FontWeight.SemiBold)
        }
        p.wDostawie.forEach { d ->
            FaktLinia(WIcons.Clock, AmberInk, liniaWDostawie(d, p.unit), FontWeight.SemiBold)
        }
        p.zamowione.forEach { z ->
            FaktLinia(WIcons.Box, InkSoft, liniaZamowione(z, p.unit), FontWeight.Medium)
        }
        /* Jedno zdanie na całą kartę, nie dopisek przy każdej linii: powód jest
           wspólny (serwer nie umiał odjąć odebranej części), a powtórzony przy
           każdym wierszu zamienia się w szum, który przestaje się czytać. */
        if (p.zamowione.any { it.szacunek }) {
            Text(
                "Ilości zamówień są górnym oszacowaniem — serwer nie odjął tego, co już przyjechało.",
                fontSize = 11.sp,
                color = InkMute,
            )
        }
    }
}

/**
 * Jedna linia faktu.
 *
 * `maxLines = 2` i NIGDY ellipsis: koniec linii niesie status („pominięte przy
 * rozkładaniu", „dokument w buforze"), czyli tę część, dla której linia
 * istnieje. Ucięta mówiłaby, że towar czeka w przyjęciach, przemilczając, że
 * ktoś już się o niego potknął.
 */
@Composable
private fun FaktLinia(ikona: ImageVector, tint: Color, tekst: String, waga: FontWeight) {
    Row(
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(ikona, null, tint = tint, modifier = Modifier.size(15.dp).padding(top = 1.dp))
        Text(tekst, fontSize = 12.sp, fontWeight = waga, color = tint, lineHeight = 16.sp, maxLines = 2)
    }
}
