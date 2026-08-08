package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.data.dekodujDo
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.InkMute

/* ── Zdjęcie kartoteki na karcie towaru (0.30.0) ─────────────────────────────
   SLOT MA STAŁY ROZMIAR WE WSZYSTKICH STANACH — ładowanie, zdjęcie, brak
   zdjęcia i brak zasięgu wyglądają różnie, ale zajmują tyle samo. Element,
   który wskakuje po chwili, przesuwa cele dotyku pod kciukiem; to ta sama
   reguła, dla której `history` na karcie jest trójstanowe.

   Braku zdjęcia NIE odróżniamy od braku zasięgu i to jest decyzja: dla
   człowieka przy regale ta różnica nie jest wykonalna, a o braku sieci
   kolektor mówi globalnie (OfflineBanner). Dwa komunikaty o tym samym są
   gorsze niż jeden.                                                          */

private const val BOK_DP = 76
private const val MINIATURA_PX = 220

@Composable
fun ZdjecieKartoteki(graph: AppGraph, twId: Long) {
    var bajty by remember(twId) { mutableStateOf<ByteArray?>(null) }
    var miniatura by remember(twId) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var pelnyEkran by remember(twId) { mutableStateOf(false) }

    /* Pobranie RAZ na wejście na kartę, nie w cyklu odświeżania karty (2 s).
       Repozytorium i tak nie ruszy sieci, gdy plik jest świeży — ale nie ma
       powodu wołać go kilkanaście razy na minutę. */
    LaunchedEffect(twId) {
        val dane = graph.zdjeciaRepo.zdjecie(twId)
        bajty = dane
        miniatura = dane?.let { dekodujDo(it, MINIATURA_PX) }
    }

    Box(
        modifier = Modifier
            .size(BOK_DP.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(CardBorder.copy(alpha = 0.25f))
            .then(if (miniatura != null) Modifier.clickable { pelnyEkran = true } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = miniatura
        if (bmp != null) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = "Zdjęcie towaru",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            /* Ikona zamiast spinnera: miniatura ładuje się przy każdym wejściu
               na kartę, a migotanie w rogu nagłówka byłoby ruchem, który nic
               nie znaczy. */
            Icon(WIcons.Box, contentDescription = null, tint = InkMute, modifier = Modifier.size(26.dp))
        }
    }

    if (pelnyEkran) {
        PelnyEkranZdjecia(bajty) { pelnyEkran = false }
    }
}

/**
 * Zdjęcie na pełny ekran — zamknięcie dotknięciem gdziekolwiek.
 *
 * Bitmapa pełnego rozmiaru powstaje TYLKO tutaj i jest zwalniana przy
 * zamknięciu: 1024×1024 w ARGB_8888 to 4 MB, a kolektor jest tani.
 */
@Composable
private fun PelnyEkranZdjecia(bajty: ByteArray?, onZamknij: () -> Unit) {
    var duze by remember(bajty) { mutableStateOf<android.graphics.Bitmap?>(null) }

    LaunchedEffect(bajty) {
        duze = bajty?.let { dekodujDo(it, PELNY_PX) }
    }
    DisposableEffect(Unit) {
        onDispose { duze?.recycle() }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.92f))
            .clickable(onClick = onZamknij),
        contentAlignment = Alignment.Center,
    ) {
        duze?.let {
            Image(
                bitmap = it.asImageBitmap(),
                contentDescription = "Zdjęcie towaru",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(12.dp),
            )
        }
    }
}

private const val PELNY_PX = 1024
