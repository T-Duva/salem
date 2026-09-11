package ar.salem.prueba;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";
    private WebView webView;

    public class SalemAndroid {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> finishAffinity());
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "0.0.0";
            }
        }

        @JavascriptInterface
        public int getAppBuild() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void installApk(String url) {
            ApkInstaller.install(
                    MainActivity.this,
                    url,
                    (kind, message) ->
                            runOnUiThread(
                                    () -> {
                                        try {
                                            JSONObject o = new JSONObject();
                                            o.put("kind", kind);
                                            o.put("message", message == null ? "" : message);
                                            String js =
                                                    "window.__salemUpdateStatus && window.__salemUpdateStatus("
                                                            + o.toString()
                                                            + ")";
                                            if (webView != null) webView.evaluateJavascript(js, null);
                                        } catch (Exception ignored) {
                                        }
                                    }));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        final WebViewAssetLoader assetLoader =
                new WebViewAssetLoader.Builder()
                        .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                        .build();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new SalemAndroid(), "SalemAndroid");
        webView.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public android.webkit.WebResourceResponse shouldInterceptRequest(
                            WebView view, android.webkit.WebResourceRequest request) {
                        return assetLoader.shouldInterceptRequest(request.getUrl());
                    }
                });
        webView.loadUrl(START_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finishAffinity();
    }
}
