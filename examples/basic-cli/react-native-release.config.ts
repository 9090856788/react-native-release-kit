import { defineConfig } from '../../src/index.js';

export default defineConfig({
  projectName: 'AwesomeApp',
  packageManager: 'yarn',
  projectRoot: '.',
  scripts: {
    lint: 'yarn lint',
    typecheck: 'yarn tsc --noEmit',
    test: 'yarn test --watchAll=false',
  },
  android: {
    enabled: true,
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    deploymentTrack: 'internal',
    applicationId: 'com.awesomeapp',
    packagePath: 'android',
  },
  ios: {
    enabled: true,
    buildArtifact: 'ipa',
    scheme: 'AwesomeApp',
    bundleId: 'com.awesomeapp',
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

