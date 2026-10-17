plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.omos.safety"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.omos.safety"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.1"
        // Server OMOS (Biznet). Override: -PAPI_BASE_URL=http://10.0.2.2:3000/ untuk emulator.
        val apiBaseUrl = providers.gradleProperty("API_BASE_URL")
            .orElse("https://omos-mining.com/")
            .get()
            .let { if (it.endsWith('/')) it else "$it/" }
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Keystore rilis TIDAK disimpan di repo. Isi lewat gradle property / environment saat build rilis.
    val storePath = providers.gradleProperty("OMOS_SAFETY_STORE_FILE").orElse(providers.environmentVariable("OMOS_SAFETY_STORE_FILE"))
    signingConfigs {
        create("release") {
            if (storePath.isPresent) {
                storeFile = file(storePath.get())
                storePassword = providers.gradleProperty("OMOS_SAFETY_STORE_PASSWORD").orElse(providers.environmentVariable("OMOS_SAFETY_STORE_PASSWORD")).orNull
                keyAlias = providers.gradleProperty("OMOS_SAFETY_KEY_ALIAS").orElse(providers.environmentVariable("OMOS_SAFETY_KEY_ALIAS")).orNull
                keyPassword = providers.gradleProperty("OMOS_SAFETY_KEY_PASSWORD").orElse(providers.environmentVariable("OMOS_SAFETY_KEY_PASSWORD")).orNull
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            if (storePath.isPresent) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Offline-first: Room + WorkManager
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Jaringan
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    implementation("androidx.exifinterface:exifinterface:1.3.7")

    // Token terenkripsi
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    testImplementation("junit:junit:4.13.2")
}
