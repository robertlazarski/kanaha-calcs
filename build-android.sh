#!/bin/bash
# kanaha-calcs: Cross-compile Axis2/C FinancialBenchmarkService for Android arm64-v8a
#
# Prerequisites:
#   - NDK at ~/Android/Sdk/ndk/28.0.12916984
#   - kanaha-android-deps built (its build-all.sh), which provides the
#     libraries in ~/android-cross-builds/deps/arm64-v8a/ and the httpd tree
#
# Output: kanaha-calcs-app/app/src/main/jniLibs/arm64-v8a/libkanaha_calcs_httpd.so
#
# Usage: cd $HOME/repos/kanaha-calcs && bash build-android.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NDK=$HOME/Android/Sdk/ndk/28.0.12916984
CC=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android21-clang
AR=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar
STRIP=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip

# Native dependencies come from kanaha-android-deps
# (https://github.com/robertlazarski/kanaha-android-deps); run its build-all.sh
# first. It records what it built in BUILD-INFO, including the httpd version
# whose build tree this script links from.
DEPS_WORK=$HOME/android-cross-builds
DEPS=$DEPS_WORK/deps/arm64-v8a
if [ ! -f "$DEPS/BUILD-INFO" ]; then
    echo "error: $DEPS/BUILD-INFO not found; build kanaha-android-deps first" >&2
    exit 1
fi
HTTPD_VERSION=$(sed -n 's/^HTTPD_VERSION=//p' "$DEPS/BUILD-INFO")
AXIS2C_REF=$(sed -n 's/^AXIS2C_REF=//p' "$DEPS/BUILD-INFO")
if [ -z "$HTTPD_VERSION" ] || [ -z "$AXIS2C_REF" ]; then
    echo "error: $DEPS/BUILD-INFO lacks HTTPD_VERSION or AXIS2C_REF; rebuild kanaha-android-deps" >&2
    exit 1
fi
# Axis2/C headers and sources come from the tree kanaha-android-deps exported
# at the commit its libraries were built from, never from a checkout that may
# have moved on: a header that disagrees with the library it describes fails
# at run time, not at link time.
AXIS2_SRC="$DEPS_WORK/axis2c-src-${AXIS2C_REF:0:9}"
HTTPD_DIR="$DEPS_WORK/httpd-$HTTPD_VERSION"
FINBENCH_SRC=$AXIS2_SRC/samples/user_guide/financial-benchmark-service/src

# Use the pre-built include dir which has all headers (axiom, neethi, etc)
# in a flat layout — avoids chasing individual source tree include paths.
AXIS2_INCLUDE=$DEPS/include/axis2-2.0.0
UTIL_INCLUDE=$AXIS2_SRC/util/include

OUTPUT_DIR=$SCRIPT_DIR/kanaha-calcs-app/app/src/main/jniLibs/arm64-v8a

# Optimization for every service and MCP object. clang defaults to -O0 when no
# -O flag is given, which is how the engine shipped until 2026-09-19: the Monte
# Carlo loops (and now the correlated book's O(n_assets^2) inner product) ran
# unoptimized on the phone. kanaha-audio's build has used -O2 all along.
OPT="-O2"

echo "=== kanaha-calcs: Building FinancialBenchmarkService for Android arm64-v8a ==="

cd $HTTPD_DIR

# -fsigned-char: axis2_char_t is plain char, signed on x86 and unsigned on
# arm64. The Axis2/C libraries are built with -fsigned-char (see its
# configure.ac), so these service sources must match or the same char
# behaves differently either side of the call.
echo "--- Compiling FinancialBenchmarkService ---"

# Compile financial benchmark service handler
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c \
    -I$DEPS/include \
    -I$DEPS/include/apr-1 \
    -I$AXIS2_INCLUDE \
    -I$UTIL_INCLUDE \
    -I$FINBENCH_SRC \
    $FINBENCH_SRC/financial_benchmark_service_handler.c \
    -o financial_benchmark_service_handler.o

# Compile financial benchmark service implementation
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c \
    -I$DEPS/include \
    -I$DEPS/include/apr-1 \
    -I$AXIS2_INCLUDE \
    -I$UTIL_INCLUDE \
    -I$FINBENCH_SRC \
    $FINBENCH_SRC/financial_benchmark_service.c \
    -o financial_benchmark_service.o

# Compile JSON secure fault handler
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c \
    -I$DEPS/include \
    -I$DEPS/include/apr-1 \
    -I$AXIS2_INCLUDE \
    -I$UTIL_INCLUDE \
    -I$FINBENCH_SRC \
    $FINBENCH_SRC/axis2_json_secure_fault.c \
    -o axis2_json_secure_fault.o

