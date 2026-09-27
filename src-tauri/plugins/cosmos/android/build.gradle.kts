plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "lat.cosmospay.plugin.cosmos"
    // Tauri 2.12's `:tauri-android` refuses to link into anything compiled below 36
    // (checkReleaseAarMetadata). compileSdk only decides which APIs are visible at build
    // time; runtime behaviour follows targetSdk / minSdk, which this does not touch.
    compileSdk = 36

    defaultConfig {
        // Must not exceed `bundle.android.minSdkVersion` in src-tauri/tauri.conf.json.
        // 26 is what the Keystore work below assumes as its floor; the two API guards in
        // DeviceAuth.kt are for 28 and 30, not for anything older.
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
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
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // BiometricPrompt + BiometricManager. This is the whole reason the plugin exists:
    // it is the only API that can open a Keystore key through a CryptoObject, which is
    // what makes the read itself the authenticated operation.
    implementation("androidx.biometric:biometric:1.1.0")
    // Passkeys (Passkey.kt). Credential Manager takes the WebAuthn JSON the web layer builds,
    // PRF extension included, and hands it to the person's provider. The play-services half
    // is what reaches Google Password Manager on Android 9-13, where the framework has no
    // Credential Manager of its own. 1.3.0 was the newest line that built at compileSdk 34; moving past it is a separate change.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation(project(":tauri-android"))
}
