# Tauri resolves plugin commands by reflection, so the class and its @Command methods
# must survive shrinking. Without this the release build answers every command with
# "unknown command" and the biometric unlock silently reports itself unavailable.
-keep class lat.cosmospay.plugin.cosmos.** { *; }
