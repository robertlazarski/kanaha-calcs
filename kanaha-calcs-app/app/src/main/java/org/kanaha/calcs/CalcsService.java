/*
 * Kanaha Calcs — Native Calculation Service
 *
 * SPDX-License-Identifier: Apache-2.0
 * Copyright (C) 2026 Robert Lazarski
 *
 * Foreground service that runs Apache httpd + mod_axis2 for native
 * C calculations (portfolio variance, Monte Carlo VaR, scenario analysis).
 * Localhost only — no mTLS, no wake lock.
 */

package org.kanaha.calcs;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

public class CalcsService extends Service {
    private static final String TAG = "KanahaCalcsService";
    private static final String CHANNEL_ID = "kanaha_calcs_service";
    private static final int NOTIFICATION_ID = 2001;
    // Port 8444 must match AXIS2C_BASE in scenario.js. Chosen to avoid
    // conflict with 8443 (common HTTPS alt port) and stay in unprivileged range.
    private static final int PORT = 8444;
    // Server mode: start headlessly (no UI) with
    //   am start-foreground-service -a org.kanaha.calcs.START_SERVER \
    //       -n org.kanaha.calcs/.CalcsService
    // Standalone mode: MainActivity starts it with no action. Both run the httpd.
    public static final String ACTION_START_SERVER = "org.kanaha.calcs.START_SERVER";

    /** Bundled sample data in the APK, the source for the first-run copy. */
    private static final String SAMPLE_DATA_DIR = "sample_data";

