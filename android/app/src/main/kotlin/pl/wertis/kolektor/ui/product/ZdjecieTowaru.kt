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
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.product.StanSlotu
import pl.wertis.kolektor.core.product.pokazacDodanie
import pl.wertis.kolektor.data.dekodujDo
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.Ink
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

/* Zdekodowane miniatury, klucz "twId:px". Wiersze list w Column+forEach mają
   POZYCYJNY `remember` — przetasowanie wierszy (nowy wynik wyszukiwania, zmiana
   kolejności na półce) przypisuje stan do złych towarów i wymusza ponowne
   dekodowanie. Ta mapa robi z tego tanią wpadkę: trafienie to zero sieci
   i zero BitmapFactory. 32 × ~120 px w ARGB_8888 ≈ 1,8 MB. */
private val zdekodowane = android.util.LruCache<String, android.graphics.Bitmap>(32)

private suspend fun miniaturaZCache(bajty: ByteArray, twId: Long, px: Int): android.graphics.Bitmap? {
    val klucz = "$twId:$px"
    zdekodowane.get(klucz)?.let { return it }
    return dekodujDo(bajty, px)?.also { zdekodowane.put(klucz, it) }
}

/**
 * Wyrzucenie zdekodowanych miniatur JEDNEGO towaru (0.88.0).
 *
 * Po dodaniu zdjęcia z kolektora `ZdjeciaRepository` zapomina plik i wpis, ale
 * TA mapa żyje w pamięci procesu i nie wie o niczym. Bez tego wywołania karta
 * rysowałaby starą miniaturę — a po dodaniu pierwszego zdjęcia „stara" znaczy
 * ikonę pudełka — do końca życia aplikacji.
 *
 * Kasujemy po prefiksie klucza, bo ten sam towar bywa zdekodowany w kilku
 * rozmiarach: 220 px na karcie i po jednym na każdy bok miniatury w listach.
 */
fun zapomnijMiniature(twId: Long) {
    val prefiks = "$twId:"
    for (klucz in zdekodowane.snapshot().keys) {
        if (klucz.startsWith(prefiks)) zdekodowane.remove(klucz)
    }
}

/**
 * @param odswiez licznik podbijany po dodaniu zdjęcia — wymusza ponowne
 *   pobranie bez wychodzenia z karty. Bez niego `LaunchedEffect(twId)` nie
 *   wystrzeliłby drugi raz i slot zostałby pusty aż do powrotu na kartę.
 * @param onDodaj dotknięcie PUSTEGO slotu. `null` = ta instalacja nie przyjmuje
 *   zdjęć z kolektora i slot zachowuje się jak przed 0.88.0.
 */
@Composable
fun ZdjecieKartoteki(
    graph: AppGraph,
    twId: Long,
    odswiez: Int = 0,
    onDodaj: (() -> Unit)? = null,
) {
    var bajty by remember(twId) { mutableStateOf<ByteArray?>(null) }
    var miniatura by remember(twId) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var pelnyEkran by remember(twId) { mutableStateOf(false) }
    /* Trzeci stan, dopisany w 0.88.0. Do tej pory `miniatura == null` znaczyło
       naraz „jeszcze nie wiem" i „zdjęcia nie ma" — dla samego rysowania szarego
       kwadratu to bez różnicy, ale przycisk „+" musi się pojawić DOPIERO po
       potwierdzonym braku. Inaczej mignąłby przy każdym wejściu na kartę, także
       na kartotece, która zdjęcie ma, i przesuwał cel dotyku pod kciukiem.
       Reguła i jej test siedzą w `:core` (`DodanieZdjecia.kt`). */
    var stan by remember(twId) { mutableStateOf(StanSlotu.LADOWANIE) }

    /* Pobranie RAZ na wejście na kartę, nie w cyklu odświeżania karty (2 s).
       Repozytorium i tak nie ruszy sieci, gdy plik jest świeży — ale nie ma
       powodu wołać go kilkanaście razy na minutę. */
    LaunchedEffect(twId, odswiez) {
        stan = StanSlotu.LADOWANIE
        val dane = graph.zdjeciaRepo.zdjecie(twId)
        bajty = dane
        miniatura = dane?.let { miniaturaZCache(it, twId, MINIATURA_PX) }
        stan = if (miniatura != null) StanSlotu.ZDJECIE else StanSlotu.BRAK
    }

    val dodanie = if (pokazacDodanie(stan, onDodaj != null)) onDodaj else null

    Box(
        modifier = Modifier
            .size(BOK_DP.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(CardBorder.copy(alpha = 0.25f))
            .then(
                when {
                    miniatura != null -> Modifier.clickable { pelnyEkran = true }
                    dodanie != null -> Modifier.clickable(onClick = dodanie)
                    else -> Modifier
                }
            ),
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
            /* „+" DOKLEJONY do slotu, nie zamiast ikony i nie obok niego.
               Slot ma stały rozmiar we wszystkich stanach — to reguła z nagłówka
               tego pliku — a osobny przycisk pod nagłówkiem zabierałby wiersz
               ekranu na czynność wykonywaną raz na kartotekę. */
            if (dodanie != null) {
                Text(
                    "+",
                    color = Ink,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(end = 6.dp, bottom = 2.dp),
                )
            }
        }
    }

    if (pelnyEkran) {
        PelnyEkranZdjecia(bajty) { pelnyEkran = false }
    }
}

