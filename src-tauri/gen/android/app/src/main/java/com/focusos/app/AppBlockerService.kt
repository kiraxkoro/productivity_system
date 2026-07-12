// Focus OS app blocking on Android. The sandbox forbids killing another app
// (see src-tauri/src/commands/schedules.rs), so blocking works the way every
// Android focus app does it: a foreground service watches which app is in
// front via UsageStats and drops a full-screen overlay on top of blocked ones.
//
// Started/stopped from the WebView through AppBlockerBridge. The end time is
// passed in, so the service outlives a frozen WebView and shuts itself down
// when the session is over.

package com.focusos.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class AppBlockerService : Service() {
  companion object {
    const val EXTRA_PACKAGES = "packages" // comma-separated package names
    const val EXTRA_END_MS = "endMs" // epoch millis when the session ends

    private const val CHANNEL_ID = "focus_lockdown"
    private const val NOTIFICATION_ID = 1
    private const val POLL_MS = 800L

    @Volatile
    var running = false
      private set
  }

  private val handler = Handler(Looper.getMainLooper())
  private var blocked: Set<String> = emptySet()
  private var endMs: Long = 0
  private var overlay: View? = null

  // Events are consumed incrementally; lastFg survives quiet stretches where
  // a fresh query window would contain no foreground events at all.
  private var lastFg: String? = null
  private var lastQuery = 0L

  private val poll = object : Runnable {
    override fun run() {
      if (System.currentTimeMillis() >= endMs) {
        stopSelf()
        return
      }
      val fg = foregroundPackage()
      if (fg != null && blocked.contains(fg)) showOverlay(fg) else hideOverlay()
      handler.postDelayed(this, POLL_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    blocked = intent?.getStringExtra(EXTRA_PACKAGES)
      ?.split(',')
      ?.map { it.trim() }
      ?.filter { it.isNotEmpty() }
      ?.toSet()
      ?: emptySet()
    endMs = intent?.getLongExtra(EXTRA_END_MS, 0L) ?: 0L
    if (blocked.isEmpty() || endMs <= System.currentTimeMillis()) {
      stopSelf()
      return START_NOT_STICKY
    }
    startInForeground()
    running = true
    handler.removeCallbacks(poll)
    handler.post(poll)
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    handler.removeCallbacks(poll)
    hideOverlay()
    super.onDestroy()
  }

  private fun startInForeground() {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Focus lockdown", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
    )
    val endTime = android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date(endMs))
    val builder =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID)
      else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder
      .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
      .setContentTitle("Focus session — lockdown on")
      .setContentText("${blocked.size} apps blocked until $endTime")
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  /** Last package the user brought to the foreground, per UsageStats. */
  private fun foregroundPackage(): String? {
    val usage = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    if (lastQuery == 0L) lastQuery = now - 60_000
    val events = usage.queryEvents(lastQuery, now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      // MOVE_TO_FOREGROUND == ACTIVITY_RESUMED (same constant); this form
      // works from minSdk 24 up.
      @Suppress("DEPRECATION")
      if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
        lastFg = event.packageName
      }
    }
    lastQuery = now
    return lastFg
  }

  private fun showOverlay(pkg: String) {
    if (overlay != null) return
    val wm = getSystemService(WINDOW_SERVICE) as WindowManager
    val label = try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }
    val minutesLeft = ((endMs - System.currentTimeMillis()) / 60_000L) + 1

    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#F20A0812"))
      setPadding(64, 64, 64, 64)
    }
    layout.addView(TextView(this).apply {
      text = "🔒"
      textSize = 52f
      gravity = Gravity.CENTER
    })
    layout.addView(TextView(this).apply {
      text = "$label is blocked"
      setTextColor(Color.WHITE)
      textSize = 22f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(0, 28, 0, 10)
    })
    layout.addView(TextView(this).apply {
      text = "Focus session — about $minutesLeft min left.\nFuture you says thanks."
      setTextColor(Color.parseColor("#B9A8D8"))
      textSize = 14f
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, 40)
    })
    layout.addView(Button(this).apply {
      text = "Back to focus"
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.parseColor("#8B2FC9"))
      setPadding(56, 28, 56, 28)
      setOnClickListener {
        hideOverlay()
        startActivity(
          Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      }
    })

    val type =
      if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      // not focusable: the keyboard never comes up, but taps still land here
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    )
    try {
      wm.addView(layout, params)
      overlay = layout
    } catch (_: Exception) {
      // overlay permission revoked mid-session — nothing we can do this tick
    }
  }

  private fun hideOverlay() {
    val view = overlay ?: return
    overlay = null
    try {
      (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view)
    } catch (_: Exception) {
    }
  }
}