# Compile MCP catalog handler (required by financial_benchmark_service_handler)
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c \
    -I$DEPS/include \
    -I$DEPS/include/apr-1 \
    -I$AXIS2_INCLUDE \
    -I$UTIL_INCLUDE \
    -I$FINBENCH_SRC \
    $FINBENCH_SRC/mcp_catalog_handler.c \
    -o mcp_catalog_handler.o

# Compile the Android static service adapter (bridges 2-param json_object*
# signature to the 4-param char* _json_only functions)
ADAPTER_SRC=$SCRIPT_DIR/kanaha-calcs-app/app/src/main/cpp/finbench_static_adapter.c
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c \
    -I$DEPS/include \
    -I$DEPS/include/apr-1 \
    -I$AXIS2_INCLUDE \
    -I$UTIL_INCLUDE \
    -I$FINBENCH_SRC \
    -I$SCRIPT_DIR/kanaha-calcs-app/app/src/main/cpp \
    $ADAPTER_SRC \
    -o finbench_static_adapter.o

# Compile the app's CSV data source: covarianceFromCsv and listCsvFiles read
# a file under the app's files directory, which the upstream sample has no
# business knowing about. It also provides the MCP transport's extension
# point, so the same two tools appear on both paths.
CSV_SRC=$SCRIPT_DIR/kanaha-calcs-app/app/src/main/cpp/calcs_csv_source.c
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c \
    -I$DEPS/include \
    -I$DEPS/include/apr-1 \
    -I$AXIS2_INCLUDE \
    -I$UTIL_INCLUDE \
    -I$FINBENCH_SRC \
    -I$SCRIPT_DIR/kanaha-calcs-app/app/src/main/cpp \
    $CSV_SRC \
    -o calcs_csv_source.o

# Create static library for the financial benchmark service
# Note: financial_benchmark_service_handler.o is EXCLUDED for Android.
# It exports the server-side 4-param _invoke_json which conflicts with
# the adapter's 2-param version. The adapter handles operation routing.
$AR rcs libfinbench_services.a \
    financial_benchmark_service.o \
    axis2_json_secure_fault.o \
    finbench_static_adapter.o \
    calcs_csv_source.o \
    mcp_catalog_handler.o

echo "--- Static library built: libfinbench_services.a ---"

echo "--- Linking httpd with FinancialBenchmarkService ---"

# Link: same as kanaha-camera but with finbench services instead of camera services
# Android 15 (API 35) requires 16KB page alignment
$CC -fPIC -o kanaha-calcs-httpd modules.o buildmark.o \
  -Wl,--export-dynamic \
  -Wl,-z,max-page-size=16384 \
  -Wl,-z,separate-loadable-segments \
  -L$DEPS/lib \
  server/.libs/libmain.a \
  modules/aaa/.libs/libmod_authz_core.a \
  modules/core/.libs/libmod_so.a \
  modules/http/.libs/libmod_http.a \
  modules/http/.libs/libmod_mime.a \
  modules/loggers/.libs/libmod_log_config.a \
  modules/metadata/.libs/libmod_headers.a \
  modules/ssl/.libs/libmod_ssl.a \
  modules/http2/.libs/libmod_http2.a \
  -lssl -ldl -lcrypto \
  modules/arch/unix/.libs/libmod_unixd.a \
  modules/mappers/.libs/libmod_dir.a \
  modules/mappers/.libs/libmod_rewrite.a \
  server/mpm/worker/.libs/libworker.a \
  os/unix/.libs/libos.a \
  $DEPS/lib/libmod_axis2.a \
  -Wl,--whole-archive $DEPS/lib/libaxis2_engine.a -Wl,--no-whole-archive \
  -Wl,--whole-archive libfinbench_services.a -Wl,--no-whole-archive \
  $DEPS/lib/libaxis2_deployment.a \
  $DEPS/lib/libaxis2_description.a \
  $DEPS/lib/libaxis2_context.a \
  $DEPS/lib/libaxis2_phaseresolver.a \
  $DEPS/lib/libaxis2_core_utils.a \
  $DEPS/lib/libaxis2_http_common.a \
  $DEPS/lib/libaxis2_http_util.a \
  $DEPS/lib/libaxis2_h2_transport.a \
  $DEPS/lib/libaxis2_h2_sender.a \
  $DEPS/lib/libaxis2_axiom.a \
  $DEPS/lib/libaxis2_axiom_util.a \
  $DEPS/lib/libaxis2_parser.a \
  $DEPS/lib/libaxis2_soap.a \
  $DEPS/lib/libaxis2_addr.a \
  $DEPS/lib/libaxis2_xpath.a \
  $DEPS/lib/libaxis2_unix.a \
  $DEPS/lib/libaxis2_attachments.a \
  $DEPS/lib/libaxis2_clientapi.a \
  $DEPS/lib/libaxutil.a \
  $DEPS/lib/libneethi.a \
  $DEPS/lib/libguththila.a \
  $DEPS/lib/libpcre2-8.a \
  -ljson-c \
  $DEPS/lib/libnghttp2.a \
  $DEPS/lib/libaprutil-1.a \
  $DEPS/lib/libexpat.a \
  $DEPS/lib/libapr-1.a \
  -lm -llog -pthread

