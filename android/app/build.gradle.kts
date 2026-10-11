plugins { id("com.android.application") }

android { namespace = "com.screenroom.app"; compileSdk = 35
    defaultConfig { applicationId = "com.screenroom.app"; minSdk = 24; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
}

dependencies {
    implementation("androidx.core:core:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.github.webrtc-sdk:android:144.7559.01")
}
