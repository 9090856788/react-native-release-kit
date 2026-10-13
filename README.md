# react-native-release-kit

> Production-ready CI/CD configuration, native builds, and store deployment for React Native CLI applications.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

React Native developers spend far too much time configuring GitHub Actions, native build tools, signing certificates, and store publishing.

**`react-native-release-kit`** reduces repetitive setup by:
- Automatically detecting project toolchains (React Native version, package manager, Android Gradle, iOS schemes).
- Running comprehensive environment diagnostics (`doctor`).
- Generating typed configuration files (`init`).
- Generating secure, best-practice GitHub Actions CI/CD workflows (`setup`).
- Validating build prerequisites and signing secret names without leaking credentials.

---

## Requirements & Compatibility

- **Node.js**: `>= 18.0.0` (Active and Maintenance LTS: Node 18, 20, 22, 24).
- **React Native**: React Native CLI applications (0.70+ through latest).
- **Package Managers**: `npm`, `yarn`, `pnpm`, and `bun`.
- **Platforms**:
  - **Android**: Linux / macOS / Windows with JDK 17+ and Android SDK.
  - **iOS**: macOS with Xcode 15+ and CocoaPods.

---

## Installation & Quick Start

You can run `react-native-release-kit` directly via `npx` inside your React Native project:

```bash
# 1. Initialize configuration interactively
npx react-native-release-kit init

# 2. Check local environment and prerequisites
npx react-native-release-kit doctor

# 3. Generate GitHub Actions CI/CD workflows
npx react-native-release-kit setup --provider github-actions
```

Or install it as a dev dependency:

```bash
npm install --save-dev react-native-release-kit
# or
yarn add -D react-native-release-kit
# or
pnpm add -D react-native-release-kit
```

---

## CLI Commands

### `init`
Detects project settings and generates `react-native-release.config.ts`.

```bash
# Interactive setup
npx react-native-release-kit init

# Headless / CI setup accepting auto-detected defaults
npx react-native-release-kit init --yes

# Preview configuration without writing to disk
npx react-native-release-kit init --dry-run

# Overwrite existing configuration file
npx react-native-release-kit init --force
```

### `doctor`
Validates your development environment, SDKs, and configuration.

```bash
npx react-native-release-kit doctor

# Skip platform checks
npx react-native-release-kit doctor --skip-ios
npx react-native-release-kit doctor --skip-android

# Machine-readable JSON output for CI diagnostics
npx react-native-release-kit doctor --json
```

### `setup`
Generates secure, deterministic GitHub Actions CI/CD workflows tailored to your project.

```bash
# Generate GitHub Actions workflows
npx react-native-release-kit setup --provider github-actions

# Dry-run preview without modifying disk
npx react-native-release-kit setup --dry-run

# Inspect unified diff against existing workflow files
npx react-native-release-kit setup --diff

# Overwrite existing workflow files without prompting
npx react-native-release-kit setup --force
```

#### Generated Workflows:
1. **PR Validation** (`.github/workflows/pr-validation.yml`):
   - Triggers on pull requests to your `mainBranch`.
   - Concurrency group with `cancel-in-progress: true`.
   - Least-privilege permissions (`contents: read`, `pull-requests: read`).
   - Frozen/immutable lockfile install (`npm ci`, `yarn install --immutable`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`).
   - Automatically runs available quality check scripts (`lint`, `typecheck`, `test`).
2. **Main Branch Build** (`.github/workflows/main-build.yml`):
   - Triggers on pushes to `mainBranch` and manual `workflow_dispatch`.
   - Concurrency group with `cancel-in-progress: false`.
   - Validates code quality and builds Android debug validation artifacts (`assembleDebug` or `bundleDebug`) when Android is enabled.
   - Archives native artifacts with configurable retention (`artifactRetentionDays`, default 14 days).
3. **Release Tag Deployment** (`.github/workflows/release-tag.yml`):
   - Triggers on tags matching `releaseTagPattern` (e.g. `v*`) and manual `workflow_dispatch`.
   - Builds Android release artifacts (`bundleRelease` or `assembleRelease`).
   - Store publishing is disabled by default for safety; can be toggled via `githubActions.storePublishing`.


### `build`
Triggers local native release builds with validated configurations.

```bash
# Build Android App Bundle (.aab)
npx react-native-release-kit build --platform android

# Build iOS archive (.ipa) (macOS only)
npx react-native-release-kit build --platform ios
```

### `deploy`
Coordinates publishing to distribution tracks.

```bash
# Deploy Android to Google Play Internal track
npx react-native-release-kit deploy --platform android --track internal

# Deploy iOS to TestFlight
npx react-native-release-kit deploy --platform ios
```

---

## Configuration (`react-native-release.config.ts`)

Create or edit your configuration using `defineConfig`:

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
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    deploymentTrack: 'internal',
    applicationId: 'com.myawesomeapp',
    packagePath: 'android',
  },
  ios: {
    enabled: true,
    buildArtifact: 'ipa',
    scheme: 'MyAwesomeApp',
    bundleId: 'com.myawesomeapp',
    exportMethod: 'app-store',
    packagePath: 'ios',
  },
  githubActions: {
    enabled: true,
    triggers: {
      pullRequest: true,
      main: true,
      releaseTags: true,
    },
    cacheDependencies: true,
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
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
    },
    ios: {
      appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
      appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
    },
  },
});
```

### Configuration Format & Precedence

`react-native-release-kit` defaults to and recommends `react-native-release.config.ts` using `defineConfig()` for full TypeScript type safety.

The configuration loader resolves files deterministically in the following precedence order:
1. `react-native-release.config.ts` *(recommended)*
2. `react-native-release.config.js`
3. `react-native-release.config.mjs`
4. `react-native-release.config.cjs`
5. `react-native-release.config.json`

If multiple configuration files exist in the same directory, `react-native-release-kit` uses the highest precedence file and emits a warning diagnostic.

---

## Security Perimeter

- **No Secrets Stored**: Passwords, private keys, and API tokens are never written into generated files.
- **Secret Name Validation**: Secret validators inspect and enforce standardized secret names (e.g. `ANDROID_KEYSTORE_BASE64`), never their sensitive contents.
- **Masking & Sanitization**: Internal logs filter out tokens, passwords, and API keys.
- **Immutable Actions**: GitHub Action templates pin third-party actions to full commit SHAs.

---

## License

MIT © [react-native-release-kit contributors](LICENSE)
