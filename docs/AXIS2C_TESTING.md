# Where the Axis2/C service code gets tested, and where it cannot

The three calculations this app serves natively are not implemented here. They
live in the Apache Axis2/C tree, at

    samples/user_guide/financial-benchmark-service/src/

and `build-android.sh` compiles that source directly (`AXIS2_SRC` points at the
checkout). The same files are built and run on x86-64 Linux, so most testing
happens there rather than on a phone. This note records what that testing does
and does not cover, because the difference is not obvious and the Android build
is the worst place to discover a memory bug.

## What runs where

| | AddressSanitizer | Full Axis2/C suite | Notes |
|---|---|---|---|
| GitHub Actions CI | yes, both transports | yes | `http1` and `http2` matrix legs |
| x86-64 workstation | yes | yes | 44/44 http1, 39/39 http2 |
| LAN build server | **no** | yes | 39/39, `--enable-http2`, no `-fsanitize` |
| **This app, on device** | **no** | **no** | see below |

The two transport configurations build *disjoint* test sets, which is why the
counts differ: `--enable-http2` swaps the HTTP/1.1 standalone-server and
clientapi tests for `h2_json_integration_test`,
`h2_performance_benchmark_test` and `test_http_service_provider_interface`. A
lower number is the configuration, not missing tests.

## Why there is no sanitizer on the device

ASan on Android is possible in principle but not worth it here. It needs the
sanitizer runtime shipped in the APK and `wrap.sh` in place, roughly doubles
memory use, and the interesting allocations belong to httpd and Axis2/C rather
than to app code. Every fault it could find on arm64 is reachable on x86 with a
faster edit-run cycle and a real debugger.

**So: reproduce on x86 first.** If a calculation misbehaves on the phone, run
the same request against the service on a desktop build under ASan before
touching anything here. Debugging that class of bug through logcat, with a
twenty-minute cross-compile per iteration, is time thrown away.

## What x86 testing does NOT cover

Three things differ on Android, and none of them are exercised by any test on
the other side.

**The dispatch path is Android-only.** `build-android.sh` deliberately excludes
`financial_benchmark_service_handler.o` from the link: it exports a four-argument
`financial_benchmark_service_invoke_json(svc, env, json_str, msg_ctx)` that
collides with the two-argument
`financial_benchmark_service_invoke_json(env, json_object*)` in
`app/src/main/cpp/finbench_static_adapter.c`. On the desktop the four-argument
form is what the engine calls; on Android the adapter is. **The adapter and the
routing it does have no test coverage anywhere.** The maths underneath is shared
and well covered; the thing that decides which calculation runs is not.

**Char signedness.** `axis2_char_t` is plain `char`, signed on x86 and unsigned
on arm64. Axis2/C now pins it with `-fsigned-char` in all seven of its
configure.ac files, and this app passes the same flag on its five compile lines,
so the two agree. If either side loses the flag they stop agreeing and x86
results stop transferring — that is the whole reason it is there.

**Static linking, and the weak symbol that makes it work.** Services here are
linked into `libkanaha_calcs_httpd.so` rather than dlopened from a services
directory. The engine reaches them through its Android static registry:
`android_static_service_lookup()` in
`src/core/receivers/axis2_json_rpc_msg_recv.c` maps a service name to a weak
`<service>_invoke_json` stub, and `app/src/main/cpp/finbench_static_adapter.c`
provides the strong two-argument definition that overrides it at link time.
This is the same arrangement kanaha-camera uses.

There is no fallback. The class-loader route cannot serve this service: it needs
`axis2_get_instance`, which lives in `financial_benchmark_service_handler.c` —
the object `build-android.sh` must exclude, because it exports a four-argument
`financial_benchmark_service_invoke_json` that collides with the adapter's
two-argument one. Same symbol name, different parameter lists. So the registry
entry is not an optimisation, it is the only way in.

**That entry went missing once.** The APK built 2026-05-07 has all three names
compiled into its registry — verifiable without a device, because the build uses
`-Wl,--export-dynamic` so `.dynsym` survives stripping:

```sh
nm -D libkanaha_calcs_httpd.so | grep android_static_service_lookup   # note address
llvm-objdump -d --start-address=<addr> --stop-address=<addr+0xc0> libkanaha_calcs_httpd.so
```

Three `strcmp` calls, resolving to `CameraControlService`, `AudioSearchService`
and `FinancialBenchmarkService`. But that third entry was never committed to the
Axis2/C repository — it existed only as an uncommitted local edit. Rebuilding
the cross-compiled dependencies from a clean checkout on 2026-09-03 silently
dropped it, and a relink at that point would have broken the three native
calculations with nothing in the build to say why. It is now committed upstream
(`0f7f27bde`), so it cannot be lost that way again.

If those calculations ever stop working, check the registry before anything
else. `logcat` distinguishes the cases in one look:

    [ANDROID_STATIC] Found service '...' in static registry      <- registered
    [ANDROID_STATIC] Service '...' not in static registry        <- entry missing
    [JSON RPC MSG RECV] Android: ... trying dynamic loading      <- about to fail
    [FinBench Adapter] invoke_json called                        <- adapter reached

A `W` rather than `T` on `financial_benchmark_service_invoke_json` in `nm -D`
output means the adapter was left out of the link and only the weak stub
remains: every request returns NULL.

## Keeping the native libraries current

`build-android.sh` recompiles the service sources from the Axis2/C checkout on
every build, so those are always current. Everything it links against is not:
the static archives come from a prebuilt dependency prefix, and nothing warns
when that prefix is older than the source tree. After refreshing it, compare
timestamps across **every** library rather than a sample — a partial refresh
leaves a mixed-date directory that looks fine at a glance.
