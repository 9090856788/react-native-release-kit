import type { ReleaseKitUserConfig, PackageManager } from './schema.js';

export function getDefaultScripts(pm: PackageManager = 'npm') {
  const runner = pm === 'npm' ? 'npm run' : pm;
  const testRunner = pm === 'npm' ? 'npm test' : `${pm} test`;
  return {
    lint: `${runner} lint`,
    typecheck: `${runner} typecheck`,
    test: testRunner,
  };
}

export function createDefaultConfig(
  projectName: string,
  pm: PackageManager = 'npm',
): ReleaseKitUserConfig {
  return {
    projectName,
    packageManager: pm,
    projectRoot: '.',
    scripts: getDefaultScripts(pm),
    android: {
      enabled: true,
      buildArtifact: 'aab',
      buildTask: 'bundleRelease',
      deploymentTrack: 'internal',
      packagePath: 'android',
    },
    ios: {
      enabled: true,
      buildArtifact: 'ipa',
      scheme: projectName,
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
        appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
        appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
        appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
      },
    },
  };
}
