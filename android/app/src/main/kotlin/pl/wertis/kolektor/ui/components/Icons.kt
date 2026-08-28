package pl.wertis.kolektor.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/* ── Zestaw ikon WERTIS ──────────────────────────────────────────────────────
   Lekki, spójny zestaw (obrys 2px, 24dp) budowany jako ImageVector — bez
   ciężkiej zależności material-icons-extended. Ścieżki 1:1 z makietą podglądu.
   Rysować przez Icon(WIcons.X, tint = …) — tint nadpisuje kolor obrysu.       */

/** Pełne koło w DSL ścieżki (dwa łuki 180°). */
private fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
    moveTo(cx + r, cy)
    arcToRelative(r, r, 0f, false, true, -2 * r, 0f)
    arcToRelative(r, r, 0f, false, true, 2 * r, 0f)
    close()
}

private fun strokeIcon(name: String, width: Float = 2f, build: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).path(
        stroke = SolidColor(Color.Black), // kolor i tak nadpisze tint z Icon(...)
        strokeLineWidth = width,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
        pathBuilder = build,
    ).build()

object WIcons {

    val Back: ImageVector = strokeIcon("back", 2.2f) {
        moveTo(15f, 18f); lineTo(9f, 12f); lineTo(15f, 6f)
    }

    /**
     * Strzałka zwiniętej sekcji (obracana w miejscu wywołania).
     *
     * Własna ikona, a nie glify `▸`/`▾`: ich obecność zależy od pokrycia fontu
     * w ROM-ie kolektora Zebry albo Honeywella, a cały ten zestaw istnieje po
     * to, żeby nie zależeć od cudzych zasobów. Obracany `Back` byłby tańszy
     * o trzy wiersze, ale w miejscu wywołania czytałby się jako „wstecz".
     */
    val Chevron: ImageVector = strokeIcon("chevron", 2.2f) {
        moveTo(6f, 9f); lineTo(12f, 15f); lineTo(18f, 9f)
    }

    val Search: ImageVector = strokeIcon("search") {
        circle(11f, 11f, 7f)
        moveTo(21f, 21f); lineTo(16.7f, 16.7f)
    }

    val Pin: ImageVector = strokeIcon("pin") {
        moveTo(12f, 21f)
        reflectiveCurveTo(19f, 15.5f, 19f, 10f)
        arcTo(7f, 7f, 0f, false, false, 5f, 10f)
        curveToRelative(0f, 5.5f, 7f, 11f, 7f, 11f)
        close()
        circle(12f, 10f, 2.6f)
    }

    val Scan: ImageVector = strokeIcon("scan") {
        // narożniki ramki
        moveTo(3f, 7f); lineTo(3f, 5f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f); lineTo(7f, 3f)
        moveTo(17f, 3f); lineTo(19f, 3f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f); lineTo(21f, 7f)
        moveTo(21f, 17f); lineTo(21f, 19f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f); lineTo(17f, 21f)
        moveTo(7f, 21f); lineTo(5f, 21f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); lineTo(3f, 17f)
        // słupki kodu
        moveTo(7f, 8f); lineTo(7f, 16f)
        moveTo(10f, 8f); lineTo(10f, 16f)
        moveTo(13f, 8f); lineTo(13f, 16f)
        moveTo(16.5f, 8f); lineTo(16.5f, 16f)
    }

    val Box: ImageVector = strokeIcon("box") {
        moveTo(21f, 8f); lineTo(12f, 3f); lineTo(3f, 8f); lineTo(12f, 13f); close()
        moveTo(3f, 8f); lineTo(3f, 16f); lineTo(12f, 21f); lineTo(21f, 16f); lineTo(21f, 8f)
        moveTo(12f, 13f); lineTo(12f, 21f)
    }


    /**
     * KARTON — pudło OTWARTE, ze strzałką w dół.
     *
     * `Box` (pudło zamknięte) noszą już DOSTAWY i ZWROTY. Trzecia zakładka
     * z tą samą ikoną zamieniłaby dolny pasek w zagadkę, a trafia się go
     * z pamięci, nie wzrokiem. Otwarte wieko mówi zresztą prawdę o trybie:
     * do tego pudła się dokłada, a nie wozi je zaklejone.
     */
    val Karton: ImageVector = strokeIcon("karton") {
        // rozchylone wieko
        moveTo(3f, 9f); lineTo(6f, 5f); lineTo(18f, 5f); lineTo(21f, 9f)
        // korpus
        moveTo(4f, 9f); lineTo(4f, 20f); lineTo(20f, 20f); lineTo(20f, 9f)
        // strzałka „do środka"
        moveTo(12f, 11f); lineTo(12f, 17f)
        moveTo(9f, 14f); lineTo(12f, 17f); lineTo(15f, 14f)
    }

    val Check: ImageVector = strokeIcon("check", 2.4f) {
        moveTo(20f, 6f); lineTo(9f, 17f); lineTo(4f, 12f)
    }

    val Alert: ImageVector = strokeIcon("alert") {
        moveTo(12f, 3f); lineTo(21f, 19f); lineTo(3f, 19f); close()
        moveTo(12f, 8f); lineTo(12f, 13f)
        moveTo(12f, 16.5f); lineTo(12f, 17f)
    }

    val Clock: ImageVector = strokeIcon("clock") {
        circle(12f, 12f, 8.5f)
        moveTo(12f, 7.5f); lineTo(12f, 12f); lineTo(15f, 14f)
    }

    val Close: ImageVector = strokeIcon("close", 2.2f) {
        moveTo(6f, 6f); lineTo(18f, 18f)
        moveTo(18f, 6f); lineTo(6f, 18f)
    }

    /** Zdjęcie dowodowe do zgłoszenia wyjątku. */
    val Camera: ImageVector = strokeIcon("camera") {
        moveTo(3f, 8f); lineTo(7f, 8f); lineTo(9f, 5.5f); lineTo(15f, 5.5f); lineTo(17f, 8f)
        lineTo(21f, 8f); lineTo(21f, 19f); lineTo(3f, 19f); close()
        circle(12f, 13f, 3.6f)
    }
}
