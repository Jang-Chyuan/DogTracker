# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Preserve JNI, TurboModule/Fabric registration and JS-facing native methods.
# Dependency consumer rules still apply; these conservative package keeps protect
# dynamic entry points while R8 optimizes the remaining application/dependencies.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.rnmaps.** { *; }
-keep class com.facebook.react.viewmanagers.** { *; }
-keep class com.margelo.nitro.** { *; }
-keep class com.margelo.rnnitrosqlite.** { *; }
-keep class com.bleplx.** { *; }
-keep class com.polidea.rxandroidble2.** { *; }
-keep class com.dogtracker.** { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
