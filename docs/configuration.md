# Configuration Reference

`react-native-release-kit` configurations are written in `react-native-release.config.ts` using the type-safe `defineConfig()` helper.

## Configuration Schema

```typescript
import { defineConfig } from 'react-native-release-kit';

export default defineConfig({
  projectName: 'MyApp',                // Required: project identifier
  packageManager: 'yarn',              // 'npm' | 'yarn' | 'pnpm' | 'bun'
  projectRoot: '.',                    // Project root directory
  scripts: {
    lint: 'yarn lint',                 // Command for linting
    typecheck: 'yarn typecheck',       // Command for typecheck
    test: 'yarn test',                 // Command for test suite
  },
  android: {
    enabled: true,                     // Toggle Android build & CI
    buildArtifact: 'aab',              // 'aab' | 'apk'
    buildTask: 'bundleRelease',        // Gradle task
    deploymentTrack: 'internal',       // 'internal' | 'alpha' | 'beta' | 'production'
    applicationId: 'com.myapp',        // Android applicationId / namespace
    packagePath: 'android',            // Android directory path
  },
  ios: {
    enabled: true,                     // Toggle iOS build & CI
    buildArtifact: 'ipa',              // 'ipa' | 'app'
    scheme: 'MyApp',                   // Xcode scheme
    workspace: 'ios/MyApp.xcworkspace',// Xcode workspace
    bundleId: 'com.myapp',             // iOS bundle identifier
    exportMethod: 'app-store',         // 'app-store' | 'ad-hoc' | 'development' | 'enterprise'
    packagePath: 'ios',                // iOS directory path
  },
  githubActions: {
    enabled: true,                     // Generate GitHub Actions
    triggers: {
      pullRequest: true,               // PR verification workflow
      main: true,                      // Main branch workflow
      releaseTags: true,               // Release tag workflow
    },
    cacheDependencies: true,           // Cache node_modules/lockfiles
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