/* ── Miniatura w wierszach list i nagłówkach arkuszy ────────────────────────
   ODWROTNIE niż na karcie: ŻADNEGO zarezerwowanego slotu. Dopóki bajtów nie
   ma — nie emituje nic; wiersz wygląda dokładnie jak przed erą zdjęć.
   Karta rezerwuje slot, bo jest JEDNA i stała; wiersz listy jest jednym
   z dwudziestu, a instalacja bez skonfigurowanego źródła zdjęć (ZDJECIA_ZRODLO
   puste) dostawałaby dwadzieścia szarych kwadratów na każdym ekranie —
   szum bez informacji. Cena odwrotnej reguły: element wskakuje po chwili
   przy PIERWSZYM pobraniu; potem odpowiada cache i przesunięcia nie ma. */

/**
 * @param powieksz tap otwiera pełny ekran — true WYŁĄCZNIE w nagłówkach bez
 *   własnego gestu (ScanLoc, przesunięcie, problem). Wiersze list mają swój
 *   tap (nawigacja/wybór) i zagnieżdżony clickable kradłby go w rękawicach.
 * @param zamiast rysowane, gdy kartoteka zdjęcia NIE MA. Powstało dla ikony
 *   pudełka w pasku rozkładania: stała obok miniatury i przy towarze ze
 *   zdjęciem była powtórzeniem — rysunek pudełka mówi „towar", a zdjęcie mówi
 *   KTÓRY. Domyślnie `null`, czyli reguła bez rezerwowanego slotu zostaje
 *   nietknięta wszędzie, gdzie nikt zastępstwa nie podał.
 */
@Composable
fun MiniaturaTowaru(
    graph: AppGraph,
    twId: Long,
    bok: Dp,
    powieksz: Boolean = false,
    modifier: Modifier = Modifier,
    zamiast: (@Composable () -> Unit)? = null,
) {
    var bajty by remember(twId) { mutableStateOf<ByteArray?>(null) }
    var miniatura by remember(twId) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var pelnyEkran by remember(twId) { mutableStateOf(false) }

    // stały mnożnik zamiast LocalDensity — klucz cache'a dekodowania nie może
    // zależeć od ekranu, na którym akurat rysujemy
    val px = bok.value.toInt() * 3

    LaunchedEffect(twId) {
        val dane = graph.zdjeciaRepo.zdjecie(twId)
        bajty = dane
        miniatura = dane?.let { miniaturaZCache(it, twId, px) }
    }

    val bmp = miniatura
    if (bmp == null) {
        /* Zastępstwo rysujemy TAKŻE w trakcie pobierania, nie dopiero po
           potwierdzeniu braku. Ikona pudełka jest tym, co w tym miejscu stało
           od zawsze — mignięcie pustki przed jej pojawieniem się byłoby
           gorsze niż podmiana rysunku na zdjęcie. */
        zamiast?.invoke()
        return
    }
    Image(
        bitmap = bmp.asImageBitmap(),
        contentDescription = "Zdjęcie towaru",
        contentScale = ContentScale.Crop,
        modifier = modifier
            .size(bok)
            .clip(RoundedCornerShape(8.dp))
            .then(if (powieksz) Modifier.clickable { pelnyEkran = true } else Modifier),
    )

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
