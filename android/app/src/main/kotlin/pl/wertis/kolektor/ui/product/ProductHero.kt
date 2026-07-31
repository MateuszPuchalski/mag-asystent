package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
 */
@Composable
fun ProductHero(p: ProductCard, adres: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 12.dp),
    ) {
        /* Symbol stoi PIERWSZY i największy. To jedyny identyfikator, którym
           magazynier posługuje się przy regale: nazwy się powtarzają („nóż
           kosiarki" ma kilkanaście kartotek), a EAN-u nie da się przeczytać
           z ręki. Nazwa jest potwierdzeniem, że to ten towar — nie sposobem
           na jego znalezienie. */
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
        Text(
            "EAN ${p.ean.ifEmpty { "—" }} · ${p.unit.ifEmpty { "—" }}",
            fontSize = 11.sp,
            color = InkMute,
            modifier = Modifier.padding(top = 2.dp),
        )
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
                   oznacza czynność: towar leży w przyjęciach, idź po niego. */
                Row {
                    Text(
                        "rez. ${formatQty(p.mag.rez)} · razem ${formatQty(p.mag.stan)}",
                        fontSize = 11.sp,
                        color = InkSoft,
                    )
                    if (p.mgp.stan > 0) {
                        Text(
                            " · MGP ${formatQty(p.mgp.stan)}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = AmberInk,
                        )
                    }
                }
            }
            adres()
        }
    }
}

/**
 * Karta faktów — po jednej linii na dokument.
 *
 * Dwie rzeczy, które kafel stanu przemilcza. „W dostawie" mówi: jest u nas,
 * poszukaj w przyjęciach — przy dostawie krajowej towar figuruje na MAG od
 * zaksięgowania dokumentu, więc liczba nad tą kartą nie odróżnia „leży
 * w regale" od „stoi na palecie". „Zamówione" mówi: nie ma i trzeba poczekać.
 *
 * Obie linie stoją na jednej powierzchni, a rozróżnia je tusz i ikona:
 * bursztyn przy dostawie (jest co zrobić), szarość przy zamówieniu (nie ma).
 * Karta jest NIEKLIKALNA i to jest decyzja, nie niedoróbka — wejście
 * w dokument z karty towaru wołałoby trasę rozkładania, a ta przestawia flagę
 * faktury w Subiekcie na „W trakcie sprawdzania". Biuro zobaczyłoby, że ktoś
 * sprawdza fakturę, bo magazynier zajrzał na kartę towaru. Numer dokumentu
 * w zupełności wystarcza, żeby znaleźć paletę.
 */
@Composable
fun FaktyCard(p: ProductCard) {
    if (p.wDostawie.isEmpty() && p.zamowione.isEmpty()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = AmberBgSoft, borderColor = AmberLine)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
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
