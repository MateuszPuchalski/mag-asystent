package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.delivery.StanDokumentu
import pl.wertis.kolektor.core.delivery.stanDokumentu
import pl.wertis.kolektor.core.delivery.uporzadkujDokumenty
import pl.wertis.kolektor.core.net.DeliveryDocument
import pl.wertis.kolektor.core.net.DeliveryDocumentsResponse
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Tryb A: wybór dokumentu (redesign §4.1) ────────────────────────────────
   Lista faktur zakupu z okna importu, malejąco po dacie, z paskiem postępu.
   Dokumenty w buforze SGT są normalnie dostępne do pracy (D1) — rozkładanie nie
   czeka na księgowość. Ukończone schodzą na dół i szarzeją, ale nie znikają.

   ZWROTÓW TU NIE MA i nie ma ich też na serwerze: zakładka pokazuje wyłącznie
   to, czym towar wchodzi na magazyn u tego klienta, czyli same FZ
   (`DOK_TYPY_DOSTAW=1`). Zwroty rozlicza biuro w Subiekcie.                  */

@Composable
fun DeliveryDocumentsScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    // posiew z cache: powrót na listę rysuje ostatni znany stan od razu,
    // świeży dociąga w tle — bez „Wczytywanie…" przy każdym wejściu
    val odpowiedz by produceState(graph.cards.peekDocuments(), reload) {
        value = try {
            apiCall { graph.api.deliveryDocuments() }.also { graph.cards.putDocuments(it) }
        } catch (_: Exception) {
            value ?: DeliveryDocumentsResponse()
        }
    }

    fun open(d: DeliveryDocument) {
        scope.launch {
            try {
                val r = apiCall { graph.api.openDelivery(d.dokId) }
                graph.nav.openDelivery(r.deliveryId)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się otworzyć dostawy")
            }
        }
    }

    /* `rememberSaveable`, bo wejście w dostawę i powrót nie ma kasować tego,
       czego człowiek właśnie szukał. */
    var szukane by rememberSaveable { mutableStateOf("") }

    val r = odpowiedz
    if (r == null) {
        LoadingRow("Wczytywanie dostaw…")
        return
    }

    /* Do dokończenia na górze, ukończone na dole, reszta pośrodku malejąco po
       dacie. Reguła siedzi w :core (`ListaDokumentow.kt`), bo rozstrzyga
       zarazem kolejność listy i wygląd wiersza. */
    /* Filtr po numerze faktury i po dostawcy. Przy oknie trzydziestu dni lista
       potrafi mieć kilkadziesiąt pozycji, a biuro dzwoni z KONKRETNYM numerem
       („co z FZ 214?") — przewijanie kciukiem w rękawicy jest wtedy najgorszą
       możliwą odpowiedzią.

       Kolejność (do dokończenia → nowe → ukończone) liczy się PO odsianiu, więc
       wynik szukania zachowuje ten sam porządek co pełna lista — inaczej ta sama
       faktura stałaby raz wyżej, raz niżej, zależnie od wpisanego tekstu. */
    val szukaneN = szukane.trim().lowercase()
    val dostawy = uporzadkujDokumenty(
        if (szukaneN.isEmpty()) r.documents
        else r.documents.filter {
            it.nrPelny.lowercase().contains(szukaneN) || it.dostawca.lowercase().contains(szukaneN)
        }
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "FAKTURY ZAKUPU · OSTATNIE ${r.dniWstecz} DNI",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        WertisTextField(
            value = szukane,
            onValueChange = { szukane = it },
            placeholder = "Szukaj faktury: numer albo dostawca…",
            leadingIcon = WIcons.Search,
        )
        if (dostawy.isEmpty()) {
            Text(
                if (szukaneN.isNotEmpty()) "Brak faktury pasującej do „$szukane”"
                else "Brak dostaw do rozłożenia",
                color = InkMute,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            )
        }
        dostawy.forEach { d -> DocRow(graph, d) { open(d) } }
    }
}