    private Process httpdProcess;
    private boolean isRunning = false;
    private NetworkDiscoveryService networkDiscovery;
    private CertProvisioning provisioning;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "CalcsService created");
        createNotificationChannel();
        deployAssets();
        seedCsvDirectory();
        deployMcpBinary(getFilesDir());
        networkDiscovery = new NetworkDiscoveryService(this);
        provisioning = new CertProvisioning(getFilesDir());
    }

    /**
     * files/csv: imported CSVs, readable by the Axis2/C service and the MCP
     * binary. Created up front so listCsvFiles answers with an empty list
     * rather than a missing directory before the first import.
     */
    private File csvDir() {
        File dir = new File(getFilesDir(), "csv");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "Could not create " + dir.getAbsolutePath());
        }
        return dir;
    }

    /**
     * Copy the bundled sample CSVs into files/csv once, so covarianceFromCsv
     * and listCsvFiles have something to read on a fresh install. Without
     * this the two operations answer with an empty list until someone imports
     * a file, which makes them look broken to anyone trying the app out.
     *
     * Every bundled CSV is copied, including a licensed one a local build may
     * carry. The page loads its dataset from the APK and the native operations
     * read files, so leaving one behind would have the two computing the same
     * card from different data. The copy is app-private, never leaves the
     * device, and goes when the app is uninstalled; the APK it came from is
     * the thing that decides whether it exists at all.
     *
     * A marker file records that the copy happened, so a CSV the user deletes
     * stays deleted. Its name begins with a dot, which the C side's name rule
     * rejects, so it never appears in a listing.
     */
    private void seedCsvDirectory() {
        File dir = csvDir();
        File marker = new File(dir, ".seeded");
        if (marker.exists()) return;

        int copied = 0;
        try {
            String[] names = getAssets().list(SAMPLE_DATA_DIR);
            if (names != null) {
                for (String name : names) {
                    if (!name.toLowerCase().endsWith(".csv")) continue;
                    File dest = new File(dir, name);
                    if (dest.exists()) continue;
                    copyAsset(SAMPLE_DATA_DIR + "/" + name, dest, false);
                    copied++;
                }
            }
            if (!marker.createNewFile()) {
                Log.w(TAG, "Could not write the CSV seed marker");
            }
            Log.i(TAG, "Seeded " + copied + " sample CSVs into " + dir.getAbsolutePath());
        } catch (IOException e) {
            Log.w(TAG, "Could not seed the CSV directory: " + e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Must call startForeground() within 5 seconds of startForegroundService(),
        // or Android kills the process with ANR. This is the Android equivalent of
        // a watchdog timer — no way to extend the deadline.
        startForeground(NOTIFICATION_ID, createNotification("Starting..."));
        String action = intent != null ? intent.getAction() : null;
        Log.i(TAG, "onStartCommand action=" + (action != null ? action : "(none, standalone)"));

        // Keypair generation on first run is CPU-heavy; run provisioning and the
        // server start off the main thread so we never risk an ANR (startForeground
        // above already satisfied the foreground-service deadline).
        new Thread(() -> {
            try {
                provisioning.ensureKeypairAndCsr();
            } catch (Exception e) {
                Log.e(TAG, "Failed to generate device keypair/CSR", e);
            }
            // Provision-required (RAPI parity): the server only starts once an operator
            // has signed the CSR with the Kanaha CA and pushed back a CA-signed cert.
            if (!provisioning.isProvisioned()) {
                updateNotification("Awaiting provisioning \u2014 sign files/csr/calcs.csr with the Kanaha CA");
                Log.w(TAG, "Not provisioned; httpd not started. Run: kanaha-provision.sh <serial> calcs");
                return;
            }
            startHttpd();
            // Advertise over mDNS so clients can discover this server (core Kanaha feature).
            networkDiscovery.registerService(PORT);
        }, "calcs-provision-start").start();
        // START_STICKY: Android restarts the service if killed for memory pressure.
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "CalcsService destroying");
        if (networkDiscovery != null) networkDiscovery.unregisterService();
        stopHttpd();
        super.onDestroy();
    }

    /*
     * Deploy Apache httpd config and Axis2/C service descriptors from APK assets
     * to internal storage. Assets inside the APK are read-only (zip-compressed),
     * but httpd needs a real filesystem path it can open(2).
     * Directory layout mirrors kanaha-camera-app:
     *   apache/conf/httpd.conf
     *   apache/logs/           (created, not deployed)
     *   apache/htdocs/         (created, not deployed)
     *   apache/axis2c/services/FinancialBenchmarkService/services.xml
     */
    private void deployAssets() {
        try {
            File apacheDir = new File(getFilesDir(), "apache");
            new File(apacheDir, "conf").mkdirs();
            new File(apacheDir, "logs").mkdirs();
            new File(apacheDir, "htdocs").mkdirs();
            new File(apacheDir, "axis2c/services/FinancialBenchmarkService").mkdirs();

            // Always redeploy config files (they may have changed between APK versions)
            copyAsset("apache/conf/httpd.conf",
                       new File(apacheDir, "conf/httpd.conf"), true);
            copyAsset("apache/conf/mime.types",
                       new File(apacheDir, "conf/mime.types"), true);

            // SSL material is NOT shipped: CertProvisioning generates the keypair +
            // CSR on-device, and an operator provisions the CA-signed server.crt +
            // ca.crt into apache/ssl (milestone B). Just ensure the dir exists.
            new File(apacheDir, "ssl").mkdirs();

            // Deploy Axis2/C axis2.xml (required — Axis2 engine config)
            copyAsset("axis2c/axis2.xml",
                       new File(apacheDir, "axis2c/axis2.xml"), true);

            // Deploy Axis2/C services.xml
            copyAsset("axis2c/services/FinancialBenchmarkService/services.xml",
                       new File(apacheDir, "axis2c/services/FinancialBenchmarkService/services.xml"), true);

            Log.i(TAG, "Apache assets deployed to " + apacheDir.getAbsolutePath());
        } catch (IOException e) {
            Log.e(TAG, "Failed to deploy assets", e);
        }
    }

    /**
     * Deploy the MCP stdio binary from nativeLibraryDir to files/ as an executable.
     * Packaged as libkanaha_mcp.so (jniLibs naming) purely so Android extracts it as a
     * real file; it is never loaded via JNI -- it is run as a subprocess over stdio.
     */
    private void deployMcpBinary(File filesDir) {
        File src = new File(getApplicationInfo().nativeLibraryDir, "libkanaha_mcp.so");
        File dst = new File(filesDir, "kanaha-calcs-mcp");
        if (!src.exists()) {
            Log.w(TAG, "MCP binary not packaged: " + src);
            return;
        }
        // Write to a temp file then atomically rename over dst. rename()
        // replaces the file even while an older copy is executing (a running
        // MCP session keeps its now-unlinked inode), which avoids ETXTBSY on
        // overwrite and guarantees the deployed binary matches the packaged
        // one -- a length comparison would silently skip a same-size patch.
        File tmp = new File(filesDir, "kanaha-calcs-mcp.tmp");
        try (java.io.InputStream in = new java.io.FileInputStream(src);
             java.io.OutputStream out = new java.io.FileOutputStream(tmp)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        catch (java.io.IOException e) {
            Log.e(TAG, "Failed to deploy MCP binary", e);
            tmp.delete();
            return;
        }
        if (!tmp.setExecutable(true, true)) {
            Log.w(TAG, "Could not mark MCP binary executable: " + tmp);
        }
        if (!tmp.renameTo(dst)) {
            Log.e(TAG, "Failed to rename MCP binary into place: " + dst);
            tmp.delete();
            return;
        }
        Log.i(TAG, "MCP binary deployed: " + dst.getAbsolutePath());
    }

    /** Copy a single asset file to internal storage. */
    private void copyAsset(String assetPath, File dest, boolean force) throws IOException {
        if (dest.exists() && !force) return;
        InputStream is = getAssets().open(assetPath);
        FileOutputStream os = new FileOutputStream(dest);
        byte[] buf = new byte[4096];
        int len;
        while ((len = is.read(buf)) > 0) {
            os.write(buf, 0, len);
        }
        os.close();
        is.close();
    }

    /*
     * Start Apache httpd + mod_axis2 via ProcessBuilder (not JNI).
     * ProcessBuilder is used instead of JNI/System.loadLibrary() because:
     * 1. httpd is a standalone server, not a shared library with JNI_OnLoad
     * 2. ProcessBuilder gives us proper process isolation — a segfault in C
     *    kills only the child process, not the entire Android app
     * 3. The binary is named .so and placed in jniLibs/ only because that's
     *    the only directory Android's APK installer extracts to nativeLibraryDir
     *    with execute permission. It's not actually a shared object.
     */
    private void startHttpd() {
        if (isRunning) return;

        try {
            String nativeLibDir = getApplicationInfo().nativeLibraryDir;
            String httpdBinary = nativeLibDir + "/libkanaha_calcs_httpd.so";

            File binary = new File(httpdBinary);
            if (!binary.exists()) {
                Log.e(TAG, "Native binary not found: " + httpdBinary);
                updateNotification("Native binary missing");
                return;
            }

            // Same launch pattern as kanaha-camera ApacheService:
            // -f config file, -d ServerRoot, -X single-process mode
            String apacheDir = new File(getFilesDir(), "apache").getAbsolutePath();
            String configPath = apacheDir + "/conf/httpd.conf";

            ProcessBuilder pb = new ProcessBuilder(
                httpdBinary,
                "-f", configPath,
                "-d", apacheDir,
                "-X"  // Single-process mode for Android
            );
            pb.directory(new File(apacheDir));
            pb.environment().put("LD_LIBRARY_PATH", nativeLibDir);
            pb.environment().put("AXIS2C_HOME", apacheDir + "/axis2c");
            // Where covarianceFromCsv and listCsvFiles look. httpd runs with
            // its working directory set to the apache directory, so the
            // relative path the MCP binary falls back to would miss; this
            // names it outright. The C side still validates every file name
            // it is given against this one fixed directory.
            pb.environment().put("KANAHA_CALCS_CSV_DIR", csvDir().getAbsolutePath());
            pb.redirectErrorStream(true);

            Log.i(TAG, "Launching: " + httpdBinary + " -f " + configPath + " -d " + apacheDir + " -X");
            httpdProcess = pb.start();
            isRunning = true;

            Log.i(TAG, "Apache httpd started on port " + PORT);
            updateNotification("Running on port " + PORT);

            // Read stdout/stderr in a thread to capture httpd errors
            final java.io.InputStream procStream = httpdProcess.getInputStream();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        BufferedReader br = new BufferedReader(new InputStreamReader(procStream));
                        String line;
                        while ((line = br.readLine()) != null) {
                            Log.i(TAG, "httpd: " + line);
                        }
                    } catch (Exception e) {
                        // stream closed
                    }
                }
            }, "httpd-stdout").start();

            // Monitor child process exit in a daemon thread. Process.waitFor()
            // blocks (like waitpid(2) in C), so it must run off the main thread.
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        int exitCode = httpdProcess.waitFor();
                        Log.w(TAG, "httpd process exited with code " + exitCode);
                        isRunning = false;
                        updateNotification("Stopped (exit " + exitCode + ")");
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
            }, "httpd-monitor").start();

        } catch (IOException e) {
            Log.e(TAG, "Failed to start httpd", e);
            updateNotification("Failed to start");
        }
    }

    /** Stop Apache httpd process. */
    private void stopHttpd() {
        if (httpdProcess != null) {
            httpdProcess.destroy();
            httpdProcess = null;
            isRunning = false;
            Log.i(TAG, "httpd stopped");
        }
    }

    // Notification channel is required on Android 8+ (API 26). Without it,
    // notifications are silently dropped. IMPORTANCE_LOW = no sound/vibration,
    // since this is a background service the user doesn't need to interact with.
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Kanaha Calcs Service",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Native calculation engine");
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    /** Create foreground service notification. */
    private Notification createNotification(String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        return builder
            .setContentTitle("Kanaha Calcs")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build();
    }

    /** Update notification text. */
    private void updateNotification(String text) {
        NotificationManager nm = (NotificationManager)
            getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, createNotification(text));
    }
}
