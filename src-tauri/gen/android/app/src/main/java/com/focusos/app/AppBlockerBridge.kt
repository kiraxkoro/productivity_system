// The WebView side of app blocking: MainActivity injects this object as
// window.FocusOSNative (see src/shared/native.ts for the typed JS wrapper).
// All methods are synchronous and stick to String/Boolean — the JS bridge
// marshals those reliably on every Android version we support.

package com.focusos.app

import android.app.Activity
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

class AppBlockerBridge(private val activity: Activity) {

  /** Usage Access — required to know which app is in the foreground. */
  @JavascriptInterface
  fun hasUsageAccess(): Boolean {
    val ops = activity.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= 29) {
      ops.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName
      )
    } else {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName
      )
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  /** "Display over other apps" — required to cover a blocked app. */
  @JavascriptInterface
  fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(activity)

  @JavascriptInterface
  fun requestUsageAccess() {
    activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
  }

  @JavascriptInterface
  fun requestOverlayPermission() {
    activity.startActivity(
      Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${activity.packageName}")
      )
    )
  }

  /** JSON array of launchable apps: [{"label": "...", "package": "..."}]. */
  @JavascriptInterface
  fun listInstalledApps(): String {
    val pm = activity.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = if (Build.VERSION.SDK_INT >= 33) {
      pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION") pm.queryIntentActivities(launcher, 0)
    }
    val seen = HashSet<String>()
    val out = JSONArray()
    for (info in resolved) {
      val pkg = info.activityInfo.packageName
      if (pkg == activity.packageName || !seen.add(pkg)) continue
      out.put(
        JSONObject()
          .put("label", info.loadLabel(pm).toString())
          .put("package", pkg)
      )
    }
    return out.toString()
  }

  /**
   * Starts (or retargets) the blocking service. endEpochMs comes as a string
   * because a JS number crossing the bridge is a double — parsing a string is
   * unambiguous.
   */
  @JavascriptInterface
  fun startBlocking(packagesCsv: String, endEpochMs: String) {
    val end = endEpochMs.toLongOrNull() ?: return
    val intent = Intent(activity, AppBlockerService::class.java)
      .putExtra(AppBlockerService.EXTRA_PACKAGES, packagesCsv)
      .putExtra(AppBlockerService.EXTRA_END_MS, end)
    if (Build.VERSION.SDK_INT >= 26) {
      activity.startForegroundService(intent)
    } else {
      activity.startService(intent)
    }
  }

  @JavascriptInterface
  fun stopBlocking() {
    activity.stopService(Intent(activity, AppBlockerService::class.java))
  }

  @JavascriptInterface
  fun isBlocking(): Boolean = AppBlockerService.running
}
