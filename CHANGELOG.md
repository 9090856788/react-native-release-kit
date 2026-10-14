# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-14

### Added
- **Multi-Project Matrix & Generic Architecture (`Phase E`)**:
  - Validated generic operation across five distinct React Native CLI project layouts: standard npm, Kotlin DSL & pnpm, Android-only & Bun, iOS-only & Yarn Berry, and custom modules with product flavors.
  - Normalized Gradle task formatting (`:<module>:<task>`) for custom modules.
  - Dynamic Fastlane scheme and workspace resolution from project detection results.
  - Dynamic module remediation guidance in diagnostic and publishing error messages.
  - Enhanced configuration loader with `jiti` cache invalidation on disk updates.
- **Reliability, Security & Failure Handling (`Phase F`)**:
  - Masked child-process stdout, stderr, and command strings at the execution boundary (`safeExec`).
  - Hardened iOS distribution certificate and provisioning profile handling with `chmod 600` and immediate `.p12` removal after keychain import.
  - Schema input validation protecting against shell metacharacters and directory traversal in `appModule`, `flavor`, `scheme`, and `packagePath`.
  - Surfaced detailed configuration error messages in `build`, `deploy`, and `setup` CLI commands.
  - Comprehensive 12-scenario Publishing Safety Matrix test suite covering unsigned/debug builds, missing credentials, production safeguards, and child-process failures.
- **Documentation & Developer Experience (`Phase G`)**:
  - Overhauled `README.md` with complete generic setup guides for Android and iOS.
  - Added Local vs. CI capabilities matrix detailing supported and unsupported local operations.
  - Added complete Configuration Reference schema table with defaults, auto-detection flags, and precedence rules.
  - Improved CLI `--help` option descriptions with default values and platform guidance.
  - Added automated documentation example tests verifying all documented TypeScript configuration snippets against runtime schemas.

## [0.3.0] - 2026-10-13

