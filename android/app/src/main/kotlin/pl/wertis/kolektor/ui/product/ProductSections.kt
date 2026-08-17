package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.product.czasKrotki
import pl.wertis.kolektor.core.product.dataKrotka
import pl.wertis.kolektor.core.product.podsumowanieHistorii
import pl.wertis.kolektor.core.product.podsumowanieMagazynow
import pl.wertis.kolektor.core.product.podsumowanieZamiennikow
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.core.text.jednostka
import pl.wertis.kolektor.ui.components.CollapsibleSection
import pl.wertis.kolektor.ui.components.ProductRowCard
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Trzy zwijane sekcje karty towaru ───────────────────────────────────────
   Historia, pozostałe magazyny oraz zamienniki z opisem. Wszystkie trzy
   odpowiadają na pytania zadawane RZADKO — „kto to ruszył", „gdzie jeszcze
   leży", „czym to zastąpić" — i żadne z nich nie jest krokiem codziennej
   pracy. Zwinięte oddają ekran temu, po co magazynier tu przyszedł, a swoje
   mówią podsumowaniem w nagłówku.

   SEKCJA BEZ DANYCH ZNIKA W CAŁOŚCI, nie szarzeje. Wyszarzony nagłówek jest
   obietnicą treści, której nie ma, i kosztuje 48 dp na ekranie o szerokości
   360 px.                                                                    */

/**
 * @param history `null` = jeszcze się wczytuje. Rozróżnienie jest konieczne:
 *   historia dochodzi osobnym żądaniem, więc bez niego wiersz wskoczyłby po
 *   chwili i przesunął cele dotyku pod kciukiem — dokładnie to, przed czym
 *   broni zarezerwowany slot WSTECZ na dolnym pasku.
 */
@Composable
fun HistoriaSekcja(history: List<MovementEntry>?, otwarta: Boolean, onToggle: () -> Unit) {
    val podsumowanie = podsumowanieHistorii(history) ?: return
    CollapsibleSection("Historia", podsumowanie, otwarta, onToggle) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .cardSurface(background = CardWhite, borderColor = CardBorder)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            history.orEmpty().take(4).forEach { h ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        h.detail.ifEmpty { h.type },
                        fontSize = 11.5.sp,
                        color = InkSoft,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "${h.user} · ${dataKrotka(h.at)} ${czasKrotki(h.at)}",
                        fontSize = 11.sp,
                        color = InkMute,
                    )
                }
            }
        }
    }
}

/**
 * Pozostałe magazyny — te bez roli, plus zwroty od klientów, gdy coś na nich
 * leży.
 *
 * Zwroty mają rolę i własną ścieżkę pracy, więc formalnie do „pozostałych" nie
 * należą. Trafiają tu, bo pytanie jest jedno („gdzie ten towar jeszcze leży"),
 * a osobny kafel na karcie bez przewijania konkurowałby z nagłówkiem o miejsce
 * przy stanie, który pojawia się rzadko. Idą PIERWSZE i z dopiskiem, bo jako
 * jedyne z tej listy niosą czynność do wykonania.
 */
@Composable
fun MagazynySekcja(
    p: ProductCard,
    otwarta: Boolean,
    onToggle: () -> Unit,
    /**
     * Dotknięcie kafla = przesunięcie stanu z TEGO magazynu. Magazyn podajemy
     * identyfikatorem albo rolą: identyfikatory ról siedzą w konfiguracji
     * serwera, więc kolektor zna je tylko przez `rola`.
     */
    onPrzesun: (magId: Long?, rola: String?, dostepne: Double) -> Unit,
) {
    val zwroty = p.zwroty?.stan ?: 0.0
    val podsumowanie = podsumowanieMagazynow(p.magazyny, zwroty) ?: return
    CollapsibleSection("Pozostałe magazyny", podsumowanie, otwarta, onToggle) {
        /* Wiersz jest teraz CZYNNOŚCIĄ, nie tylko liczbą: dotknięcie otwiera
           przesunięcie z tego magazynu. Do 0.22.0 karta mówiła „towar leży też
           tam" i na tym się kończyła — przenieść go dało się wyłącznie przez
           sesję kontenerową albo ręcznie w Subiekcie. */
        if (zwroty > 0) {
            MagazynRow("ZWROTY", "zwroty od klientów — rozlicza biuro", zwroty, p.unit) {
                onPrzesun(null, "ZWROTY", zwroty)
            }
        }
        p.magazyny.forEach { m ->
            // dostępne = stan MINUS to, co z tego magazynu już jedzie
            MagazynRow(m.kod, m.nazwa, m.stan, p.unit, m.wDrodze) {
                onPrzesun(m.magId, null, m.stan - m.wDrodze)
            }
        }
    }
}

