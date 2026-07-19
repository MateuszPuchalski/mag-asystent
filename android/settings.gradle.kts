pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "wertis-kolektor-android"

include(":core")

// :app wymaga Android SDK (AGP pobiera artefakty z dl.google.com). W środowiskach
// bez SDK (np. sandbox CI bez dostępu do dl.google.com) konfigurujemy tylko :core,
// żeby `gradle :core:test` działało. Pełny build: maszyna z ANDROID_HOME lub
// local.properties (sdk.dir=...).
val hasAndroidSdk =
    System.getenv("ANDROID_HOME") != null ||
        System.getenv("ANDROID_SDK_ROOT") != null ||
        file("local.properties").exists()
if (hasAndroidSdk) {
    include(":app")
} else {
    logger.lifecycle("WERTIS: brak Android SDK — konfiguruję tylko :core (testy JVM).")
}