@Composable
private fun DocRow(graph: AppGraph, d: DeliveryDocument, onClick: () -> Unit) {
    val stan = stanDokumentu(d)
    val complete = stan == StanDokumentu.UKONCZONY
    /* Komplet pozycji przy OTWARTEJ dostawie to czynność, nie ukończenie —
       bursztyn tak samo jak „w toku", bo tak samo czeka na człowieka. Zielony
       zostaje wyłącznie dla dostawy naprawdę zamkniętej. */
    val doZamkniecia = stan == StanDokumentu.DO_ZAMKNIECIA
    val wToku = stan == StanDokumentu.W_TOKU || doZamkniecia
    val total = if (d.linesTotal > 0) d.linesTotal else d.positions
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .heightIn(min = 56.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        /* Kafelek stanu — i JEDNOCZEŚNIE miejsce na logo dostawcy (0.56.0).
           Logo je zastępuje, gdy dostawca je ma, bo stan czyta się z tego
           wiersza jeszcze trzy razy: z paska postępu, z prawej kolumny
           („done/total" kontra „N poz.") i z pastylki „DO ZAMKNIĘCIA".
           Czwarte powtórzenie tej samej informacji nie było warte jedynego
           miejsca, w którym da się pokazać, KTO to przywiózł. */
        val kafelekStanu: @Composable () -> Unit = {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(
                        when {
                            complete -> Success.copy(alpha = 0.15f)
                            // bursztyn = czynność, ta sama reguła co na karcie towaru:
                            // dokument na górze listy ma mówić, DLACZEGO tam jest
                            wToku -> AmberBg
                            else -> Secondary
                        }
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (complete) WIcons.Check else WIcons.Box,
                    contentDescription = null,
                    tint = when {
                        complete -> Success
                        wToku -> AmberInk
                        else -> Ink
                    },
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        /* O logo pytamy WYŁĄCZNIE, gdy serwer powiedział, że jest. Inaczej
           lista dwudziestu dokumentów wystrzeliłaby dwadzieścia 404 przy
           każdym wejściu — dokładnie ten błąd dał w dzienniku produkcyjnym
           355 wpisów na tysiąc i przykrył nimi pięć prawdziwych odmów. */
        val khId = d.khId
        if (d.maLogo && khId != null) {
            LogoDostawcy(graph, khId, 40.dp, zamiast = kafelekStanu)
        } else {
            kafelekStanu()
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    d.nrPelny,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = if (complete) InkMute else Ink,
                )
                /* Wiersz z kompletem pozycji wygląda inaczej niż wszystkie
                   pozostałe „w toku", bo i czynność jest inna: nie ma już czego
                   skanować, trzeba wejść i dokończyć. Bez tego słowa człowiek
                   otwiera dostawę, widzi same odhaczone pozycje i wychodzi. */
                if (doZamkniecia) {
                    Text(
                        "DO ZAMKNIĘCIA",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp,
                        color = AmberInk,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(AmberBg)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
                /* Kontener rozkłada się tak samo jak faktura krajowa, ale po
                   odłożeniu adresów zostaje jeszcze przesunięcie stanu na halę.
                   To jedyne miejsce, w którym da się to powiedzieć ZANIM
                   człowiek pójdzie w alejkę. */
                if (d.wPrzyjeciach) {
                    Text(
                        "przyjęcia",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = AmberInk,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(AmberBg)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
                if (d.wBuforze) {
                    // bufor nie blokuje pracy (D1) — informacja, nie ostrzeżenie
                    Text(
                        "bufor",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = AmberInk,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(AmberBg)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Text(d.dostawca, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${d.dataWyst} · ${d.positions} poz.",
                fontSize = 11.sp,
                color = InkMute,
            )
            if (d.linesTotal > 0) {
                ProgressBar(d.linesDone, d.linesTotal, complete)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                if (d.linesTotal > 0) "${d.linesDone}/$total" else "$total poz.",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 15.sp,
                color = if (complete) Success else Ink,
            )
        }
    }
}

@Composable
private fun ProgressBar(done: Int, total: Int, complete: Boolean) {
    val frac = if (total > 0) done.toFloat() / total else 0f
    Box(
        Modifier
            .padding(top = 5.dp)
            .fillMaxWidth()
            .height(5.dp)
            .clip(RoundedCornerShape(50))
            .background(CardBorder),
    ) {
        Box(
            Modifier
                .fillMaxWidth(frac)
                .height(5.dp)
                .clip(RoundedCornerShape(50))
                .background(if (complete) Success else Amber),
        )
    }
}