/**
 * Zamienniki wyczytane z opisu przez serwer (`services/zamienniki.ts`) oraz sam
 * opis kartoteki.
 *
 * Opis zszedł tutaj z góry ekranu. Na karcie jest prozą, w której siedzą numery
 * obce, dopiski o modelach i skróty sprzed lat — czyta się go przy rozmowie
 * z dostawcą, nie przy regale. Dwa wiersze pod EAN-em i tak go ucinały, więc
 * z góry ekranu nie dawał odpowiedzi, tylko zajmował miejsce. Rozwinięty
 * pokazuje się w całości.
 */
@Composable
fun ZamiennikiSekcja(
    graph: AppGraph,
    p: ProductCard,
    otwarta: Boolean,
    onToggle: () -> Unit,
    onOpen: (ProductRow) -> Unit,
) {
    val podsumowanie = podsumowanieZamiennikow(p.zamienniki, p.desc) ?: return
    CollapsibleSection("Zamienniki i opis", podsumowanie, otwarta, onToggle) {
        p.zamienniki.znane.forEach { row -> ProductRowCard(graph, row) { onOpen(row) } }
        if (p.zamienniki.obce.isNotEmpty()) {
            // numerów obcych nie mamy u siebie — nie ma dokąd w nie wejść,
            // ale to one idą w rozmowę z dostawcą
            Text(
                "Numery obce: " + p.zamienniki.obce.joinToString(" · "),
                fontSize = 11.5.sp,
                color = InkMute,
                lineHeight = 15.sp,
            )
        }
        if (p.desc.isNotBlank()) {
            Text("Opis: ${p.desc}", fontSize = 11.5.sp, color = InkMute, lineHeight = 15.sp)
        }
    }
}

/**
 * Jeden magazyn: kod, nazwa i stan w jednej linii.
 *
 * Świadomie wąski wiersz, a nie kafel z wielką cyfrą — te niosą decyzję („ile
 * odłożyć") i zajmują pół ekranu. Tu chodzi o odpowiedź na pytanie pomocnicze,
 * więc wiersz ma się mieścić nawet przy ośmiu magazynach.
 *
 * Zerowy stan zostaje WIDOCZNY, tylko przygaszony: zgłoszenie mówiło
 * o wszystkich magazynach, a od chowania jest osobne ustawienie. Milczące
 * odsiewanie zer kazałoby się domyślać, czy magazyn jest pusty, czy ukryty.
 */
@Composable
private fun MagazynRow(
    kod: String,
    nazwa: String,
    stan: Double,
    unit: String,
    wDrodze: Double = 0.0,
    onTap: (() -> Unit)? = null,
) {
    val pusty = stan == 0.0
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = CardWhite, borderColor = CardBorder)
            // pusty magazyn nie ma czego oddać, więc nie udaje przycisku
            .let { if (onTap != null && !pusty) it.clickable(onClick = onTap) else it }
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                kod,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = if (pusty) InkMute else Ink,
            )
            val podpis = if (wDrodze > 0) "$nazwa · ⏳ ${formatQty(wDrodze)} w drodze" else nazwa
            if (podpis.isNotBlank()) {
                Text(podpis, fontSize = 11.sp, color = InkMute, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(
            formatQty(stan),
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 20.sp,
            color = if (pusty) InkMute else Ink,
        )
        // przez `jednostka()`, nie przez `unit` wprost: kartoteka bez jednostki
        // zostawiała tu samą liczbę, a wiersz obok niej miał już swoją
        Text(
            jednostka(unit),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = InkMute,
            modifier = Modifier.padding(start = 3.dp),
        )
    }
}
