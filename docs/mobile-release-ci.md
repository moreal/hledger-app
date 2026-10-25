# Mobile production build CI

`.github/workflows/mobile-release.yml` runs manually and for pull requests that change mobile source, shared packages, dependency locks, or release automation. Both jobs first run the dependency-free release automation tests, then call `scripts/mobile-release.mjs` in a fresh directory under the runner's temporary directory. The checked-in Expo project remains the source; generated native projects are disposable.

## Build contract

| Component | Version / setting |
| --- | --- |
| Node.js | 26.12.0 |
| Yarn | 4.12.0, activated through Corepack 0.34.0 |
| Expo / React Native / Rollipop | 58.0.16 / 0.88.0 / 1.0.0-beta.1, from the workspace lockfile |
| Android runner | `ubuntu-24.04` |
| Java | Temurin 21 |
| Android SDK / build tools | 37 / 37.0.0 |
| Android SDK repository package | `platforms;android-37.0` |
| Android command-line tools | 23.0, archive ID `16111833` |
| Android NDK / CMake | 27.1.12297006 / 3.22.1 |
| Gradle | Generated project's wrapper, 9.4.1 |
| iOS runner | `xcode-27`, Apple Silicon |
| Xcode / simulator SDK | 27.0 / 27.0 |
| Ruby / Bundler / CocoaPods | 3.4.11 / 2.6.9 / 1.17.0 |

The GitHub-hosted Xcode 27 [software inventory](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md) lists Xcode 27.0 at `/Applications/Xcode_27.0.app` and simulator SDK 27.0. CI selects that installation explicitly and rejects a mismatched version. Ruby is installed at the exact version through `ruby/setup-ruby`; Bundler installs CocoaPods and its transitive dependencies from `.github/mobile-release/Gemfile.lock` in frozen mode into a temporary directory. Hosted images still receive updates; these settings pin the requested toolchain rather than a complete immutable OS image.

Android setup explicitly requests only `platform-tools` from `android-actions/setup-android`: its default also requests the removed `tools` package, which caused the first remote run to fail. The original command-line tools version 16.0 could not discover SDK 37 through its older repository schema. The [current Google SDK repository metadata](https://dl.google.com/android/repository/repository2-3.xml) identifies the platform package as `platforms;android-37.0` and command-line tools 23.0 as archive `16111833`. CI pins those values while retaining React Native's compile SDK 37 and build tools 37.0.0.

## Verified remote run

[GitHub Actions run 40141620603](https://github.com/moreal/hledger-app/actions/runs/40141620603) completed successfully on 2026-10-24 at 23:27:38 UTC for commit `7a8ece4899c649c07daa884c1e23b3f9410f3cd7`. Both the Android production APK job and iOS production simulator app job passed and uploaded their artifacts. Android's native build reported `BUILD SUCCESSFUL in 15m 48s`. The script verifies packaged Hermes bytecode before either job succeeds. This establishes native compilation and bundling success for that exact revision; the signing and launch limitations below still apply.

## Local reproduction

Install the matching platform prerequisites above, then use absolute, fresh work and output directories:

```sh
node scripts/mobile-release.mjs --platform android --work-dir /tmp/hledger-android-work --output-dir /tmp/hledger-android-output
```

For iOS, use Ruby 3.4.11 and run the following from the repository root so the native build uses the same locked CocoaPods dependencies as CI:

```sh
gem install bundler --version 2.6.9 --no-document
export BUNDLE_GEMFILE="$PWD/.github/mobile-release/Gemfile"
export BUNDLE_PATH="/tmp/hledger-mobile-gems"
export BUNDLE_FROZEN=true
bundle _2.6.9_ install
bundle _2.6.9_ exec node scripts/mobile-release.mjs --platform ios --ios-target simulator --work-dir /tmp/hledger-ios-work --output-dir /tmp/hledger-ios-output
```

The script installs locked dependencies and generates the native project inside its work directory. Production bundling uses Rollipop. `--prepare-only` prepares the native project for inspection without compiling. `--reuse-node-modules` is an optional local acceleration; CI uses a clean install. Android architecture selection is available through `--android-architectures arm64-v8a`.

For a generic iOS device compile on a Mac, change `--ios-target simulator` to `--ios-target device` and choose fresh directories. That output is unsigned and requires a separate signing/export process before installation or store submission.

## Outputs and limitations

Each job uploads its output directory and console log with a commit-specific artifact name and seven-day retention. The artifact contains the script's `manifest.json`, native build outputs, and `mobile-ci.log`; the latter captures combined script output and is uploaded even after a build failure. The iOS app is uploaded as `ios-simulator.app.tar.gz` to preserve executable permissions and symlinks. Extract with `tar -xzf ios-simulator.app.tar.gz` before using it. The raw `.app` directory is excluded from upload.

Android produces an unsigned release APK. iOS CI produces an unsigned simulator `.app`. These builds verify native production compilation and bundling; they do not publish, sign, upload to stores, or prove launch behavior on devices. No signing credentials are required. The workflow uses read-only repository access and does not expose repository credentials to build commands.

The workflow must be run in GitHub Actions to establish remote success. Local preparation or workflow syntax checks alone do not establish that native CI passed. On failure, inspect `mobile-ci.log` and the manifest before changing toolchain versions; an unavailable pinned Xcode installation should fail visibly rather than select another Xcode automatically.

## Android local API security

Release builds permit cleartext HTTP only for exact `localhost` and `127.0.0.1`, without subdomains. Use `adb reverse tcp:4101 tcp:4101` and `http://127.0.0.1:4101/graphql` for an isolated local QA API. Other hosts, including emulator alias `10.0.2.2` and LAN addresses, require HTTPS. The base policy blocks cleartext and inherits system certificate verification; it does not add custom trust anchors or disable TLS verification. API authentication is still required. Expo prebuild generates this policy from the checked-in plugin, and the release script tests it before compiling.
