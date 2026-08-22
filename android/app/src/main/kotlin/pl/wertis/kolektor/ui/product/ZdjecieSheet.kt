package pl.wertis.kolektor.ui.product

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.ZdjecieWstepneBody
import pl.wertis.kolektor.core.net.ZdjecieZapisBody
import pl.wertis.kolektor.core.product.KrokZdjecia
import pl.wertis.kolektor.core.product.napisZapisu
import pl.wertis.kolektor.core.product.pokazacZostawTlo
import pl.wertis.kolektor.device.KARTOTEKA_JPEG_QUALITY
import pl.wertis.kolektor.device.KARTOTEKA_MAX_EDGE
import pl.wertis.kolektor.device.PhotoCapture
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import java.io.File

/* ── Dodanie zdjęcia kartoteki (0.88.0) ──────────────────────────────────────
   POWSTAŁO Z SYTUACJI PRZY REGALE, tak jak nadanie kodu kreskowego: magazynier
   trzyma towar w ręku, na karcie widzi pusty slot i nie ma czym tego naprawić.

   DWA KROKI, BO WYCINANIE TŁA BYWA NIEUDANE. Zdjęcie jedzie na serwer, wraca
   podgląd, i dopiero drugie dotknięcie cokolwiek zapisuje. Kadr regału
   z pięcioma kartonami wygląda dla modelu tak samo jak kadr noża; bez tego
   kroku wchodziłby do kartoteki w Subiekcie, a odkręcić mogłoby to wyłącznie
   biuro.

   TA OPERACJA NIE DZIAŁA OFFLINE i arkusz mówi to wprost. Bufor plikowy niesie
   meldunki, nie obrazy, a wycięcie tła i tak wymaga serwera — obietnica „zapiszę
   przy zasięgu" byłaby tu obietnicą bez pokrycia. Ta sama reguła co przy
   nadaniu kodu kreskowego.

   Reguły, które prowadzą w różne strony (kiedy „ZOSTAW TŁO" ma sens, co pisze
   przycisk zapisu), mieszkają w `:core` razem z testem — `DodanieZdjecia.kt`. */

