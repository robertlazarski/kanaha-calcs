package org.kanaha.calcs;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.Comparator;

public class MainActivity extends Activity {

    private static final int FILE_PICKER_REQUEST = 1001;
    // Guard against loading huge files into the WebView JS heap. Android
    // WebView's V8 has a much smaller heap than desktop Chrome (~256MB).
    // A 10MB CSV with 4 columns * 4000 rows is already generous.
    private static final long MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB
    // Bounds on the copy kept for the native side under files/csv. The app's
    // own storage is the budget here, not the WebView's heap.
    private static final int MAX_CSV_NAME = 100;
    private static final int MAX_CSV_FILES = 20;
    private static final long MAX_CSV_DIR_BYTES = 100 * 1024 * 1024; // 100 MB
    private WebView webView;

    /*
     * A named view to open once the page is ready, from the "open" intent
     * extra: adb shell am start -n org.kanaha.calcs/.MainActivity
     *     --activity-single-top --es open pv-learn
     * is how the demo switches from the camera to calcs. Delivered to the
     * running activity (onNewIntent) rather than by restarting the app, whose
     * process also hosts the calcs server the other phone is calling.
     */
    private boolean pageLoaded;
    private String pendingView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep screen on while app is in foreground — same as kanaha-camera
        // and kanaha-audio. Prevents the display timeout from interrupting
        // demo sessions and long-running Monte Carlo results review.
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Dark status bar
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(0xFF1a1a2e);
        // Clear light status bar flag so icons are white on dark background
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.getDecorView().setSystemUiVisibility(
                window.getDecorView().getSystemUiVisibility()
                    & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            );
        }

        webView = new WebView(this);

        // From targetSdk 35 on Android 15+ the content view fills the window,
        // system bars included, so the top of the page sits under the status
        // bar: the app header and the Load CSV button were drawn there, the
        // button unreachable behind the action bar this app no longer has.
        // The inset goes on a container rather than on the WebView, because
        // padding set on the WebView itself does not move the page. The
        // container carries the page's own background so the inset does not
        // read as a gap.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF1a1a2e);   // --bg in style.css
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top = 0, bottom = 0, left = 0, right = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        });
        // The listener is attached after the first inset dispatch would have
        // run, so ask for one; without this the page keeps drawing under the
        // status bar until something else triggers a dispatch.
        root.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // Required for localStorage persistence (fund positions, last tab)
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        // SECURITY NOTE: setAllowFileAccessFromFileURLs is deprecated and
        // disabled by default since API 30. We need it because we load from
        // file:///android_asset/ and XHR to relative paths (sample CSV).
        // This is safe because we control all content — no remote URLs loaded.
        settings.setAllowFileAccessFromFileURLs(true);
        // Allow WebView to fetch from http://localhost (Axis2/C service)
        // when loaded from file:// origin. Without this, mixed-content
        // policy silently blocks the fetch.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.addJavascriptInterface(new WebAppInterface(), "Android");
        // Accept self-signed SSL cert for localhost Axis2/C service.
        // Axis2/C JSON requires HTTP/2, which WebView only negotiates over TLS.
        pendingView = viewFrom(getIntent());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(android.webkit.WebView view, String url) {
                pageLoaded = true;
                deliverView();
            }

            /*
             * Send external links (the "See the math" GitHub links in the
             * Learn More panels) to the system browser. If they load inside
             * this WebView, Back has to goBack() through them, and returning
             * to the file:// page reloads index.html — scroll position and
             * every computed result are lost. The app's own content is
             * file:///android_asset and Axis2 calls go through Axis2Client,
             * not the WebView, so any http(s) navigation seen here is a
             * user-clicked external link.
             */
            @Override
            public boolean shouldOverrideUrlLoading(android.webkit.WebView view,
                    android.webkit.WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (android.content.ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this,
                                "No browser available to open link", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedSslError(android.webkit.WebView view,
                    android.webkit.SslErrorHandler handler,
                    android.net.http.SslError error) {
                // Only trust localhost — reject all other SSL errors
                String url = error.getUrl();
                if (url != null && (url.startsWith("https://localhost") ||
                                     url.startsWith("https://127.0.0.1"))) {
                    handler.proceed();
                } else {
                    handler.cancel();
                }
            }
        });
        webView.setBackgroundColor(0xFF1a1a2e);
        webView.loadUrl("file:///android_asset/index.html");

        // Load the shared client cert / CA for the mTLS HC5 client.
        Axis2Client.init(getApplicationContext());

        // Start native calculation service (Axis2/C on localhost:8444)
        startCalcsService();
    }

    /*
     * Android 8+ (API 26) requires startForegroundService() for services that
     * call startForeground(). Using plain startService() on API 26+ throws
     * IllegalStateException if the service doesn't call startForeground()
     * within 5 seconds. The pre-O path is kept for older devices.
     */
    private void startCalcsService() {
        Intent serviceIntent = new Intent(this, CalcsService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    /*
     * @JavascriptInterface methods are callable from JS as Android.methodName().
     * IMPORTANT: these run on a WebView background thread, NOT the UI thread.
     * startActivityForResult is safe here because Activity methods post to the
     * main looper internally. But if you add UI work, wrap in runOnUiThread().
     */
    public class WebAppInterface {
        @JavascriptInterface
        public void openFilePicker() {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("text/*");
            startActivityForResult(intent, FILE_PICKER_REQUEST);
        }

        /**
         * Bridge for WebView → Axis2/C HTTPS/HTTP2 calls using Apache HC5.
         * WebView's fetch() cannot present a client cert and does not do
         * HTTP/2 to a self-signed endpoint, so the call is made from Java.
         * HC5 supports HTTP/2 via ALPN (Axis2/C JSON requires HTTP/2) and
         * presents the shared client cert for the mTLS listener; see
         * Axis2Client. HttpsURLConnection does NOT support HTTP/2.
         *
         * Called from JS: Android.callAxis2('/scenarioAnalysis', jsonPayload)
         * Returns: JSON response string, or '{"error":"..."}' on failure
         */
        @JavascriptInterface
        public String callAxis2(String path, String jsonPayload) {
            Log.i("KanahaCalcs", "callAxis2: path=" + path);
            try {
                return Axis2Client.post(path, jsonPayload);
            } catch (Exception e) {
                Log.e("KanahaCalcs", "callAxis2 error: " + e.getClass().getName() + ": " + e.getMessage());
                return "{\"error\":\"" + jsonEscape(e.getMessage()) + "\"}";
            }
        }

        /* Minimal RFC 8259 string escaping for a value placed inside a JSON
         * string literal. Also handles a null message, which would otherwise
         * NPE inside this very error path. */
        private String jsonEscape(String s) {
            if (s == null) return "";
            StringBuilder out = new StringBuilder(s.length() + 16);
            for (int i = 0; i < s.length(); i++) {
                char ch = s.charAt(i);
                switch (ch) {
                    case '"':  out.append("\\\""); break;
                    case '\\': out.append("\\\\"); break;
                    case '\n': out.append("\\n"); break;
                    case '\r': out.append("\\r"); break;
                    case '\t': out.append("\\t"); break;
                    default:
                        if (ch < 0x20) out.append(String.format("\\u%04x", (int) ch));
                        else out.append(ch);
                }
            }
            return out.toString();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER_REQUEST && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri == null) return;

            // Check file size before reading
            long fileSize = getFileSize(uri);
            if (fileSize > MAX_CSV_BYTES) {
                Toast.makeText(this, "CSV too large (max 10 MB)", Toast.LENGTH_LONG).show();
                return;
            }

            // Extract filename from URI
            String filename = getFileName(uri);

            try {
                InputStream is = getContentResolver().openInputStream(uri);
                BufferedReader reader = new BufferedReader(new InputStreamReader(is));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append('\n');
                }
                reader.close();

                // Base64-encode both content and filename before injecting into JS.
                // Without this, a CSV containing a single-quote or newline would
                // break the JS string literal, and a malicious filename could
                // inject arbitrary JS. Base64 output is [A-Za-z0-9+/=] only.
                // NO_WRAP prevents line breaks in the Base64 output.
                String b64 = Base64.encodeToString(
                    sb.toString().getBytes("UTF-8"), Base64.NO_WRAP);
                String b64Filename = Base64.encodeToString(
                    filename.getBytes("UTF-8"), Base64.NO_WRAP);

                webView.evaluateJavascript(
                    "receiveCSVBase64('" + b64 + "', '" + b64Filename + "')", null);

                // Keep a copy where the C side can reach it. The JavaScript
                // gets the text in memory; the native operations
                // (covarianceFromCsv, listCsvFiles) read files, and the
                // Axis2/C service and the MCP binary are separate processes
                // with no access to the WebView's heap. Without this the
                // phone could show a matrix it could not compute natively.
                String stored = persistCsv(filename, sb.toString());
                if (stored != null) {
                    Log.i("MainActivity", "CSV available to the native side as " + stored);
                }
            } catch (Exception e) {
                e.printStackTrace();
                Toast.makeText(this, "Failed to read CSV", Toast.LENGTH_SHORT).show();
            }
        }
    }

    /**
     * Save an imported CSV under files/csv so the native operations can read
     * it by name. Returns the stored name, or null if it could not be saved.
     *
     * The name is rebuilt rather than trusted: a content URI's display name
     * is chosen by whatever app provided the file and can carry separators or
     * anything else. The C side validates the name again before it opens
     * anything, so this is the first of two checks, not the only one.
     */
    private String persistCsv(String displayName, String content) {
        try {
            File dir = new File(getFilesDir(), "csv");
            if (!dir.exists() && !dir.mkdirs()) {
                Log.w("MainActivity", "Could not create the CSV directory");
                return null;
            }

            StringBuilder safe = new StringBuilder();
            String base = displayName != null ? displayName : "import.csv";
            if (base.toLowerCase().endsWith(".csv")) {
                base = base.substring(0, base.length() - 4);
            }
            for (int i = 0; i < base.length() && safe.length() < MAX_CSV_NAME; i++) {
                char ch = base.charAt(i);
                boolean ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
                          || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_';
                safe.append(ok ? ch : '_');
            }
            while (safe.length() > 0 && safe.charAt(0) == '_') safe.deleteCharAt(0);
            if (safe.length() == 0) safe.append("import");
            String name = safe + ".csv";

            File out = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(out);
            try {
                fos.write(content.getBytes("UTF-8"));
            } finally {
                fos.close();
            }

            pruneCsvDirectory(dir, out);
            return name;
        } catch (Exception e) {
            Log.w("MainActivity", "Could not save the CSV for the native side: " + e);
            return null;
        }
    }

    /**
     * Keep the CSV directory bounded: the newest MAX_CSV_FILES files, and no
     * more than MAX_CSV_DIR_BYTES in total. An import that is itself over the
     * total budget is kept anyway — it is the one the user just chose — and
     * everything older goes.
     */
    private void pruneCsvDirectory(File dir, File keep) {
        File[] files = dir.listFiles();
        if (files == null) return;

        Arrays.sort(files, new Comparator<File>() {
            @Override public int compare(File a, File b) {
                return Long.compare(b.lastModified(), a.lastModified());   // newest first
            }
        });

        long total = 0;
        for (int i = 0; i < files.length; i++) {
            File f = files[i];
            total += f.length();
            boolean overCount = i >= MAX_CSV_FILES;
            boolean overSize = total > MAX_CSV_DIR_BYTES;
            if ((overCount || overSize) && !f.equals(keep)) {
                if (!f.delete()) {
                    Log.w("MainActivity", "Could not remove an old CSV: " + f.getName());
                }
            }
        }
    }

    /** Get file size from content URI. */
    private long getFileSize(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (idx >= 0) return cursor.getLong(idx);
            }
        } catch (Exception e) {
            // Fall through — allow the read attempt
        }
        return 0;
    }

    /** Get display name from content URI. */
    private String getFileName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception e) {
            // Fall through
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "user.csv";
    }

    @Override
    public void onDestroy() {
        stopService(new Intent(this, CalcsService.class));
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String v = viewFrom(intent);
        if (v != null) {
            pendingView = v;
            deliverView();
        }
    }

    /* The extra comes from outside the app, so it is only ever a view name:
     * lower-case letters and dashes, which the page looks up in a fixed table. */
    private static String viewFrom(Intent intent) {
        String v = intent == null ? null : intent.getStringExtra("open");
        return (v != null && v.matches("[a-z-]{1,32}")) ? v : null;
    }

    private void deliverView() {
        if (!pageLoaded || pendingView == null || webView == null) return;
        webView.evaluateJavascript("kanahaOpen('" + pendingView + "')", null);
        pendingView = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
