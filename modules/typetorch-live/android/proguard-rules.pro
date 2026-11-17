# typetorch-live: components are named in the manifest (kept by AAPT rules) and the module class by
# expo-modules-core's rules; keep the rest of the package too, it is small and nothing should be renamed under a
# PendingIntent or a saved widget.
-keep class dev.typetorch.live.** { *; }