/** Wysokość podglądu. Stała, żeby zdjęcie pionowe nie przesuwało przycisków. */
private const val PODGLAD_DP = 220

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZdjecieSheet(
    graph: AppGraph,
    twId: Long,
    sym: String,
    nazwa: String,
    onClose: () -> Unit,
    onZapisano: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var krok by remember(twId) { mutableStateOf(KrokZdjecia.WYBOR) }
    var podgladId by remember(twId) { mutableStateOf("") }
    var tloUsuniete by remember(twId) { mutableStateOf(false) }
    var powod by remember(twId) { mutableStateOf<String?>(null) }
    var podglad by remember(twId) { mutableStateOf<ImageBitmap?>(null) }
    var zrodlo by remember(twId) { mutableStateOf("aparat") }
    var blad by remember(twId) { mutableStateOf<String?>(null) }

    /* Porzucony podgląd kasujemy OD RAZU, nie po kwadransie: prób bywa kilka
       pod rząd, a każda zostawia w bazie wiersz z dwoma obrazami.

       WYŁĄCZNIE z otwartego arkusza. `rememberCoroutineScope` ginie razem
       z kompozycją, więc wywołanie z `onDispose` nie miałoby jak dojść — i to
       jest w porządku: podgląd porzucony przez zamknięcie arkusza kasuje się
       sam po ZDJECIA_PODGLAD_MIN. Udawane sprzątanie byłoby gorsze od żadnego,
       bo nikt nie sprawdzałby, czy działa. */
    fun porzuc(id: String) {
        if (id.isEmpty()) return
        scope.launch { runCatching { graph.api.porzucPodgladZdjecia(twId, id) } }
    }

    fun wyslij(base64: String?, skad: String) {
        if (base64 == null) {
            blad = "Nie udało się odczytać zdjęcia. Spróbuj jeszcze raz."
            graph.feedback.beep(false)
            return
        }
        zrodlo = skad
        blad = null
        krok = KrokZdjecia.WYSYLANIE
        scope.launch {
            try {
                val odp = apiCall { graph.api.zdjecieWstepne(twId, ZdjecieWstepneBody(base64)) }
                podgladId = odp.podgladId
                tloUsuniete = odp.tloUsuniete
                powod = odp.powod
                podglad = withContext(Dispatchers.IO) {
                    runCatching {
                        val b = Base64.decode(odp.png, Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
                    }.getOrNull()
                }
                krok = KrokZdjecia.PODGLAD
                graph.feedback.beep(true)
            } catch (e: ApiError) {
                blad = e.message
                krok = KrokZdjecia.WYBOR
                graph.feedback.beep(false)
            } catch (e: Exception) {
                // brak sieci — ta operacja świadomie NIE idzie do bufora offline
                blad = "Brak połączenia z serwerem — zdjęcie dodaje się przy zasięgu"
                krok = KrokZdjecia.WYBOR
                graph.feedback.beep(false)
            }
        }
    }

    var kadr by remember(twId) { mutableStateOf<File?>(null) }
    val aparat = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = kadr
        kadr = null
        if (!ok) {
            PhotoCapture.discard(f)
            return@rememberLauncherForActivityResult
        }
        val base64 = f?.let {
            PhotoCapture.encode(it, KARTOTEKA_MAX_EDGE, KARTOTEKA_JPEG_QUALITY)
        }
        // plik roboczy ginie zaraz po zakodowaniu — zdjęcie żyje na serwerze
        PhotoCapture.discard(f)
        wyslij(base64, "aparat")
    }

    /* Wybierak systemowy, NIE `READ_MEDIA_IMAGES`. Uprawnienie do całej galerii
       byłoby tu żądaniem nieproporcjonalnym: aplikacja potrzebuje jednego pliku
       wskazanego ręką, a nie dostępu do zdjęć z telefonu. */
    val galeria = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val base64 = withContext(Dispatchers.IO) {
                PhotoCapture.encodeUri(context, uri, KARTOTEKA_MAX_EDGE, KARTOTEKA_JPEG_QUALITY)
            }
            wyslij(base64, "galeria")
        }
    }

    fun zapisz(zTlem: Boolean) {
        krok = KrokZdjecia.WYSYLANIE
        scope.launch {
            try {
                apiCall {
                    graph.api.zapiszZdjecie(twId, ZdjecieZapisBody(podgladId, zTlem, zrodlo))
                }
                podgladId = ""
                /* Cache kolektora musi ZAPOMNIEĆ ten towar, inaczej karta rysuje
                   stary „brak zdjęcia" przez dobę — tyle trzyma negatyw. */
                graph.zdjeciaRepo.zapomnij(twId)
                zapomnijMiniature(twId)
                graph.feedback.zapis()
                graph.queueRepo.refreshNow()
                krok = KrokZdjecia.ZAPISANO
                onZapisano()
            } catch (e: ApiError) {
                blad = e.message
                krok = KrokZdjecia.PODGLAD
                graph.feedback.beep(false)
            } catch (e: Exception) {
                blad = "Brak połączenia z serwerem — zdjęcie dodaje się przy zasięgu"
                krok = KrokZdjecia.PODGLAD
                graph.feedback.beep(false)
            }
        }
    }

    /* Kadr roboczy w `cacheDir` ginie razem z arkuszem. Zdjęcie żyje na
       serwerze, nie w pamięci kolektora — ta sama reguła co przy dowodach
       do reklamacji (`PhotoCapture`). */
    DisposableEffect(twId) {
        onDispose { PhotoCapture.discard(kadr) }
    }

    ModalBottomSheet(onDismissRequest = onClose, containerColor = CardWhite) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("ZDJĘCIE KARTOTEKI", fontSize = 11.sp, color = InkMute, fontWeight = FontWeight.Bold)
            Text(sym, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Ink)
            if (nazwa.isNotBlank()) Text(nazwa, fontSize = 13.sp, color = InkSoft)

            when (krok) {
                KrokZdjecia.WYBOR -> {
                    Text(
                        "Kartoteka nie ma zdjęcia. Zrób je albo wybierz z galerii — " +
                            "serwer usunie tło, a Ty obejrzysz wynik przed zapisem.",
                        fontSize = 14.sp,
                        color = InkSoft,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        PrimaryButton("APARAT", tall = true, modifier = Modifier.weight(1f)) {
                            runCatching {
                                val (file, uri) = PhotoCapture.newTarget(context, "kartoteka")
                                kadr = file
                                aparat.launch(uri)
                            }.onFailure {
                                blad = "Brak aparatu na tym urządzeniu"
                                graph.feedback.beep(false)
                            }
                        }
                        OutlineButton("GALERIA", tall = true, modifier = Modifier.weight(1f)) {
                            galeria.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                            )
                        }
                    }
                }

                KrokZdjecia.WYSYLANIE -> Text(
                    "Wysyłam i usuwam tło…",
                    fontSize = 14.sp,
                    color = InkSoft,
                )

                KrokZdjecia.PODGLAD -> {
                    /* Szachownica pod podglądem — przezroczystość musi być
                       WIDOCZNA. Na białym tle arkusza wycięte zdjęcie wygląda
                       identycznie jak zdjęcie na białym stole, więc człowiek
                       nie ma po czym poznać, czy tło zniknęło. */
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(PODGLAD_DP.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(CardBorder.copy(alpha = 0.25f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        podglad?.let {
                            Image(
                                bitmap = it,
                                contentDescription = "Podgląd zdjęcia towaru",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxWidth().height(PODGLAD_DP.dp).padding(6.dp),
                            )
                        }
                    }
                    Text(
                        if (tloUsuniete) "Tło usunięte." else "Tło zostało na zdjęciu.",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Ink,
                    )
                    powod?.let { Text(it, fontSize = 13.sp, color = InkSoft) }
                }

                KrokZdjecia.ZAPISANO -> Text("Zapisane.", fontSize = 14.sp, color = InkSoft)
            }

            blad?.let { Text(it, fontSize = 13.sp, color = Destructive) }

            if (krok == KrokZdjecia.PODGLAD) {
                PrimaryButton(
                    napisZapisu(tloUsuniete),
                    tall = true,
                    modifier = Modifier.fillMaxWidth(),
                ) { zapisz(zTlem = false) }

                if (pokazacZostawTlo(tloUsuniete)) {
                    OutlineButton(
                        "ZOSTAW TŁO",
                        tall = true,
                        modifier = Modifier.fillMaxWidth(),
                    ) { zapisz(zTlem = true) }
                }

                OutlineButton(
                    "JESZCZE RAZ",
                    tall = true,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    porzuc(podgladId)
                    podgladId = ""
                    podglad = null
                    powod = null
                    blad = null
                    krok = KrokZdjecia.WYBOR
                }
            }

            Text(
                "Anuluj",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkMute,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp)
                    // 48 dp — anulowanie arkusza nie może wymagać celowania
                    .heightIn(min = 48.dp)
                    .clickable(onClick = onClose)
                    .wrapContentHeight(),
            )
        }
    }
}
