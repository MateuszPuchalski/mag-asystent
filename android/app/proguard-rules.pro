# Retrofit / OkHttp
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*
-dontwarn okhttp3.**
-dontwarn okio.**
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

# Honeywell DataCollection (opcjonalny AAR, ładowany refleksją)
-dontwarn com.honeywell.aidc.**
-keep class com.honeywell.aidc.** { *; }
