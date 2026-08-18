import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/* ── Wersja: JEDNO źródło prawdy ────────────────────────────────────────────
   Do sierpnia 2026 numer stał wpisany tutaj z komentarzem „zgodnie z wersją
   monorepo" — i właśnie tak przestał być zgodny: `0.3.0` przetrwał sześć
   zmergowanych zmian, w tym takie, które wymagały nowego uprawnienia SQL.
   Komentarz nie jest mechanizmem.

   Teraz numer pochodzi z `package.json` w korzeniu repo. Podbicie w jednym
   miejscu przestawia APK, serwer i pasek na dole ekranu naraz.              */
val wersjaMonorepo: String = run {
    val pkg = rootProject.file("../package.json").readText()
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(pkg)?.groupValues?.get(1)
        ?: error("Nie znalazłem pola \"version\" w package.json korzenia repo")
}

/* Android wymaga rosnącej liczby całkowitej, inaczej instalacja nowszego APK
   nad starszym zostanie odrzucona jako „downgrade". Wyliczamy ją z numeru
   wersji, żeby nie było DRUGIEJ rzeczy do pamiętania przy wydaniu.
   0.4.0 → 400, 1.2.3 → 10203. Zapas przy patchu i minorze: 99. */
val kodWersji: Int = run {
    val (major, minor, patch) = (wersjaMonorepo.substringBefore('-').split('.') + listOf("0", "0"))
        .take(3)
        .map { it.toIntOrNull() ?: 0 }
    major * 10_000 + minor * 100 + patch
}

/* ── Podpis wydania (0.52.0) ────────────────────────────────────────────────
   Android odmawia instalacji aktualizacji podpisanej INNYM kluczem — i to jest
   jedyny powód, dla którego ta konfiguracja istnieje. Wcześniej repo nie miało
   żadnej: CI budowało `assembleDebug`, a runner GitHuba generuje sobie własny
   keystore debugowy przy każdym biegu. Dwa kolejne artefakty miały więc dwa
   różne podpisy i żaden nie instalował się nad poprzednim.

   KLUCZ NIE LEŻY W REPO. Wchodzi zmiennymi środowiskowymi (CI) albo
   z `local.properties` (maszyna dewelopera; plik jest w .gitignore). Keystore
   w gicie znaczyłby, że każdy z dostępem do repo podpisze plik, który kolektory
   przyjmą jako aktualizację WERTIS.

   Brak klucza NIE psuje builda debugowego — ten ma własny podpis i ma się
   budować na maszynie bez sekretów. Psuje dopiero `assembleRelease`, i to
   dopiero w chwili uruchomienia zadania, a nie przy konfiguracji projektu.  */
val lokalne: Properties = Properties().apply {
    val plik = rootProject.file("local.properties")
    if (plik.exists()) plik.inputStream().use { load(it) }
}

fun sekret(zmienna: String, wlasciwosc: String): String? =
    System.getenv(zmienna) ?: lokalne.getProperty(wlasciwosc)

/* `takeIf { it.exists() }` jest tu istotne: ścieżka wskazująca w pustkę ma
   znaczyć „nie ma klucza", a nie wywalić build komunikatem o pliku. */
val plikKeystore: java.io.File? =
    sekret("WERTIS_KEYSTORE", "wertis.keystore")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "pl.wertis.kolektor"
    compileSdk = 35

    defaultConfig {
        applicationId = "pl.wertis.kolektor"
        minSdk = 26
        targetSdk = 35
        versionCode = kodWersji
        versionName = wersjaMonorepo

        resourceConfigurations += "pl"
    }

    signingConfigs {
        if (plikKeystore != null) {
            create("wydanie") {
                storeFile = plikKeystore
                storePassword = sekret("WERTIS_KEYSTORE_HASLO", "wertis.keystore.haslo")
                keyAlias = sekret("WERTIS_KLUCZ_ALIAS", "wertis.klucz.alias")
                keyPassword = sekret("WERTIS_KLUCZ_HASLO", "wertis.klucz.haslo")
            }
        }
    }

    buildTypes {
        release {
            /* R8 WYŁĄCZONY, i to jest decyzja z 0.52.0, nie zaniedbanie.
               Od tej wersji APK rozjeżdża się SAM po kolektorach z serwera,
               więc plik, którego nikt nie uruchomił, trafia od razu na całą
               halę. Reguły `proguard-rules.pro` nie przeszły nigdy żadnego
               builda wydania — Retrofit trzyma trasy w interfejsie czytanym
               refleksją, a kotlinx.serialization generuje serializatory, więc
               brakująca reguła nie psuje builda, tylko wywala aplikację przy
               pierwszym wywołaniu API.

               Rozmiar nie jest tu ceną: plik jedzie po sieci magazynu, a nie
               przez Play. Włączyć z powrotem można wtedy, gdy ktoś sprawdzi
               zminifikowane wydanie na fizycznym kolektorze — nie wcześniej. */
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("wydanie")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.work.runtime)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.foundation)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    // Honeywell DataCollection SDK — opcjonalny AAR z portalu Honeywell
    // (android/README.md); build i aplikacja działają bez niego (guard
    // Class.forName w HoneywellSource).
    val honeywellAar = file("libs/honeywell-datacollection.aar")
    if (honeywellAar.exists()) {
        implementation(files(honeywellAar))
    }

    testImplementation(libs.junit)
}

/* Odmowa PRZY URUCHOMIENIU zadania, nie przy konfiguracji projektu. Gradle
   konfiguruje wszystkie warianty przy każdym poleceniu, więc `error()` w bloku
   `release` wywalałby także `:core:test` i `assembleDebug` na maszynie bez
   sekretów — czyli w środowisku, w którym nikt wydania nie buduje. */
if (plikKeystore == null) {
    tasks.matching { it.name == "assembleRelease" }.configureEach {
        doFirst {
            error(
                "Brak keystore wydania. Ustaw WERTIS_KEYSTORE (i hasła) albo wpisz " +
                    "wertis.keystore w android/local.properties — patrz DEPLOY.md §5."
            )
        }
    }
}
