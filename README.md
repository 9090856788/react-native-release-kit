# react-native-release-kit

> Production-ready CI/CD configuration, native builds, release signing, and store deployment automation for React Native CLI applications.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![npm version](https://img.shields.io/badge/npm-v1.0.0-blue.svg)](https://www.npmjs.com/package/react-native-release-kit)

React Native developers frequently struggle with brittle CI/CD configurations, missing signing credentials on clean runners, unsafe debug signing in production, and cumbersome store publishing setups.

**`react-native-release-kit`** provides a unified, production-grade release toolchain for bare React Native CLI applications:
- **Toolchain & Project Detection**: Automatically identifies package managers (`npm`, `yarn`, `pnpm`, `bun`), Android Gradle modules and flavors, and iOS Xcode workspaces and schemes.
- **Environment Diagnostics (`doctor`)**: Validates development dependencies, JDK, Android SDK, Xcode, CocoaPods, and signing configurations with clear remediation steps.
- **Automated Workflow Generation (`setup`)**: Generates deterministic, security-hardened GitHub Actions workflows pinned to immutable action commit SHAs.
- **Fastlane Deployment Configuration**: Automatically creates unified `fastlane/Appfile` and `fastlane/Fastfile` templates for Android and iOS store tracks.
- **Local Native Builds (`build`)**: Executes repository Gradle wrappers (`./gradlew`) with safe task resolution, temporary keystore provisioning, and artifact verification.
- **Store Publishing & Safeguards (`deploy`)**: Publishes to Google Play tracks via Fastlane with built-in production rollout confirmation safeguards.
- **Zero Secret Leakage**: Restricts temporary signing credentials to `0600` file permissions, registers process termination hooks, and masks secrets in all logs and child-process streams.

---

## Requirements & Compatibility

| Component | Supported Versions & Platforms |
|---|---|
| **Node.js** | `>= 18.0.0` (Active and Maintenance LTS: Node 18, 20, 22, 24) |
| **React Native** | React Native CLI (bare workflow) `0.70+` through latest |
| **Package Managers** | `npm`, `yarn` (Classic v1 and Berry v2/v3/v4), `pnpm`, `bun` |
| **Android** | Linux, macOS, or Windows with OpenJDK 17+ and Android SDK |
| **iOS** | macOS with Xcode 15+ and CocoaPods |

> [!NOTE]
> **Bare React Native CLI Only**: `react-native-release-kit` is designed specifically for bare React Native CLI applications. For Expo Managed applications, use EAS Build and EAS Submit.

---

## Quick Start

You can run `react-native-release-kit` directly via `npx` without prior installation:

```bash
# 1. Initialize configuration interactively
npx react-native-release-kit init

# 2. Check local environment and prerequisites
npx react-native-release-kit doctor

# 3. Generate CI/CD workflows and Fastlane deployment files
npx react-native-release-kit setup --provider github-actions --fastlane

# 4. Preview your Android release build task
npx react-native-release-kit build --platform android --variant release --dry-run
```

Or install it as a development dependency:

```bash
# npm
npm install --save-dev react-native-release-kit

# yarn
yarn add -D react-native-release-kit

# pnpm
pnpm add -D react-native-release-kit

# bun
bun add -d react-native-release-kit
```

---

## Local vs. CI Capabilities

To keep your local development environment safe and predictable, certain operations run locally while others are designed exclusively for clean CI runners:

| Operation | Local CLI (`npx react-native-release-kit ...`) | GitHub Actions CI Runner |
|---|---|---|
| **Project Detection & Diagnostics** | Supported (`doctor`, `init`) | Supported (`doctor --json`) |
| **Workflow Generation** | Supported (`setup`) | N/A (Generated ahead of time) |
| **Android Debug & Release Build** | Supported via repo `./gradlew` | Supported via `main-build.yml` and `release-tag.yml` |
| **Android Release Signing** | Supported with local keystore or base64 env | Supported via GitHub Secrets |
| **Google Play Deployment** | Supported (`deploy --platform android`) | Supported via `release-tag.yml` |
| **iOS Simulator Build** | Supported on macOS with Xcode installed | Supported via `main-build.yml` |
| **iOS Release Archive & Export** | Supported on macOS with Xcode installed | Supported via `release-tag.yml` |
| **iOS TestFlight Deployment** | **Unsupported locally** (redirects to CI) | Supported via `release-tag.yml` |

> [!IMPORTANT]
> **Why Local iOS Publishing is Unsupported**:
> Deploying iOS builds to TestFlight requires provisioning developer profiles, distribution certificates, and temporary keychain management that should not mutate a developer's local macOS keychain. `deploy --platform ios` returns exit code 1 and directs developers to run deployment through the generated GitHub Actions release workflow.

---

## CLI Commands

### `init`
Detects project toolchains and generates a typed configuration file.

```bash
# Interactive setup with prompts
npx react-native-release-kit init

# Headless setup accepting auto-detected defaults
npx react-native-release-kit init --yes

# Preview configuration without writing to disk
npx react-native-release-kit init --dry-run

# Overwrite existing configuration file
npx react-native-release-kit init --force

# Choose configuration format (ts, js, or json)
npx react-native-release-kit init --format ts
```

### `doctor`
Validates development dependencies, SDK installations, native project files, and signing configuration.

```bash
# Run all diagnostics
npx react-native-release-kit doctor

# Skip platform-specific checks
npx react-native-release-kit doctor --skip-android
npx react-native-release-kit doctor --skip-ios

# Output machine-readable JSON for CI integration
npx react-native-release-kit doctor --json
```

### `setup`
Generates secure GitHub Actions workflows and Fastlane configuration files.

```bash
# Generate GitHub Actions workflows (.github/workflows/)
npx react-native-release-kit setup --provider github-actions

# Generate Fastlane deployment files (fastlane/Appfile, fastlane/Fastfile)
npx react-native-release-kit setup --fastlane

# Generate both GitHub Actions workflows and Fastlane files
npx react-native-release-kit setup --provider github-actions --fastlane

# Dry-run preview without modifying disk
npx react-native-release-kit setup --dry-run

# Inspect unified git-style diff against existing workflow files
npx react-native-release-kit setup --diff

# Overwrite existing workflow files without prompting
npx react-native-release-kit setup --force
```

#### Generated Workflows:
1. **PR Validation** (`.github/workflows/pr-validation.yml`):
   - Triggers on pull requests targeting `githubActions.mainBranch`.
   - Concurrency group with `cancel-in-progress: true` to conserve runner minutes.
   - Least-privilege permissions (`contents: read`, `pull-requests: read`).
   - Immutable lockfile installs (`npm ci`, `yarn install --immutable`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`).
   - Executes detected quality scripts (`lint`, `typecheck`, `test`).
   - **Secrets Isolation**: Release signing secrets and store credentials are never loaded or exposed to PR workflows.
2. **Main Branch Build** (`.github/workflows/main-build.yml`):
   - Triggers on push to `githubActions.mainBranch` and manual `workflow_dispatch`.
   - Runs code quality checks and builds native validation artifacts (Android `bundleDebug` / `assembleDebug` and iOS simulator build).
   - Archives native build outputs with configurable retention (`artifactRetentionDays`, default 14 days).
3. **Release Tag Deployment** (`.github/workflows/release-tag.yml`):
   - Triggers on tags matching `releaseTagPattern` (e.g. `v*`) and manual `workflow_dispatch`.
   - Preflights and provisions Android release signing keystore and iOS distribution certificates into temporary keychains.
   - Builds Android release App Bundle (`bundleRelease`) and iOS IPA artifact (`xcodebuild archive` + `exportArchive`).
   - Uploads to Google Play tracks and Apple TestFlight when `githubActions.storePublishing` is enabled.
   - Cleans up temporary keystores and keychains in `if: always()` steps.

### `build`
Validates prerequisites, provisions signing credentials, and executes native compilation.

```bash
# Build Android release App Bundle (.aab) (default)
npx react-native-release-kit build --platform android --variant release --artifact aab

# Build Android debug APK (.apk)
npx react-native-release-kit build --platform android --variant debug --artifact apk

# Build with custom application module and product flavor
npx react-native-release-kit build --platform android --module clientApp --flavor staging --artifact apk

# Build with release signing verification and keystore provisioning
npx react-native-release-kit build --platform android --variant release --sign

# Validate prerequisites and resolve Gradle task without executing native build
npx react-native-release-kit build --platform android --variant release --dry-run
```

### `deploy`
Validates built artifacts and store credentials, then uploads to Google Play tracks via Fastlane.

```bash
# Deploy Android release to Google Play Internal testing track (default)
npx react-native-release-kit deploy --platform android --track internal

# Deploy to Google Play Closed testing track with explicit artifact path
npx react-native-release-kit deploy --platform android --track closed --artifact-path android/app/build/outputs/bundle/release/app-release.aab

# Deploy to Google Play Production track (requires confirmation safeguard)
npx react-native-release-kit deploy --platform android --track production --confirm-production

# Validate artifact and credentials without uploading to the store
npx react-native-release-kit deploy --platform android --track internal --dry-run
```

---

## Android Setup Guide

### 1. SDK & Environment Prerequisites
- **Java**: Install OpenJDK 17 and ensure `JAVA_HOME` is set.
- **Android SDK**: Set `ANDROID_HOME` or define `sdk.dir` in `android/local.properties`.
- **Gradle Wrapper**: Always commit `android/gradlew`, `android/gradlew.bat`, and `android/gradle/wrapper/` to source control.

### 2. Keystore Generation & Base64 Encoding
Generate an upload keystore if you do not already have one:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore release.keystore \
  -alias my-upload-key -keyalg RSA -keysize 2048 -validity 10000
```

Encode the keystore file as base64 for CI secrets:

```bash
# macOS
base64 -i release.keystore | tr -d '\n'

# Linux
base64 -w 0 release.keystore
```

### 3. Safe `build.gradle` Signing Configuration

> [!CAUTION]
> **Never Hardcode Debug Signing in Release**:
> Do **not** use `release { signingConfig signingConfigs.debug }`. Google Play strictly rejects release artifacts signed with debug keys. `react-native-release-kit doctor`, `build --sign`, and `deploy` detect this condition and halt with actionable guidance.

Configure your `android/app/build.gradle` (or custom module) to read environment variables provisioned by `react-native-release-kit`:

#### Groovy DSL (`android/app/build.gradle`)
```groovy
android {
    signingConfigs {
        release {
            def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (keystorePath != null && !keystorePath.isEmpty()) {
                storeFile file(keystorePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            } else if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                storeFile file(MYAPP_UPLOAD_STORE_FILE)
                storePassword MYAPP_UPLOAD_STORE_PASSWORD
                keyAlias MYAPP_UPLOAD_KEY_ALIAS
                keyPassword MYAPP_UPLOAD_KEY_PASSWORD
            }
        }
    }
    buildTypes {
        release {
            // Use release signing when storeFile is configured, falling back to debug only for local tests
            signingConfig signingConfigs.release.storeFile != null ? signingConfigs.release : signingConfigs.debug
        }
    }
}
```

#### Kotlin DSL (`android/app/build.gradle.kts`)
```kotlin
android {
    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!keystorePath.isNullOrEmpty()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            } else if (project.hasProperty("MYAPP_UPLOAD_STORE_FILE")) {
                storeFile = file(project.property("MYAPP_UPLOAD_STORE_FILE") as String)
                storePassword = project.property("MYAPP_UPLOAD_STORE_PASSWORD") as String
                keyAlias = project.property("MYAPP_UPLOAD_KEY_ALIAS") as String
                keyPassword = project.property("MYAPP_UPLOAD_KEY_PASSWORD") as String
            }
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
                ?: signingConfigs.getByName("debug")
        }
    }
}
```

### 4. Google Play Store Console Setup
1. In **Google Cloud Console**, enable the **Google Play Android Developer API** and create a Service Account JSON key.
2. In **Google Play Console -> Users and permissions**, invite the Service Account email and grant **Release to testing tracks** (and **Release to production** if deploying to production).
3. **Mandatory First Upload**: Upload your very first APK or AAB manually in the Google Play Console web interface. The Google Play API rejects programmatic uploads for applications that have never had an initial manual upload.

---

## iOS Setup Guide

### 1. macOS & Toolchain Prerequisites
- **Xcode**: Install Xcode 15+ and the command-line developer tools (`xcode-select --install`).
- **CocoaPods**: Ensure CocoaPods is installed (`bundle exec pod install` or `pod install`).

### 2. Apple Certificates & Provisioning Profiles
Export your Apple Distribution Certificate (`.p12`) and App Store Provisioning Profile (`.mobileprovision`), then base64-encode them:

```bash
# Base64 encode .p12 certificate
base64 -i distribution.p12 | tr -d '\n'

# Base64 encode provisioning profile
base64 -i AppStore.mobileprovision | tr -d '\n'
```

### 3. App Store Connect API Key
1. In **App Store Connect -> Users and Access -> Integrations -> App Store Connect API**, generate an API Key with **App Manager** or **Admin** access.
2. Record the **Key ID** (10 characters, e.g. `2X9R4HXF34`) and **Issuer ID** (UUID format).
3. Download the private key file (`AuthKey_XXXXXXXXXX.p8`). Provide the key content directly or as base64 in GitHub Secrets.

### 4. Bundle Identifier Validation
`react-native-release-kit` validates your `ios.bundleId`:
- Must follow valid reverse-DNS syntax (e.g. `com.example.myapp`).
- Placeholders (such as `org.reactjs.native.example.*`) and unresolved Xcode macros (such as `$(PRODUCT_NAME:rfc1034identifier)`) are permitted during local debug builds, but are strictly blocked for production store deployment.

---

## Required GitHub Actions Secrets

Configure these repository secrets in **GitHub -> Settings -> Secrets and variables -> Actions**:

### Android Secrets
| Secret Name | Required For | Description |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Signed Android Builds & Release Tag | Base64-encoded upload `.keystore` / `.jks` file |
| `ANDROID_KEYSTORE_PASSWORD` | Signed Android Builds & Release Tag | Keystore password |
| `ANDROID_KEY_ALIAS` | Signed Android Builds & Release Tag | Signing key alias name |
| `ANDROID_KEY_PASSWORD` | Signed Android Builds & Release Tag | Signing key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play Store Publishing | Raw or base64-encoded Google Cloud Service Account JSON key |

### iOS Secrets
| Secret Name | Required For | Description |
|---|---|---|
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64` | iOS Release Archive & IPA Export | Base64-encoded `.p12` distribution certificate |
| `IOS_CERTIFICATE_PASSWORD` | iOS Release Archive & IPA Export | Password for the `.p12` certificate |
| `IOS_PROVISIONING_PROFILE_BASE64` | iOS Release Archive & IPA Export | Base64-encoded `.mobileprovision` distribution profile |
| `APP_STORE_CONNECT_API_KEY_KEY_CONTENT` | TestFlight Store Publishing | `.p8` API key content (raw PEM or base64) |
| `APP_STORE_CONNECT_API_KEY_KEY_ID` | TestFlight Store Publishing | 10-character App Store Connect Key ID |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | TestFlight Store Publishing | App Store Connect Issuer UUID |
| `IOS_TEAM_ID` (or `APPLE_TEAM_ID`) | Optional Team ID Override | 10-character Apple Developer Team ID |

---

## Configuration Reference (`react-native-release.config.ts`)

### Configuration Precedence
1. **CLI Flags**: Command-line arguments (`--variant`, `--artifact`, `--track`, `--module`) override all other settings.
2. **Configuration File**: Values explicitly defined in `react-native-release.config.ts` (or `.js`, `.mjs`, `.cjs`, `.json`).
3. **Project Detection**: Dynamic values detected from `package.json`, Gradle files, and Xcode projects.
4. **Library Defaults**: Built-in defaults applied by the Zod runtime schema.

### Complete Generic Configuration Example

```typescript
import { defineConfig } from 'react-native-release-kit';

export default defineConfig({
  projectName: 'MyAwesomeApp',
  packageManager: 'yarn',
  projectRoot: '.',
  scripts: {
    lint: 'yarn lint',
    typecheck: 'yarn tsc --noEmit',
    test: 'yarn test',
  },
  android: {
    enabled: true,
    buildVariant: 'release',
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    appModule: 'app',
    flavor: 'production',
    deploymentTrack: 'internal',
    releaseStatus: 'draft',
    applicationId: 'com.example.myawesomeapp',
    packagePath: 'android',
    publishStore: false,
    allowProductionPublish: false,
  },
  ios: {
    enabled: true,
    buildArtifact: 'ipa',
    scheme: 'MyAwesomeApp',
    workspace: 'ios/MyAwesomeApp.xcworkspace',
    bundleId: 'com.example.myawesomeapp',
    teamId: 'TEAMID1234',
    exportMethod: 'app-store',
    packagePath: 'ios',
    publishStore: false,
    uploadToTestFlight: false,
  },
  githubActions: {
    enabled: true,
    mainBranch: 'main',
    releaseTagPattern: 'v*',
    artifactRetentionDays: 14,
    triggers: {
      pullRequest: true,
      main: true,
      releaseTags: true,
    },
    workflows: {
      prValidation: true,
      mainBuild: true,
      releaseTag: true,
    },
    cacheDependencies: true,
    storePublishing: false,
    runner: {
      android: 'ubuntu-latest',
      ios: 'macos-14',
    },
    nodeVersion: '20',
    javaVersion: '17',
    rubyVersion: '3.3',
  },
  signing: {
    android: {
      enabled: false,
      keystorePath: 'android/app/release.keystore',
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
      serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
    },
    ios: {
      enabled: false,
      teamId: 'TEAMID1234',
      certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
      certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
      provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
      exportMethod: 'app-store',
      appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
      appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
    },
  },
});
```

### Schema Options Table

| Field | Type | Default | Detected? | Description |
|---|---|---|---|---|
| `projectName` | `string` | **Required** | Yes | Project name used for logs, workflows, and artifact names. |
| `packageManager` | `'npm' \| 'yarn' \| 'pnpm' \| 'bun'` | `'npm'` | Yes | Package manager used for dependency installation. |
| `projectRoot` | `string` | `'.'` | No | Root directory of the React Native project. |
| `scripts.lint` | `string` | `undefined` | Yes | Custom lint command. Detected from `package.json` scripts. |
| `scripts.typecheck` | `string` | `undefined` | Yes | Custom typecheck command (e.g. `npx tsc --noEmit`). |
| `scripts.test` | `string` | `undefined` | Yes | Custom test command. Detected from `package.json` scripts. |
| `android.enabled` | `boolean` | `true` | Yes | Enable Android builds and workflow jobs. |
| `android.buildVariant` | `'debug' \| 'release'` | `'release'` | No | Default build variant. |
| `android.buildArtifact` | `'apk' \| 'aab'` | `'aab'` | No | Default artifact type (`aab` recommended for release). |
| `android.buildTask` | `string` | `'bundleRelease'` | No | Default Gradle compilation task name. |
| `android.appModule` | `string` | `'app'` | Yes | Application module name (e.g. `app`, `:mobile`, `clientApp`). |
| `android.flavor` | `string` | `undefined` | Yes | Android product flavor (e.g. `staging`, `production`). |
| `android.deploymentTrack` | `'internal' \| 'closed' \| 'production'` | `'internal'` | No | Target Google Play track for deployment. |
| `android.releaseStatus` | `'draft' \| 'completed' \| 'inProgress' \| 'halted'` | `'draft'` | No | Rollout status for Google Play releases. |
| `android.applicationId` | `string` | `undefined` | Yes | Android package name / application ID. |
| `android.packagePath` | `string` | `'android'` | No | Relative path to the Android native directory. |
| `android.publishStore` | `boolean` | `false` | No | Toggle automated store uploads in generated Fastlane lanes. |
| `android.allowProductionPublish` | `boolean` | `false` | No | Authorize production track deployment without CLI prompt. |
| `ios.enabled` | `boolean` | `true` | Yes | Enable iOS builds and workflow jobs. |
| `ios.buildArtifact` | `'ipa' \| 'app'` | `'ipa'` | No | iOS build artifact type. |
| `ios.scheme` | `string` | `undefined` | Yes | Xcode scheme name (e.g. `MyApp`). |
| `ios.workspace` | `string` | `undefined` | Yes | Path to `.xcworkspace` or fallback `.xcodeproj`. |
| `ios.bundleId` | `string` | `undefined` | Yes | iOS bundle identifier (e.g. `com.example.myapp`). |
| `ios.teamId` | `string` | `undefined` | No | 10-character Apple Developer Team ID. |
| `ios.exportMethod` | `'app-store' \| 'ad-hoc' \| 'development' \| 'enterprise'` | `'app-store'` | No | Export method for IPA generation. |
| `ios.packagePath` | `string` | `'ios'` | No | Relative path to the iOS native directory. |
| `githubActions.enabled` | `boolean` | `true` | No | Enable GitHub Actions workflow generation. |
| `githubActions.mainBranch` | `string` | `'main'` | No | Primary branch for PRs and post-merge builds. |
| `githubActions.releaseTagPattern` | `string` | `'v*'` | No | Tag pattern that triggers release deployment. |
| `githubActions.artifactRetentionDays` | `number` (1-90) | `14` | No | Retention period for CI build artifacts. |
| `githubActions.triggers.pullRequest` | `boolean` | `true` | No | Enable PR validation workflow. |
| `githubActions.triggers.main` | `boolean` | `true` | No | Enable main-branch build workflow. |
| `githubActions.triggers.releaseTags` | `boolean` | `true` | No | Enable release tag deployment workflow. |
| `githubActions.storePublishing` | `boolean` | `false` | No | Enable store upload steps in release tag workflow. |

---

## Production Publishing Safeguards

Publishing to the Google Play `production` track rolls out native code to end users. `react-native-release-kit` enforces safeguards to prevent accidental rollouts:

1. **Explicit Confirmation**: Local deployment to `production` requires either the `--confirm-production` CLI flag or setting `android.allowProductionPublish: true` in your configuration.
2. **Release Signing Check**: Deploying to `production` verifies that `build.gradle` has a dedicated `signingConfigs.release` block and is not falling back to debug signing.
3. **Artifact Integrity Check**: Verifies the artifact exists, has a valid extension (`.aab` or `.apk`), and is non-empty (`size > 0 bytes`).
4. **Draft Status by Default**: Releases default to `releaseStatus: 'draft'`, allowing review in the Google Play Console before activating full rollout.

---

## Troubleshooting Guide

| Error / Symptom | Probable Cause | Actionable Resolution |
|---|---|---|
| `No valid react-native-release.config.ts found` | Configuration file is missing or contains syntax errors | Run `npx react-native-release-kit init` or inspect syntax error details printed by the CLI. |
| `Unsafe Android release signing detected` | `build.gradle` uses `signingConfig signingConfigs.debug` for release | Configure a dedicated release signing block backed by environment variables (see [Android Signing Setup](#3-safe-buildgradle-signing-configuration)). |
| `Missing required Android release signing environment variables` | `build --sign` was called without exporting keystore variables | Export `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. |
| `Missing Google Play service account credentials` | Service account JSON was not found in environment | Export `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` or point `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH` to your key file. |
| `Production track publishing is blocked by default` | Safeguard prevented accidental production rollout | Pass `--confirm-production` on the CLI or set `android.allowProductionPublish: true` in configuration. |
| `Local iOS store deployment via CLI is not supported` | `deploy --platform ios` was executed locally | Run iOS store deployments through GitHub Actions release workflows where clean ephemeral keychains are provisioned. |
| `apkUpgradeVersionConflict` | `versionCode` in Gradle has already been uploaded to Google Play | Increment `versionCode` in `android/app/build.gradle`, rebuild the artifact, and retry. |
| `applicationNotFound` | App listing does not exist in Google Play Console | Upload your very first APK or AAB manually in Google Play Console before running automated uploads. |
| `File(s) already exist and differ from proposed output` | `setup` detected modified workflow files | Review differences with `setup --diff` or use `setup --force` to overwrite. |
| `iOS bundleId uses a default placeholder prefix` | Bundle ID contains `org.reactjs.native.example` | Configure a registered reverse-DNS identifier in `ios.bundleId` (e.g. `com.example.myapp`). |

---

## Security Architecture

- **Zero Stored Secrets**: Passwords, private keys, keystores, and service-account credentials are never written into source code or committed workflow files.
- **Ephemeral Credential Lifecycle**: Keystores and service-account keys decoded during local CLI builds or CI workflows are created with restrictive `0o600` permissions and unlinked immediately after use.
- **Process Termination Hooks**: Local processes register `process.once('exit')`, `SIGINT`, and `SIGTERM` listeners ensuring temporary credential removal even upon interruption.
- **Output Masking**: All registered secrets, base64 payloads, passwords, and PEM private keys are redacted as `[REDACTED]` from terminal logs, error traces, and child-process streams.
- **Immutable Action SHAs**: Generated GitHub Actions pin third-party actions to immutable full 40-character commit SHAs.

---

## Real Builds vs. Workflow Generation Disclaimer

`react-native-release-kit setup` generates syntactically valid, security-hardened workflow definitions tailored to your project's layout. However, **workflow generation and dry-run validations do not replace executing real native builds**. Native build success depends on your local environment (Java, Android SDK, Xcode, CocoaPods) and valid signing credentials registered with Apple and Google.

---

## License

MIT © [react-native-release-kit contributors](LICENSE)