### Added
- **Android Build & Publishing Engine (`Phase 3`)**:
  - **Android Project & Module Detector (`src/detector/android.ts`)**:
    - Discovers Gradle modules via `settings.gradle(.kts)` and directory scan; detects custom application modules beyond `app` by inspecting `com.android.application` plugins.
    - Extracts `applicationId`, `namespace`, `versionCode`, `versionName`, `productFlavors` (with balanced-brace block parsing), and signing environment references.
  - **Gradle Build & Signing Adapter (`src/adapters/android.ts`)**:
    - Computes deterministic Gradle task names (`:<module>:assembleDebug`, `:<module>:assembleRelease`, `:<module>:bundleRelease`, plus flavored variants such as `:app:bundleProdRelease`).
    - Executes `./gradlew` via safe array-based subprocess invocation without shell interpolation.
    - Validates release signing variables (`ANDROID_KEYSTORE_BASE64` or `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) and provisions ephemeral `0600` keystore files cleaned up in `finally` blocks.
    - Verifies generated `.apk` and `.aab` artifacts exist on disk and are non-empty (`size > 0`).
  - **Fastlane & Google Play Publisher Adapter (`src/adapters/publisher.ts`, `src/generators/fastlane.ts`)**:
    - Supports Google Play `internal`, `closed`, `alpha`, `beta`, and `production` tracks with configurable release statuses (`draft`, `completed`, `inProgress`, `halted`).
    - Enforces production track safety guard requiring `--confirm-production` CLI flag or `android.allowProductionPublish: true`.
    - Validates Google Play Service Account JSON credentials (`type: "service_account"`, `client_email`, `private_key`, `project_id`) from file path or raw/Base64 content with ephemeral `0600` provisioning and guaranteed cleanup.
    - Classifies Google Play API errors (401/403 permission failures, duplicate `versionCode`, draft app barriers, APK vs AAB mismatch) with actionable remediation guidance.
    - Generates `android/fastlane/Appfile` and `android/fastlane/Fastfile` via `setup --fastlane`.
  - **CLI Commands (`build`, `deploy`) & GitHub Actions Integration**:
    - Implemented `build --platform android` (`--variant`, `--artifact`, `--module`, `--flavor`, `--sign`, `--dry-run`) and `deploy --platform android` (`--track`, `--release-status`, `--artifact-path`, `--confirm-production`, `--dry-run`).
    - Updated `main-build.yml` and `release-tag.yml` generators to honor custom `appModule`, `flavor`, keystore provisioning/cleanup, and conditional Fastlane Google Play uploads while keeping `pr-validation.yml` strictly isolated from secrets.
  - **Dynamic Runtime Secret Redaction (`src/utils/logger.ts`)**:
  - **Android Release Signing Refinements (`Phase C`)**:
    - **Unsafe Signing Detection**: Parser detects unsafe release signing configurations (e.g. `release { signingConfig signingConfigs.debug }`) in Groovy (`build.gradle`) and Kotlin DSL (`build.gradle.kts`).
    - **Safe Guards in CLI & Deployment**: `build --sign` and `deploy --platform android` halt early with actionable remediation if `usesDebugSigningInRelease` is detected, preventing building or deploying artifacts signed with debug keys.
    - **Config Schema Support**: Added `signing.android.keystorePath` to allow configuring local static keystore files.
    - **Gradle Property & Environment Agreement**: Local provisioning and generated `release-tag.yml` workflow export both environment variables (`ANDROID_KEYSTORE_PATH`) and Gradle project properties (`ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_FILE`, `ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PATH`), guaranteeing 100% agreement.
    - **Ephemeral Keystore & Credential Lifecycle**: Ephemeral files created with 0600 permissions are cleaned up in `finally` blocks and registered with `process.once('exit')`, `SIGINT`, and `SIGTERM` listeners.
    - **Doctor Diagnostic Check**: Added `android-release-signing` check to `doctor` command that validates dedicated release signing configs and warns against debug signing in release.

## [0.2.0] - 2026-10-12

### Added
- **GitHub Actions Workflow Generator (`Phase 2`)**:
  - `pr-validation.yml`: pull-request validation workflow on configured `mainBranch` with concurrency, least-privilege permissions, dependency caching, and dynamic project quality scripts (`lint`, `typecheck`, `test`).
  - `main-build.yml`: main branch push and `workflow_dispatch` validation build with Android debug compilation (`assembleDebug` or `bundleDebug`) and artifact uploads.
  - `release-tag.yml`: release tag push and `workflow_dispatch` deployment workflow triggering on `releaseTagPattern` (e.g. `v*`) with Android release compilation and optional store credential verification.
- **Package Manager Multi-Engine Support**:
  - Full frozen lockfile installation support: `npm ci`, `yarn install --immutable` (Yarn Berry), `yarn install --frozen-lockfile` (Yarn Classic), `pnpm install --frozen-lockfile`, and `bun install --frozen-lockfile`.
  - Recursive monorepo lockfile resolution.
  - Conflicting lockfile detection and ambiguity diagnostics.
- **Workflow Safety & Inspection Flags**:
  - `--dry-run`: previews proposed workflow files in terminal without touching the filesystem.
  - `--diff`: produces unified git-style diffs against existing workflow files without modifying disk.
  - `--force`: explicit safeguard preventing silent overwrites of modified workflows.
  - Safe unchanged detection skipping unmodified workflow rewrites.
- **Security & Reliability**:
  - Pin third-party GitHub Actions to immutable full commit SHAs with semantic version documentation comments.
  - Workflow YAML validation and GitHub Actions expression delimiter parity checks.

## [0.1.0] - 2026-10-11

### Added
- Foundation release (`Phase 1`).
- Typed configuration API with `defineConfig` and Zod runtime schema validation.
- Multi-format configuration loader (`react-native-release.config.ts`, `.js`, `.mjs`, `.cjs`, `.json`).
- Automated React Native CLI project detector (versions, native Android/iOS folder presence).
- Package manager detector (`npm`, `yarn`, `pnpm`, `bun`).
- CLI interface powered by Commander:
  - `init`: Interactive and headless project setup generating `react-native-release.config.ts`.
  - `doctor`: Comprehensive environment diagnostics for Node.js, React Native, Java/Android SDK, macOS/Xcode/CocoaPods, and config validity.
  - Registered command interfaces for `setup`, `build`, and `deploy`.
- Safe process execution and structured, secret-sanitizing logger.

