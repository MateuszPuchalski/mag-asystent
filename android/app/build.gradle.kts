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

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
