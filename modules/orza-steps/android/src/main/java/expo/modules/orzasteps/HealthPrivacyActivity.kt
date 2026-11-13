package expo.modules.orzasteps

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * ÖRZA's privacy policy for Health Connect (P1). Health Connect opens it from its "privacy policy" link: through the
 * `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` filter (Android 9–13) and the `ViewPermissionUsageActivity` alias
 * (Android 14+), both in this module's manifest. Google requires it to show the same policy as the Play Console's
 * privacy URL — keep PRIVACY_URL equal to that page. No sign-in and no React: a WebView on the policy (JavaScript on),
 * links off its host open in the browser, a load error shows a short note with "Open in browser", Back closes it.
 * Nothing is read from the intent that started it. The WebView loads the page with `from=app` (like every website page
 * the app opens, `src/lib/webLink.ts`), so the website hides its menu and pricing links here too; "Open in browser"
 * leaves the app and opens the plain address.
 */
class HealthPrivacyActivity : Activity() {
  private var web: WebView? = null
  private var error: View? = null

  @Suppress("DEPRECATION") // The bar colours only matter below Android 15 (always transparent from 15).
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Edge to edge on every version (Android 15+ forces it for this target SDK), the bars' insets as padding.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    val root = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }

    val webView = createWebView()
    val errorView = createErrorView()
    errorView.visibility = View.GONE
    root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    root.addView(errorView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    setContentView(root)
    // Dark bar icons on the white page. Only after setContentView: the insets controller needs the window's decor view
    // (called before it, Android 16 threw a NullPointerException — the emulator smoke test).
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
    web = webView
    error = errorView
    webView.loadUrl(IN_APP_URL)
  }

  override fun onDestroy() {
    web?.let {
      (it.parent as? ViewGroup)?.removeView(it)
      it.destroy()
    }
    web = null
    error = null
    super.onDestroy()
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun createWebView(): WebView {
    val view = WebView(this)
    view.setBackgroundColor(Color.WHITE)
    view.settings.apply {
      javaScriptEnabled = true
      // The policy page is a web-app page: without DOM storage its scripts can fail to start.
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
    }
    view.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (isPolicyHost(request.url)) return false
        openExternally(request.url)
        return true
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) showError()
      }

      override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
        if (request.isForMainFrame && response.statusCode >= 400) showError()
      }

      @SuppressLint("WebViewClientOnReceivedSslError")
      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // Never proceed past a certificate problem.
        handler.cancel()
        showError()
      }
    }
    return view
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun createErrorView(): View {
    val box = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(32), dp(32), dp(32), dp(32))
      setBackgroundColor(Color.WHITE)
    }
    val message = TextView(this).apply {
      text = ERROR_TEXT
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(0x1F, 0x23, 0x29))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    }
    val open = Button(this).apply {
      text = OPEN_TEXT
      isAllCaps = false
      setOnClickListener { openExternally(Uri.parse(PRIVACY_URL)) }
    }
    box.addView(message, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    box.addView(
      open,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20) }
    )
    return box
  }

  private fun showError() {
    web?.visibility = View.GONE
    error?.visibility = View.VISIBLE
  }

  private fun isPolicyHost(uri: Uri): Boolean = uri.scheme == "https" && uri.host == POLICY_HOST

  private fun openExternally(uri: Uri) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
    } catch (e: ActivityNotFoundException) {
      Log.w(StepConst.TAG, "Nothing can open ${uri.scheme} links", e)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't open a privacy policy link", e)
    }
  }

  private companion object {
    /** Must equal the privacy policy URL in the Play Console (Health Connect's requirement). */
    const val PRIVACY_URL = "https://orza-nine.vercel.app/privacy#phone-app"
    /** The same page as opened in the app: `from=app` hides the website's menu and pricing links (D5). */
    const val IN_APP_URL = "https://orza-nine.vercel.app/privacy?from=app#phone-app"
    const val POLICY_HOST = "orza-nine.vercel.app"
    const val ERROR_TEXT = "Couldn't load the privacy policy. Open it at orza-nine.vercel.app/privacy."
    const val OPEN_TEXT = "Open in browser"
  }
}
