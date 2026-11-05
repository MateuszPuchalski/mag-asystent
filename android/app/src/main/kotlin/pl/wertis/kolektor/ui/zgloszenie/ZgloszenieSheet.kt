package pl.wertis.kolektor.ui.zgloszenie

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.zgloszenie.RodzajZgloszenia
import pl.wertis.kolektor.core.zgloszenie.ZGLOSZENIE_MAX_OPIS
import pl.wertis.kolektor.core.zgloszenie.ZGLOSZENIE_MAX_ZDJEC
import pl.wertis.kolektor.core.zgloszenie.blokadaZgloszenia
import pl.wertis.kolektor.core.zgloszenie.dopiszKod
import pl.wertis.kolektor.core.zgloszenie.szkicNiePusty
import pl.wertis.kolektor.core.zgloszenie.zakodujZdjecieZgloszenia
import pl.wertis.kolektor.core.zgloszenie.zdanieBleduZgloszenia
import pl.wertis.kolektor.core.zgloszenie.zgloszenieKolektora
import pl.wertis.kolektor.device.PhotoCapture
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.components.MinTap
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Muted
import pl.wertis.kolektor.ui.theme.Paper
import java.io.File

/* ── Zgłoś uwagę: pomysł, przeszkoda albo błąd z dowolnego ekranu ────────────
   Kontrakt i decyzje właściciela stoją w `docs/zgloszenia-pracownikow.md`.
   Reguły (blokada, ciało, limit zdjęcia) mieszkają w `core/zgloszenie`.

   TRZY DECYZJE I NIC WIĘCEJ: rodzaj, zdanie, ewentualnie zdjęcie. Ekran,
   wersję i urządzenie dokłada maszyna, bo zna je lepiej niż człowiek.

   ZRZUTU EKRANU NIE MA, decyzją właściciela. Na zrzucie stałyby dane
   kupujących, a zgłoszenie ich nie potrzebuje. Zdjęcie robi się aparatem.

   SZKIC NIE GINIE PRZYPADKIEM. Z wpisaną treścią arkusz zamyka tylko WYŚLIJ
   albo ANULUJ. Ruch palcem w dół i dotknięcie obok cofają arkusz na miejsce,
   tak jak przy pomiarze wagi. Błąd wysyłki też niczego nie kasuje.

   BEZ BUFORA OFFLINE. Cztery zdjęcia to megabajty, a bufor plikowy niesie
   meldunki. Przy braku sieci arkusz mówi to wprost i czeka na zasięg.     */

/** Kadr gotowy do wysyłki i jego miniatura do podglądu. */
private class ZdjecieZgloszenia(val base64: String, val miniatura: ImageBitmap?)

