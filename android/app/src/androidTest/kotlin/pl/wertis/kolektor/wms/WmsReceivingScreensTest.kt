package pl.wertis.kolektor.wms

import android.content.Context
import android.graphics.Bitmap
import android.view.KeyCharacterMap
import android.view.KeyEvent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.UserDto
import pl.wertis.kolektor.core.scan.classify
import pl.wertis.kolektor.core.wms.WmsJournal
import pl.wertis.kolektor.data.WmsFileStore
import pl.wertis.kolektor.scan.ScannerBus
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.theme.WertisTheme
import pl.wertis.kolektor.ui.wms.WmsInboundScreen
import pl.wertis.kolektor.ui.wms.WmsPutawayScreen

class WmsReceivingScreensTest {
    @get:Rule val compose = createComposeRule()
    @get:Rule val testName = TestName()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val fixture = WmsScreenFixture()
    private lateinit var graph: AppGraph

    @Before fun prepare() {
        fixture.server.start()
        val context = instrumentation.targetContext
        context.getSharedPreferences("wertis_session", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("wertis_settings", Context.MODE_PRIVATE).edit().clear()
            .putString("serverUrl", fixture.server.url("/").toString()).commit()
        runBlocking { WmsFileStore(context).write(WmsJournal()) }
        compose.runOnUiThread {
            graph = AppGraph(context)
            graph.session.przyjmijZSetupu("seeded-screen-token", UserDto(userId = 1, login = "demo", name = "Magazynier DEMO"))
        }
    }

    @After fun finish() {
        screenshot("ostatni-ekran")
        if (::graph.isInitialized) graph.appScope.cancel()
        fixture.server.shutdown()
        assertEquals("Nieoczekiwane żądania WMS", emptyList<String>(), fixture.unexpected.toList())
    }

    @Test fun putawayRequiresCountAndReturnsScannerAfterIme() {
        compose.setContent { WertisTheme { Surface(Modifier.fillMaxSize()) { WmsPutawayScreen(graph) } } }
        ready { graph.wmsRepo.putaway.state.value.let { it.ready && it.queue != null } }
        compose.onNodeWithText("BUF01 · WMS-0001", substring = true).performClick()
        ready { graph.wmsRepo.putaway.state.value.let { it.ready && it.task != null } }
        assertEquals(0, fixture.writes.size)
        scan("BUF01")
        ready { graph.wmsRepo.putaway.state.value.sourceConfirmed }
        compose.onNodeWithText("2 · SKANUJ KOD CZĘŚCI").assertIsDisplayed()
        scan("WMS-0001")
        quantityVisible()
        screenshot("odkladanie-ilosc")
        scan("LOC:A1")
        compose.onNodeWithText("Potwierdź policzoną ilość przed skanem półki").assertIsDisplayed()
        assertEquals(1, fixture.writes.size)
        compose.onNodeWithText("INNE MIEJSCA (7)").performScrollTo().performClick()
        compose.onNodeWithText("A8 · kompletacja · do 20 szt.").performScrollTo().assertIsDisplayed()
        // Powrót do liczenia po obejrzeniu alternatyw ma zachować pustą, nie sugerowaną ilość.
        val field = compose.onNode(hasSetTextAction())
        field.performScrollTo().performClick().performTextInput("2")
        compose.runOnIdle { assertFalse("Aktywne pole musi zatrzymać wedge", wedge("A1")) }
        field.performImeAction()
        compose.onNodeWithText("4 · ODŁÓŻ I SKANUJ PÓŁKĘ").assertIsDisplayed()
        compose.onNodeWithText("INNE MIEJSCA (7)").assertExists()
        compose.onNodeWithText("A8 · kompletacja · do 20 szt.").assertDoesNotExist()
        screenshot("odkladanie-cel")
        compose.runOnIdle { assertTrue("Po IME skaner musi znów działać", wedge("A1")) }
        ready { graph.wmsRepo.putaway.state.value.let { it.ready && it.task?.remaining == 3 } }
        compose.onNodeWithText("1 · SKANUJ BUFOR BUF01").assertIsDisplayed()
        assertEquals(listOf("/api/wms/putaway-work/1/claim", "/api/wms/putaway-work/1/finish"), fixture.writes.map { it.first })
        val body = fixture.writes.last().second
        assertEquals("2", body.getValue("quantity").jsonPrimitive.content)
        assertEquals("A1", body.getValue("target").jsonPrimitive.content)
        assertEquals("BUF01", body.getValue("source").jsonPrimitive.content)
    }

    @Test fun receivingRequiresCountAndDoesNotReuseItForNextBatch() {
        compose.setContent { WertisTheme { Surface(Modifier.fillMaxSize()) { WmsInboundScreen(graph) } } }
        ready { graph.wmsRepo.receiving.state.value.let { it.ready && it.documents != null } }
        compose.onNodeWithText("DEMO-PZ-1", substring = true).performClick()
        ready { graph.wmsRepo.receiving.state.value.let { it.ready && it.document != null } }
        assertEquals(0, fixture.writes.size)
        scan("WMS-0001")
        ready { graph.wmsRepo.receiving.state.value.confirmedBarcode != null }
        quantityVisible()
        screenshot("przyjecie-ilosc")
        scan("LOC:BUF01")
        compose.onNodeWithText("Najpierw potwierdź policzoną ilość").assertIsDisplayed()
        assertEquals(0, fixture.writes.size)
        val field = compose.onNode(hasSetTextAction())
        field.performClick().performTextInput("2")
        field.performImeAction()
        compose.onNodeWithText("3 · ODŁÓŻ I SKANUJ BUFOR").assertIsDisplayed()
        compose.runOnIdle { assertTrue("Po liczeniu skaner musi oddać kod bufora", wedge("BUF01")) }
        ready { graph.wmsRepo.receiving.state.value.let { it.ready && it.document?.selected?.received == 2 } }
        assertEquals(1, fixture.writes.size)
        val body = fixture.writes.single().second
        assertEquals("2", body.getValue("quantity").jsonPrimitive.content)
        assertEquals("BUF01", body.getValue("bin").jsonPrimitive.content)
        assertEquals("true", body.getValue("staged").jsonPrimitive.content)
        scan("WMS-0001")
        ready { graph.wmsRepo.receiving.state.value.confirmedBarcode != null }
        quantityVisible()
        screenshot("przyjecie-nastepna-partia")
        assertEquals(1, fixture.writes.size)
    }

    private fun quantityVisible() {
        compose.waitForIdle()
        compose.onNode(hasSetTextAction()).assertIsDisplayed().assertIsNotFocused()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("POTWIERDŹ ILOŚĆ").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    }

    private fun ready(condition: () -> Boolean) {
        compose.waitUntil(timeoutMillis = 10_000, condition = condition)
        compose.waitForIdle()
    }

    private fun scan(raw: String) {
        compose.runOnIdle { ScannerBus.dispatch(classify(raw)) }
        compose.waitForIdle()
    }

    // Ten sam adapter klawiatury co MainActivity, bez udawania fizycznego modułu Zebra/Honeywell.
    private fun wedge(raw: String): Boolean {
        KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(raw.toCharArray()).forEach {
            if (it.action == KeyEvent.ACTION_DOWN) WedgeKeySource.onKeyDown(it)
        }
        return WedgeKeySource.onKeyDown(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
    }

    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "wms-screens").apply { mkdirs() }
        File(directory, "${testName.methodName}-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
