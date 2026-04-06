package com.webcc.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.media.MediaRecorder;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    private static final int MIC_PERMISSION_CODE = 1001;
    private static final int FILE_CHOOSER_CODE = 1002;

    private ValueCallback<Uri[]> fileUploadCallback;
    private File lastRecordingFile;

    private static final String FAB_STYLE =
        "position:fixed;top:40px;width:32px;height:32px;" +
        "border-radius:50%;background:rgba(22,27,34,0.85);border:1px solid #30363d;" +
        "color:#8b949e;font-size:16px;display:flex;align-items:center;justify-content:center;" +
        "z-index:999999;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
        "box-shadow:0 2px 8px rgba(0,0,0,0.3);user-select:none;opacity:0.6;";

    private static final String INJECT_FAB_JS =
        "(function(){" +
        "  if(document.getElementById('__webcc_fab'))return;" +
        "  var s='" + FAB_STYLE + "';" +
        // Back button
        "  var b=document.createElement('div');" +
        "  b.id='__webcc_fab';" +
        "  b.innerHTML='⚙';" +
        "  b.style.cssText=s+'left:8px;';" +
        "  b.addEventListener('click',function(){" +
        "    if(confirm('返回服务器选择？')){window.location.href='http://localhost/index.html';}" +
        "  });" +
        "  document.body.appendChild(b);" +
        // Refresh button
        "  var r=document.createElement('div');" +
        "  r.id='__webcc_fab_refresh';" +
        "  r.innerHTML='↻';" +
        "  r.style.cssText=s+'left:48px;';" +
        "  r.addEventListener('click',function(){" +
        "    if(typeof WebCCBridge!=='undefined'&&WebCCBridge.clearCacheAndReload){" +
        "      WebCCBridge.clearCacheAndReload();" +
        "    }else{location.reload();}" +
        "  });" +
        "  document.body.appendChild(r);" +
        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION_CODE);
        }

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);

        // Register native bridge
        webView.addJavascriptInterface(new AudioBridge(this, webView), "WebCCBridge");

        // ── WebViewClient ──
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("localhost".equals(url.getHost())) {
                    String path = url.getPath();

                    // Serve recording file
                    if ("/__recording".equals(path) && lastRecordingFile != null && lastRecordingFile.exists()) {
                        try {
                            return new WebResourceResponse("audio/mp4", null,
                                    new FileInputStream(lastRecordingFile));
                        } catch (Exception ignored) {}
                    }

                    // Serve local assets
                    if (path == null || "/".equals(path)) path = "/index.html";
                    try {
                        InputStream is = getAssets().open("public" + path);
                        return new WebResourceResponse(guessMime(path), "UTF-8", is);
                    } catch (Exception ignored) {}
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && !url.contains("localhost")) {
                    view.evaluateJavascript(INJECT_FAB_JS, null);
                }
            }

            private String guessMime(String path) {
                if (path.endsWith(".html")) return "text/html";
                if (path.endsWith(".js"))   return "application/javascript";
                if (path.endsWith(".css"))  return "text/css";
                if (path.endsWith(".json")) return "application/json";
                if (path.endsWith(".svg"))  return "image/svg+xml";
                if (path.endsWith(".png"))  return "image/png";
                if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
                if (path.endsWith(".woff2")) return "font/woff2";
                if (path.endsWith(".woff"))  return "font/woff";
                return "application/octet-stream";
            }
        });

        // ── WebChromeClient ──
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onShowFileChooser(WebView webView,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileUploadCallback != null) fileUploadCallback.onReceiveValue(null);
                fileUploadCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_CODE);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });

        // ── Keyboard height detection → inject into JS ──
        final View rootView = webView.getRootView();
        rootView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect r = new Rect();
            rootView.getWindowVisibleDisplayFrame(r);
            int visibleHeight = r.height();
            webView.evaluateJavascript(
                "document.body.style.height='" + visibleHeight + "px'", null);
        });

        webView.loadUrl("http://localhost/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null && data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    // ── Audio Recording Bridge ──
    public static class AudioBridge {
        private final MainActivity activity;
        private final WebView webView;
        private MediaRecorder recorder;
        private String filePath;

        AudioBridge(MainActivity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
        }

        @JavascriptInterface
        public void clearCacheAndReload() {
            activity.runOnUiThread(() -> {
                webView.clearCache(true);
                webView.clearHistory();
                webView.reload();
            });
        }

        @JavascriptInterface
        public boolean isAvailable() {
            return ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void startRecording() {
            activity.runOnUiThread(() -> {
                try {
                    filePath = activity.getCacheDir().getAbsolutePath() + "/webcc_rec.m4a";
                    recorder = new MediaRecorder();
                    recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                    recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                    recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                    recorder.setAudioSamplingRate(16000);
                    recorder.setAudioEncodingBitRate(64000);
                    recorder.setOutputFile(filePath);
                    recorder.prepare();
                    recorder.start();
                    callJs("window.__webccRecStarted()");
                } catch (Exception e) {
                    callJs("window.__webccRecError('" + esc(e.getMessage()) + "')");
                }
            });
        }

        @JavascriptInterface
        public void stopRecording() {
            activity.runOnUiThread(() -> {
                try {
                    if (recorder != null) {
                        recorder.stop();
                        recorder.release();
                        recorder = null;
                    }
                    File file = new File(filePath);
                    if (!file.exists() || file.length() == 0) {
                        callJs("window.__webccRecError('录音文件为空')");
                        return;
                    }
                    // Store reference so shouldInterceptRequest can serve it
                    activity.lastRecordingFile = file;
                    // Tell JS to fetch from localhost URL (avoids large base64 in evaluateJavascript)
                    callJs("window.__webccRecReady()");
                } catch (Exception e) {
                    callJs("window.__webccRecError('" + esc(e.getMessage()) + "')");
                }
            });
        }

        private void callJs(String js) {
            webView.evaluateJavascript(js, null);
        }

        private String esc(String s) {
            if (s == null) return "unknown error";
            return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n");
        }
    }
}