/** Wysokość miniatury. Stała, żeby kadr pionowy nie przesuwał przycisków. */
private const val MINIATURA_DP = 72

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZgloszenieSheet(
    graph: AppGraph,
    /** Nazwa ekranu z chwili otwarcia, bo uwaga dotyczy tego, co było pod spodem. */
    ekran: String,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var rodzaj by remember { mutableStateOf<RodzajZgloszenia?>(null) }
    var opis by remember { mutableStateOf("") }
    var zdjecia by remember { mutableStateOf<List<ZdjecieZgloszenia>>(emptyList()) }
    var wysylka by remember { mutableStateOf(false) }
    var przetwarzanie by remember { mutableStateOf(false) }
    var blad by remember { mutableStateOf<String?>(null) }

    val stanArkusza = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { cel ->
            val wolno = cel != SheetValue.Hidden ||
                (!wysylka && !szkicNiePusty(rodzaj, opis, zdjecia.size))
            if (!wolno) {
                graph.feedback.beep(false)
                blad = "Wyślij zgłoszenie albo dotknij „Anuluj”."
            }
            wolno
        },
    )

    /* Skan dopisuje kod do opisu. Bez tego skan przeszedłby pod arkusz
       i przełączył ekran, którego zgłoszenie dotyczy. Szczegół w `dopiszKod`. */
    ScanHandlerEffect { scan ->
        if (!wysylka) {
            opis = dopiszKod(opis, scan.code).take(ZGLOSZENIE_MAX_OPIS)
            graph.feedback.beep(true)
        }
        true
    }

    /* Pole wielowierszowe nie jest `WertisTextField`, więc fokus wedge'a
       zgłaszamy tu sami. Licznik w `WedgeKeySource` jest wspólny: pole
       zamknięte z fokusem zostawiłoby kolektor bez skanera. Stąd zwrot
       fokusu przy zamknięciu arkusza. */
    val fokusPola = remember { booleanArrayOf(false) }
    DisposableEffect(Unit) {
        onDispose {
            if (fokusPola[0]) {
                fokusPola[0] = false
                WedgeKeySource.ustawFokus(false)
            }
        }
    }

    /* Plik roboczy ginie zaraz po zakodowaniu. Zdjęcie żyje w pamięci
       arkusza, a po wysyłce na serwerze, nie w `cacheDir` kolektora. */
    var kadr by remember { mutableStateOf<File?>(null) }
    DisposableEffect(Unit) {
        onDispose { PhotoCapture.discard(kadr) }
    }
    val aparat = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val plik = kadr
        kadr = null
        if (!ok || plik == null) {
            PhotoCapture.discard(plik)
            return@rememberLauncherForActivityResult
        }
        przetwarzanie = true
        scope.launch {
            val gotowe = withContext(Dispatchers.IO) {
                try {
                    przygotujZdjecie(plik)
                } finally {
                    PhotoCapture.discard(plik)
                }
            }
            przetwarzanie = false
            if (gotowe == null) {
                blad = "Nie udało się odczytać zdjęcia. Zrób je jeszcze raz."
                graph.feedback.beep(false)
            } else {
                zdjecia = (zdjecia + gotowe).take(ZGLOSZENIE_MAX_ZDJEC)
                blad = null
                graph.feedback.beep(true)
            }
        }
    }

    fun zrobZdjecie() {
        if (zdjecia.size >= ZGLOSZENIE_MAX_ZDJEC || przetwarzanie || wysylka) return
        runCatching {
            val (plik, uri) = PhotoCapture.newTarget(context, "zgloszenie")
            kadr = plik
            aparat.launch(uri)
        }.onFailure {
            kadr = null
            blad = "Brak aparatu na tym urządzeniu."
            graph.feedback.beep(false)
        }
    }

    val blokada = blokadaZgloszenia(rodzaj, opis, zdjecia.size)

    fun wyslij() {
        val r = rodzaj ?: return
        if (blokada != null || wysylka || przetwarzanie) return
        wysylka = true
        blad = null
        scope.launch {
            try {
                val cialo = zgloszenieKolektora(
                    rodzaj = r,
                    opis = opis,
                    ekran = ekran,
                    wersja = BuildConfig.VERSION_NAME,
                    zdjecia = zdjecia.map { it.base64 },
                )
                apiCall { graph.api.zglosUwage(cialo) }
                graph.feedback.zapis()
                // toast rysuje się pod arkuszem, więc widać go dopiero po zamknięciu
                graph.effects.toast("Zgłoszenie wysłane. Dziękujemy!")
                wysylka = false
                onClose()
            } catch (e: ApiError) {
                blad = zdanieBleduZgloszenia(e.status, e.message)
                wysylka = false
                graph.feedback.beep(false)
            } catch (e: Exception) {
                blad = "Brak połączenia z serwerem. Tekst i zdjęcia czekają, wyślij przy zasięgu."
                wysylka = false
                graph.feedback.beep(false)
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = stanArkusza,
        containerColor = Paper,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(WIcons.Uwaga, null, tint = AmberInk, modifier = Modifier.size(22.dp))
                Text(
                    "Zgłoś uwagę",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                    color = Ink,
                )
            }
            Text(
                "Trafi do właściciela. Ekran i wersję aplikacji dopiszemy sami.",
                fontSize = 12.5.sp,
                color = InkSoft,
            )

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RodzajZgloszenia.entries.forEach { r ->
                    KafelRodzaju(r, wybrany = r == rodzaj, modifier = Modifier.weight(1f)) {
                        if (!wysylka) rodzaj = r
                    }
                }
            }

            OutlinedTextField(
                value = opis,
                onValueChange = { opis = it.take(ZGLOSZENIE_MAX_OPIS) },
                enabled = !wysylka,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 120.dp)
                    .onFocusChanged {
                        if (it.isFocused != fokusPola[0]) {
                            fokusPola[0] = it.isFocused
                            WedgeKeySource.ustawFokus(it.isFocused)
                        }
                    },
                placeholder = {
                    Text(rodzaj?.podpowiedz ?: "Co zauważyłeś?", color = InkMute)
                },
                minLines = 3,
                maxLines = 8,
                shape = RoundedCornerShape(12.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Amber,
                    unfocusedBorderColor = BorderCol,
                    focusedContainerColor = CardWhite,
                    unfocusedContainerColor = CardWhite,
                ),
            )
            Text("Skan kodu dopisze go do opisu.", fontSize = 11.5.sp, color = InkMute)

            OutlineButton(
                text = when {
                    przetwarzanie -> "PRZYGOTOWUJĘ ZDJĘCIE…"
                    zdjecia.size >= ZGLOSZENIE_MAX_ZDJEC -> "ZDJĘCIA ${zdjecia.size}/$ZGLOSZENIE_MAX_ZDJEC"
                    else -> "ZRÓB ZDJĘCIE  ${zdjecia.size}/$ZGLOSZENIE_MAX_ZDJEC"
                },
                leadingIcon = WIcons.Camera,
                tall = true,
                enabled = zdjecia.size < ZGLOSZENIE_MAX_ZDJEC && !przetwarzanie && !wysylka,
                modifier = Modifier.fillMaxWidth(),
                onClick = { zrobZdjecie() },
            )

            if (zdjecia.isNotEmpty()) {
                /* Cztery stałe sloty, także pustych, żeby USUŃ nie przeskakiwał
                   w bok po każdym zdjęciu. Cel trafia się z pamięci ręki. */
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (i in 0 until ZGLOSZENIE_MAX_ZDJEC) {
                        val z = zdjecia.getOrNull(i)
                        if (z == null) {
                            Box(Modifier.weight(1f))
                        } else {
                            Miniatura(z, enabled = !wysylka, modifier = Modifier.weight(1f)) {
                                zdjecia = zdjecia.filterIndexed { j, _ -> j != i }
                            }
                        }
                    }
                }
            }

            val zdanie = blad ?: blokada.takeIf { rodzaj != null || opis.isNotBlank() }
            zdanie?.let {
                Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Destructive)
            }

            PrimaryButton(
                text = if (wysylka) "WYSYŁAM…" else "WYŚLIJ",
                enabled = blokada == null && !wysylka && !przetwarzanie,
                tall = true,
                modifier = Modifier.fillMaxWidth(),
                onClick = { wyslij() },
            )
            OutlineButton(
                "ANULUJ",
                enabled = !wysylka,
                modifier = Modifier.fillMaxWidth(),
                onClick = onClose,
            )
        }
    }
}

