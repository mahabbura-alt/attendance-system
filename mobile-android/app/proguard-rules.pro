# Keep Retrofit & Gson
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations
-keepattributes RuntimeVisibleParameterAnnotations, RuntimeInvisibleParameterAnnotations
-keepattributes AnnotationDefault

# Keep DTO classes & fields for Gson JSON serialization
-keep class com.perusahaan.absensi.network.dto.** { *; }
-keepclassmembers class com.perusahaan.absensi.network.dto.** { *; }

# Keep ApiService interface & methods
-keep interface com.perusahaan.absensi.network.ApiService { *; }
-keep class com.perusahaan.absensi.network.** { *; }

# Keep Gson
-keep class com.google.gson.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Keep OkHttp & Retrofit
-dontwarn okhttp3.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
