package pl.wertis.kolektor.scan

import android.app.Activity
import android.content.Context
import android.util.Log
import java.lang.reflect.Proxy
import pl.wertis.kolektor.core.scan.classify

/* ── Honeywell DataCollection SDK — w całości przez refleksję ───────────────
   AAR (com.honeywell.aidc.*) jest własnościowy i opcjonalny: pobiera się go
   z portalu Honeywell do app/libs/ (android/README.md). Refleksja + Proxy
   pozwalają zbudować i uruchomić aplikację bez AAR-a; na urządzeniu
   Honeywell z AAR-em skany płyną z natywnego SDK zamiast wedge.              */

class HoneywellSource private constructor(
    private val context: Context,
    private val aidcManagerCls: Class<*>,
) : ScannerSource {

    private var manager: Any? = null
    private var reader: Any? = null

    override fun start(activity: Activity) {
        if (manager != null) {
            claimReader()
            return
        }
        try {
            val callbackCls = Class.forName("com.honeywell.aidc.AidcManager\$CreatedCallback")
            val callback = Proxy.newProxyInstance(
                callbackCls.classLoader,
                arrayOf(callbackCls),
            ) { _, method, args ->
                if (method.name == "onCreated") {
                    manager = args!![0]
                    createReader()
                }
                null
            }
            aidcManagerCls
                .getMethod("create", Context::class.java, callbackCls)
                .invoke(null, context.applicationContext, callback)
        } catch (e: Exception) {
            Log.w(TAG, "Nie udało się zainicjować Honeywell AidcManager", e)
        }
    }

    private fun createReader() {
        try {
            val m = manager ?: return
            reader = m.javaClass.getMethod("createBarcodeReader").invoke(m)
            val listenerCls = Class.forName("com.honeywell.aidc.BarcodeReader\$BarcodeListener")
            val listener = Proxy.newProxyInstance(
                listenerCls.classLoader,
                arrayOf(listenerCls),
            ) { _, method, args ->
                if (method.name == "onBarcodeEvent" && args != null) {
                    val event = args[0]
                    val data = event.javaClass.getMethod("getBarcodeData").invoke(event) as? String
                    if (!data.isNullOrBlank()) ScannerBus.dispatch(classify(data))
                }
                null
            }
            reader!!.javaClass
                .getMethod("addBarcodeListener", listenerCls)
                .invoke(reader, listener)
            claimReader()
        } catch (e: Exception) {
            Log.w(TAG, "Nie udało się utworzyć Honeywell BarcodeReader", e)
        }
    }

    private fun claimReader() {
        try {
            reader?.let { it.javaClass.getMethod("claim").invoke(it) }
        } catch (e: Exception) {
            Log.w(TAG, "BarcodeReader.claim() nie powiodło się", e)
        }
    }

    override fun stop(activity: Activity) {
        try {
            reader?.let { it.javaClass.getMethod("release").invoke(it) }
        } catch (e: Exception) {
            Log.w(TAG, "BarcodeReader.release() nie powiodło się", e)
        }
    }

    companion object {
        private const val TAG = "HoneywellSource"

        /** null, gdy AAR-a nie ma w buildzie — aplikacja działa na wedge. */
        fun createIfAvailable(context: Context): HoneywellSource? = try {
            HoneywellSource(context, Class.forName("com.honeywell.aidc.AidcManager"))
        } catch (_: ClassNotFoundException) {
            Log.i(TAG, "Brak Honeywell DataCollection AAR — skaner przez keyboard wedge")
            null
        }
    }
}
