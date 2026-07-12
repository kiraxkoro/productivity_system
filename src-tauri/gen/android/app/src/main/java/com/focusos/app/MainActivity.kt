package com.focusos.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Runs while the WebView is being built, before the app URL loads, so the
  // interface is present from the very first page. See src/shared/native.ts.
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(AppBlockerBridge(this), "FocusOSNative")
  }
}
