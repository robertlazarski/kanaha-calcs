/*
 * Kanaha Calcs — Apache HC5 HTTP/2 Client for Axis2/C
 *
 * Uses Apache HttpComponents 5 ASYNC client for HTTPS/HTTP2 calls to the
 * on-device Axis2/C service. HC5 classic only does HTTP/1.1 — the async
 * client with FORCE_HTTP_2 is required for HTTP/2 over TLS ALPN.
 *
 * mTLS: the listener requires a client certificate signed by the Kanaha CA
 * (SSLVerifyClient require). This client presents the device's own
 * provisioned cert (files/apache/ssl/server.crt + server.key, minted on-device
 * by CertProvisioning and signed off-device; it carries clientAuth EKU) and
 * trusts the CA cert pushed alongside it (ca.crt). Nothing is read from the
 * APK's assets and no private key ships. Same posture as kanaha-camera and
 * kanaha-audio. Hostname verification is disabled because the peer is
 * 127.0.0.1 and the device cert names the device, not the loopback address.
 */

package org.kanaha.calcs;

import android.content.Context;
import android.util.Log;

import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleHttpRequests;
import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;
import org.apache.hc.client5.http.impl.async.HttpAsyncClients;
import org.apache.hc.client5.http.impl.async.CloseableHttpAsyncClient;
import org.apache.hc.client5.http.impl.nio.PoolingAsyncClientConnectionManagerBuilder;
import org.apache.hc.client5.http.nio.AsyncClientConnectionManager;
import org.apache.hc.client5.http.ssl.DefaultClientTlsStrategy;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http2.HttpVersionPolicy;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.File;
import java.io.InputStream;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class Axis2Client {
    private static final String TAG = "KanahaAxis2Client";
    private static final String BASE_URL =
        "https://127.0.0.1:8444/services/FinancialBenchmarkService";

    // Ephemeral in-memory keystore password; the keystore never touches disk.
    private static final char[] KS_PW = "kanaha".toCharArray();

    private static Context appContext;
    private static CloseableHttpAsyncClient httpClient;

    /** Must be called once (from MainActivity) before the first post(). */
    public static synchronized void init(Context ctx) {
        if (appContext == null) {
            appContext = ctx.getApplicationContext();
        }
    }

    private static synchronized CloseableHttpAsyncClient getClient() throws Exception {
        if (httpClient == null) {
            if (appContext == null) {
                throw new IllegalStateException("Axis2Client.init(context) not called");
            }

            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(buildKeyManagers(), buildTrustManagers(),
                            new java.security.SecureRandom());

            // DefaultClientTlsStrategy uses Java's SSLEngine, which supports
            // ALPN on Android API 28+ (our minSdk). NoopHostnameVerifier because
            // the demo certs carry no SAN and we connect to 127.0.0.1.
            DefaultClientTlsStrategy tlsStrategy = new DefaultClientTlsStrategy(
                sslContext,
                org.apache.hc.client5.http.ssl.NoopHostnameVerifier.INSTANCE);

            AsyncClientConnectionManager cm =
                PoolingAsyncClientConnectionManagerBuilder.create()
                    .setTlsStrategy(tlsStrategy)
                    .build();

            httpClient = HttpAsyncClients.custom()
                .setVersionPolicy(HttpVersionPolicy.FORCE_HTTP_2)
                .setConnectionManager(cm)
                .build();
            httpClient.start();
            Log.i(TAG, "HC5 async HTTP/2 mTLS client started");
        }
        return httpClient;
    }

    /** Present the shared client cert (CN=kanaha-control) from assets. */
    private static javax.net.ssl.KeyManager[] buildKeyManagers() throws Exception {
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate clientCert;
        // The provisioned device cert (server.crt) carries clientAuth EKU, so it
        // doubles as this loopback client's cert. Read from the app files dir, where
        // the operator provisioned it -- not from assets (nothing ships anymore).
        File sslDir = new File(appContext.getFilesDir(), "apache/ssl");
        try (InputStream in = new java.io.FileInputStream(new File(sslDir, "server.crt"))) {
            clientCert = (X509Certificate) cf.generateCertificate(in);
        }
        PrivateKey clientKey = readPkcs8Key(new File(sslDir, "server.key"));

        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        ks.setKeyEntry("client", clientKey, KS_PW,
                       new java.security.cert.Certificate[]{clientCert});
        KeyManagerFactory kmf =
            KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, KS_PW);
        return kmf.getKeyManagers();
    }

    /** Trust only the shared Kanaha demo CA from assets. */
    private static javax.net.ssl.TrustManager[] buildTrustManagers() throws Exception {
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate caCert;
        File sslDir = new File(appContext.getFilesDir(), "apache/ssl");
        try (InputStream in = new java.io.FileInputStream(new File(sslDir, "ca.crt"))) {
            caCert = (X509Certificate) cf.generateCertificate(in);
        }
        KeyStore ts = KeyStore.getInstance("PKCS12");
        ts.load(null, null);
        ts.setCertificateEntry("ca", caCert);
        TrustManagerFactory tmf =
            TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ts);
        return tmf.getTrustManagers();
    }

    /** Parse a PKCS#8 PEM ("BEGIN PRIVATE KEY") RSA key from assets. */
    private static PrivateKey readPkcs8Key(File keyFile) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (InputStream in = new java.io.FileInputStream(keyFile)) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, "US-ASCII"));
        }
        String pem = sb.toString()
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replaceAll("\\s", "");
        byte[] der = android.util.Base64.decode(pem, android.util.Base64.DEFAULT);
        return KeyFactory.getInstance("RSA")
            .generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    public static String post(String path, String jsonPayload) throws Exception {
        SimpleHttpRequest request = SimpleHttpRequests.post(BASE_URL + path);
        request.setBody(jsonPayload, ContentType.APPLICATION_JSON);

        Future<SimpleHttpResponse> future = getClient().execute(request, null);
        // Bounded wait so a *stalled* server cannot hang the bridge forever, but
        // long enough for a legitimate max-size compute: monteCarlo can be driven
        // near FINBENCH_MAX_WORK (~1e9 step-work, ~100s on-device). This runs on a
        // WebView background thread, not the UI thread, so a long wait is not an ANR.
        SimpleHttpResponse response = future.get(120, TimeUnit.SECONDS);

        int code = response.getCode();
        String body = response.getBodyText();
        Log.i(TAG, "Response: HTTP " + code + " len=" +
              (body != null ? body.length() : 0) +
              " proto=" + response.getVersion());

        if (body == null || body.isEmpty()) {
            return "{\"error\":\"Empty response (HTTP " + code + ")\"}";
        }
        return body;
    }
}