echo "--- Link complete ---"
file kanaha-calcs-httpd

# Strip debug symbols for smaller binary
$STRIP kanaha-calcs-httpd

# Copy to jniLibs (Android loads .so files from here)
mkdir -p $OUTPUT_DIR
cp kanaha-calcs-httpd $OUTPUT_DIR/libkanaha_calcs_httpd.so

echo "=== Done: $OUTPUT_DIR/libkanaha_calcs_httpd.so ==="
ls -la $OUTPUT_DIR/libkanaha_calcs_httpd.so

# ── MCP stdio binary (Claude Desktop transport), mirroring kanaha-audio ──
# finbench_mcp_main.c speaks MCP JSON-RPC 2.0 over stdio and links the service
# compute directly -- no httpd, no mod_axis2, no apache modules (those would
# pull apache's main()). Reuses the service objects the httpd step built here.
echo "--- Building MCP stdio binary ---"
FINBENCH_INC="-I$DEPS/include -I$DEPS/include/apr-1 -I$AXIS2_INCLUDE -I$UTIL_INCLUDE -I$FINBENCH_SRC"
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c $FINBENCH_INC \
    $FINBENCH_SRC/finbench_mcp_main.c -o finbench_mcp_main.o
$CC $OPT -fPIC -fsigned-char -D__ANDROID__ -c $FINBENCH_INC \
    $FINBENCH_SRC/finbench_mcp.c -o finbench_mcp.o
# calcs_csv_source.o carries the strong finbench_mcp_extra_tools() and
# finbench_mcp_extra_dispatch(), which replace the transport's weak defaults:
# that is how covarianceFromCsv and listCsvFiles reach tools/list here.
$CC -fPIE -pie -o kanaha-calcs-mcp \
    finbench_mcp_main.o finbench_mcp.o \
    financial_benchmark_service.o axis2_json_secure_fault.o \
    calcs_csv_source.o \
    -L$DEPS/lib \
    -Wl,--whole-archive $DEPS/lib/libaxis2_engine.a -Wl,--no-whole-archive \
    $DEPS/lib/libaxis2_deployment.a \
    $DEPS/lib/libaxis2_description.a \
    $DEPS/lib/libaxis2_context.a \
    $DEPS/lib/libaxis2_phaseresolver.a \
    $DEPS/lib/libaxis2_core_utils.a \
    $DEPS/lib/libaxis2_http_common.a \
    $DEPS/lib/libaxis2_http_util.a \
    $DEPS/lib/libaxis2_h2_transport.a \
    $DEPS/lib/libaxis2_h2_sender.a \
    $DEPS/lib/libaxis2_axiom.a \
    $DEPS/lib/libaxis2_axiom_util.a \
    $DEPS/lib/libaxis2_parser.a \
    $DEPS/lib/libaxis2_soap.a \
    $DEPS/lib/libaxis2_addr.a \
    $DEPS/lib/libaxis2_xpath.a \
    $DEPS/lib/libaxis2_unix.a \
    $DEPS/lib/libaxis2_attachments.a \
    $DEPS/lib/libaxis2_clientapi.a \
    $DEPS/lib/libaxutil.a \
    $DEPS/lib/libneethi.a \
    $DEPS/lib/libguththila.a \
    $DEPS/lib/libpcre2-8.a \
    -ljson-c \
    $DEPS/lib/libnghttp2.a \
    $DEPS/lib/libaprutil-1.a \
    $DEPS/lib/libexpat.a \
    $DEPS/lib/libapr-1.a \
    -lssl -lcrypto -lm -llog -ldl -pthread \
    -Wl,-z,max-page-size=16384
$STRIP kanaha-calcs-mcp
cp kanaha-calcs-mcp $OUTPUT_DIR/libkanaha_mcp.so
echo "=== Done: $OUTPUT_DIR/libkanaha_mcp.so ==="
ls -la $OUTPUT_DIR/libkanaha_mcp.so

echo ""
echo "Next: cd $SCRIPT_DIR/kanaha-calcs-app && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug"
echo "Then: adb install -r app/build/outputs/apk/debug/app-debug.apk"