/**
 * Kodowanie kadru do limitu serwera i miniatura z gotowego JPEG-a.
 * Woła się poza wątkiem UI, bo dekodowanie 13 Mpx trwa setki milisekund.
 */
private fun przygotujZdjecie(plik: File): ZdjecieZgloszenia? {
    val b64 = zakodujZdjecieZgloszenia { p -> PhotoCapture.encode(plik, p.bok, p.jakosc) } ?: return null
    // miniatura z pliku, który pojedzie, więc człowiek widzi dokładnie wysyłany kadr
    val miniatura = runCatching {
        val bajty = Base64.decode(b64, Base64.NO_WRAP)
        val opcje = BitmapFactory.Options().apply { inSampleSize = 4 }
        BitmapFactory.decodeByteArray(bajty, 0, bajty.size, opcje)?.asImageBitmap()
    }.getOrNull()
    return ZdjecieZgloszenia(b64, miniatura)
}

/** Kafel rodzaju: duży cel na rękawicę, zaznaczenie kolorem i obrysem naraz. */
@Composable
private fun KafelRodzaju(
    rodzaj: RodzajZgloszenia,
    wybrany: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val ksztalt = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier
            .clip(ksztalt)
            .background(if (wybrany) AmberBg else CardWhite)
            .border(if (wybrany) 2.5.dp else 1.dp, if (wybrany) Amber else CardBorder, ksztalt)
            // wyższy niż MinTap, bo to pierwsza i jedyna decyzja arkusza
            .heightIn(min = 64.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            rodzaj.etykieta,
            fontFamily = BarlowCond,
            fontWeight = if (wybrany) FontWeight.ExtraBold else FontWeight.Bold,
            fontSize = 15.sp,
            color = if (wybrany) AmberInk else Ink,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
    }
}

/** Miniatura kadru z przyciskiem USUŃ pod spodem, nie na obrazie. */
@Composable
private fun Miniatura(
    zdjecie: ZdjecieZgloszenia,
    enabled: Boolean,
    modifier: Modifier,
    onUsun: () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(MINIATURA_DP.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Muted),
        ) {
            zdjecie.miniatura?.let {
                Image(
                    bitmap = it,
                    contentDescription = "Zdjęcie do zgłoszenia",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        /* Krzyżyk na rogu miniatury miałby kilkanaście dp. Pełny przycisk
           pod spodem ma MinTap i nie zasłania kadru. */
        OutlineButton(
            "USUŃ",
            danger = true,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = MinTap),
            onClick = onUsun,
        )
    }
}
