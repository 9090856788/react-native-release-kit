import { describe, it, expect } from 'vitest';
import {
  generatePrValidationWorkflow,
  generateMainBuildWorkflow,
  generateReleaseTagWorkflow,
  generateGitHubWorkflows,
  GITHUB_ACTIONS_SHAS,
} from '../../src/generators/github-actions.js';
import { validateWorkflowYaml } from '../../src/utils/yaml.js';
import { ReleaseKitConfigSchema, createDefaultConfig } from '../../src/config/index.js';
import type { ReleaseKitConfig } from '../../src/config/schema.js';
import type { ProjectDetectionResult } from '../../src/detector/types.js';

function getBaseConfig(): ReleaseKitConfig {
  return ReleaseKitConfigSchema.parse(createDefaultConfig('test-mobile-app', 'npm'));
}

function createMockProject(
  overrides: Partial<ProjectDetectionResult> = {},
): ProjectDetectionResult {
  return {
    projectName: 'test-mobile-app',
    isReactNative: true,
    reactNativeVersion: '0.76.1',
    packageManager: {
      manager: 'npm',
      lockfile: 'package-lock.json',
      ambiguous: false,
      isYarnBerry: false,
      installCommand: 'npm install',
      frozenInstallCommand: 'npm ci',
    },
    android: {
      hasAndroid: true,
      hasGradlew: true,
      buildGradleFound: true,
      applicationId: 'com.test.mobileapp',
    },
    ios: {
      hasIOS: true,
      hasPodfile: true,
      workspace: 'ios/TestApp.xcworkspace',
      schemes: ['TestApp'],
    },
    scripts: {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: 'jest',
    },
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<ReleaseKitConfig> = {}): ReleaseKitConfig {
  const base = getBaseConfig();
  return {
    ...base,
    ...overrides,
    githubActions: {
      ...base.githubActions,
      ...(overrides.githubActions || {}),
    },
    android: {
      ...base.android,
      ...(overrides.android || {}),
    },
    ios: {
      ...base.ios,
      ...(overrides.ios || {}),
    },
    scripts: {
      ...base.scripts,
      ...(overrides.scripts || {}),
    },
    signing: {
      ...base.signing,
      ...(overrides.signing || {}),
      android: {
        ...base.signing.android,
        ...(overrides.signing?.android || {}),
      },
      ios: {
        ...base.signing.ios,
        ...(overrides.signing?.ios || {}),
      },
    },
  };
}

describe('GitHub Actions Workflow Generators', () => {
  describe('PR Validation Workflow', () => {
    it('generates valid YAML with PR triggers, least-privilege permissions, and concurrency', () => {
      const config = createMockConfig();
      const project = createMockProject();

      const yaml = generatePrValidationWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Verify structure and content
      expect(yaml).toContain('name: PR Validation');
      expect(yaml).toContain('pull_request:\n    branches:\n      - main');
      expect(yaml).toContain('contents: read');
      expect(yaml).toContain('pull-requests: read');
      expect(yaml).toContain('cancel-in-progress: true');
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.checkout}`);
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.setupNode}`);
      expect(yaml).toContain('run: npm ci');
      expect(yaml).toContain('run: npm run lint');
      expect(yaml).toContain('run: npm run typecheck');
      expect(yaml).toContain('run: npm test');
    });

    it('respects custom main branch configuration', () => {
      const config = createMockConfig({
        githubActions: {
          ...getBaseConfig().githubActions,
          mainBranch: 'master',
        },
      });
      const project = createMockProject();

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('pull_request:\n    branches:\n      - master');
    });

    it('falls back to node --version if project has no quality check scripts', () => {
      const config = createMockConfig();
      const project = createMockProject({ scripts: {} });

      const yaml = generatePrValidationWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('name: Verify Environment');
      expect(yaml).toContain('run: node --version');
      expect(yaml).not.toContain('Run Lint');
      expect(yaml).not.toContain('Run Typecheck');
      expect(yaml).not.toContain('Run Tests');
    });

    it('generates only existing scripts when partially configured', () => {
      const config = createMockConfig();
      const project = createMockProject({
        scripts: {
          lint: 'eslint .',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('name: Run Lint');
      expect(yaml).not.toContain('Run Typecheck');
      expect(yaml).not.toContain('Run Tests');
    });

    it('skips placeholder test script and emits a warning during generation', async () => {
      const config = createMockConfig();
      const project = createMockProject({
        scripts: {
          lint: 'eslint .',
          test: 'echo "Error: no test specified" && exit 1',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('name: Run Lint');
      expect(yaml).not.toContain('Run Tests');

      const result = await generateGitHubWorkflows(config, project, '/fake/path');
      expect(result.warnings.some((w) => w.includes('unconfigured default placeholder'))).toBe(
        true,
      );
    });

    it('skips explicitly configured test script when underlying script is a placeholder', async () => {
      const config = createMockConfig({
        scripts: {
          ...getBaseConfig().scripts,
          test: 'npm test',
        },
      });
      const project = createMockProject({
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).not.toContain('Run Tests');

      const result = await generateGitHubWorkflows(config, project, '/fake/path');
      expect(result.warnings.some((w) => w.includes('unconfigured default placeholder'))).toBe(
        true,
      );
    });
  });

  describe('Main Branch Build Workflow', () => {
    it('generates valid YAML for main branch push and workflow_dispatch', () => {
      const config = createMockConfig();
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(yaml).toContain('name: Main Branch Build');
      expect(yaml).toContain('push:\n    branches:\n      - main');
      expect(yaml).toContain('workflow_dispatch:');
      expect(yaml).toContain('contents: read');
      expect(yaml).toContain('cancel-in-progress: false');
    });

    it('includes Android debug validation build job when android is enabled and detected (AAB)', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('build-android:');
      expect(yaml).toContain('name: Build Android (Debug Validation)');
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.setupJava}`);
      expect(yaml).toContain("distribution: 'zulu'");
      expect(yaml).toContain("java-version: '17'");
      expect(yaml).toContain('run: chmod +x android/gradlew');
      expect(yaml).toContain('./gradlew bundleDebug');
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}`);
      expect(yaml).toContain('path: android/app/build/outputs/bundle/debug/*.aab');
      expect(yaml).toContain('name: android-debug-${{ github.sha }}-aab');
      expect(yaml).toContain('retention-days: 14');
      expect(yaml).toContain('if-no-files-found: error');
    });

    it('builds APK when buildArtifact is apk', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'apk',
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).toContain('./gradlew assembleDebug');
      expect(yaml).toContain('path: android/app/build/outputs/apk/debug/*.apk');
      expect(yaml).toContain('name: android-debug-${{ github.sha }}-apk');
    });

    it('omits Android build job when android.enabled is false', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).not.toContain('build-android:');
      expect(yaml).not.toContain('gradlew');
    });

    it('omits Android build job when android folder does not exist', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
      });

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).not.toContain('build-android:');
    });
    it('includes iOS simulator validation build job when ios is enabled and detected', () => {
      const config = createMockConfig({
        ios: {
          ...getBaseConfig().ios,
          enabled: true,
        },
      });
      const project = createMockProject({
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/TestApp.xcworkspace',
          schemes: ['TestApp'],
        },
      });

      const yaml = generateMainBuildWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('build-ios:');
      expect(yaml).toContain('name: Build iOS (Simulator Validation)');
      expect(yaml).toContain('runs-on: macos-14');
      expect(yaml).toContain('needs: verify');
      expect(yaml).toContain('Install CocoaPods dependencies');
      expect(yaml).toContain('cd "ios"\n          pod install');
      expect(yaml).toContain(
        'xcodebuild \\\n            -workspace "ios/TestApp.xcworkspace" \\\n            -scheme "TestApp" \\\n            -configuration Debug \\\n            -sdk iphonesimulator \\\n            -destination \'generic/platform=iOS Simulator\' \\\n            -derivedDataPath "ios/build" \\\n            CODE_SIGNING_ALLOWED=NO \\\n            build',
      );
      expect(yaml).toContain(
        'uses: actions/upload-artifact@4cec3d8aa04e39d1a68397de0c4cd6fb9dce8ec1 # v4.6.1',
      );
      expect(yaml).toContain('name: ios-${{ github.sha }}-simulator');
      expect(yaml).toContain('path: ios/build/Build/Products/Debug-iphonesimulator/*.app');
      expect(yaml).toContain('if-no-files-found: error');
      expect(yaml).toContain('retention-days: 14');
    });

    it('omits iOS simulator build job when ios.enabled is false', () => {
      const config = createMockConfig({
        ios: {
          ...getBaseConfig().ios,
          enabled: false,
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).not.toContain('build-ios:');
      expect(yaml).not.toContain('iphonesimulator');
    });

    it('omits iOS simulator build job when ios folder does not exist', () => {
      const config = createMockConfig({
        ios: {
          ...getBaseConfig().ios,
          enabled: true,
        },
      });
      const project = createMockProject({
        ios: {
          hasIOS: false,
          hasPodfile: false,
          schemes: [],
        },
      });

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).not.toContain('build-ios:');
    });

    it('omits CocoaPods step in iOS job when project has no Podfile', () => {
      const config = createMockConfig();
      const project = createMockProject({
        ios: {
          hasIOS: true,
          hasPodfile: false,
          workspace: 'ios/TestApp.xcworkspace',
          schemes: ['TestApp'],
        },
      });

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).toContain('build-ios:');
      expect(yaml).not.toContain('Install CocoaPods dependencies');
    });
  });

  describe('Release Tag Deployment Workflow', () => {
    it('generates valid YAML triggering on tags matching pattern and workflow_dispatch', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          releaseTagPattern: 'v*',
          storePublishing: false,
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(yaml).toContain("tags:\n      - 'v*'");
      expect(yaml).toContain('workflow_dispatch:');
      expect(yaml).toContain('release-android:');
      expect(yaml).toContain('./gradlew bundleRelease');
      expect(yaml).toContain('path: android/app/build/outputs/bundle/release/*.aab');
      expect(yaml).toContain('Store publishing is disabled by default');
      expect(yaml).toContain('name: Android Release Signing Notice');
      expect(yaml).toContain('Automated keystore provisioning is disabled');
      expect(yaml).not.toContain('Provision Android Signing Keystore');
    });

    it('supports storePublishing=true with Android secret validation', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: true,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            keystoreSecretName: 'CUSTOM_KEYSTORE',
            keystorePasswordSecretName: 'CUSTOM_KEYSTORE_PWD',
            keyAliasSecretName: 'CUSTOM_ALIAS',
            keyPasswordSecretName: 'CUSTOM_ALIAS_PWD',
          },
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('name: Validate Store Credentials');
      expect(yaml).toContain('KEYSTORE_BASE64: ${{ secrets.CUSTOM_KEYSTORE }}');
      expect(yaml).toContain('KEYSTORE_PASSWORD: ${{ secrets.CUSTOM_KEYSTORE_PWD }}');
      expect(yaml).toContain('KEY_ALIAS: ${{ secrets.CUSTOM_ALIAS }}');
      expect(yaml).toContain('KEY_PASSWORD: ${{ secrets.CUSTOM_ALIAS_PWD }}');
      expect(yaml).toContain("Required secret 'CUSTOM_KEYSTORE' is missing.");
      expect(yaml).toContain("Required secret 'CUSTOM_KEYSTORE_PWD' is missing.");
      expect(yaml).toContain("Required secret 'CUSTOM_ALIAS' is missing.");
      expect(yaml).toContain("Required secret 'CUSTOM_ALIAS_PWD' is missing.");
      expect(yaml).toContain(
        "Required secret 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON' is missing for Google Play publishing.",
      );
      expect(yaml).toContain('Provision Android Signing Keystore');
      expect(yaml).toContain(
        "Android release keystore is empty or could not be decoded from 'CUSTOM_KEYSTORE'.",
      );
      expect(yaml).not.toContain('Android Release Signing Notice');
      expect(yaml).toContain('Cleanup Signing Keystore');
    });

    it('provisions Android keystore with custom secret names and custom env variables when signing is enabled and storePublishing is false', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: false,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            enabled: true,
            keystoreSecretName: 'CUSTOM_KEYSTORE_B64',
            keystorePasswordSecretName: 'CUSTOM_KEYSTORE_PASS',
            keyAliasSecretName: 'CUSTOM_KEY_ALIAS',
            keyPasswordSecretName: 'CUSTOM_KEY_PASS',
            keystorePathEnvName: 'CUSTOM_KEYSTORE_PATH',
          },
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('Provision Android Signing Keystore');
      expect(yaml).toContain('KEYSTORE_BASE64: ${{ secrets.CUSTOM_KEYSTORE_B64 }}');
      expect(yaml).toContain("Required signing secret 'CUSTOM_KEYSTORE_B64' is not set.");
      expect(yaml).toContain(
        "Android release keystore is empty or could not be decoded from 'CUSTOM_KEYSTORE_B64'.",
      );
      expect(yaml).toContain('CUSTOM_KEYSTORE_PATH: ${{ runner.temp }}/release.keystore');
      expect(yaml).toContain('CUSTOM_KEYSTORE_PASS: ${{ secrets.CUSTOM_KEYSTORE_PASS }}');
      expect(yaml).toContain('CUSTOM_KEY_ALIAS: ${{ secrets.CUSTOM_KEY_ALIAS }}');
      expect(yaml).toContain('CUSTOM_KEY_PASS: ${{ secrets.CUSTOM_KEY_PASS }}');
      expect(yaml).toContain(
        'ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_PASSWORD: ${{ secrets.CUSTOM_KEYSTORE_PASS }}',
      );
      expect(yaml).toContain('Cleanup Signing Keystore');
      expect(yaml).toContain('rm -f "$RUNNER_TEMP/release.keystore"');

      // Store publishing is disabled: no store credentials validation or deployment steps
      expect(yaml).not.toContain('Validate Store Credentials');
      expect(yaml).not.toContain('Setup Ruby for Fastlane');
      expect(yaml).not.toContain('Publish to Google Play');
    });

    it('enables Google Play publishing and credential validation when android.publishStore is true even if githubActions.storePublishing is false', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
          publishStore: true,
          deploymentTrack: 'internal',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: false,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            serviceAccountSecretName: 'CUSTOM_PLAY_SA_JSON',
          },
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('Provision Android Signing Keystore');
      expect(yaml).toContain('Validate Store Credentials');
      expect(yaml).toContain('PLAY_SERVICE_ACCOUNT_JSON: ${{ secrets.CUSTOM_PLAY_SA_JSON }}');
      expect(yaml).toContain(
        "Required secret 'CUSTOM_PLAY_SA_JSON' is missing for Google Play publishing.",
      );
      expect(yaml).toContain('Setup Ruby for Fastlane');
      expect(yaml).toContain('Publish to Google Play (internal)');
      expect(yaml).toContain('fastlane supply --aab "$ARTIFACT_FILE"');
      expect(yaml).toContain('Cleanup Google Play Credentials');
    });

    it('resolves Gradle task and artifact path accurately for custom appModule and product flavor', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          appModule: 'clientApp',
          flavor: 'staging',
          buildArtifact: 'aab',
          packagePath: 'android',
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: true,
          packagePath: 'android',
          appModule: 'clientApp',
          isKotlinDsl: false,
          buildGradleFound: true,
          hasReleaseSigningConfig: true,
          usesDebugSigningInRelease: false,
          hasSigningConfigEnv: true,
        },
      });

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('cd android');
      expect(yaml).toContain('./gradlew :clientApp:bundleStagingRelease');
      expect(yaml).toContain('path: android/clientApp/build/outputs/bundle/stagingRelease/*.aab');
    });

    it('omits signing notice and provisions keystore when signing.android.enabled is true and storePublishing is false', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: false,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            ...getBaseConfig().signing.android,
            enabled: true,
          },
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('Provision Android Signing Keystore');
      expect(yaml).not.toContain('Android Release Signing Notice');
      expect(yaml).toContain('Cleanup Signing Keystore');
    });

    it('includes production safeguard check in release-tag workflow when deploymentTrack is production and allowProductionPublish is false', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          deploymentTrack: 'production',
          allowProductionPublish: false,
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: true,
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('Publish to Google Play (production)');
      expect(yaml).toContain('Production track publishing is blocked by default');
      expect(yaml).toContain('android.allowProductionPublish: true');
    });

    it('allows production publishing in release-tag workflow when allowProductionPublish is true', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          deploymentTrack: 'production',
          allowProductionPublish: true,
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: true,
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('Publish to Google Play (production)');
      expect(yaml).toContain('if [ "true" != "true" ]');
    });

    it('generates release-notice job when both android and ios are disabled', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
        ios: {
          ...getBaseConfig().ios,
          enabled: false,
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('release-notice:');
      expect(yaml).not.toContain('release-android:');
      expect(yaml).not.toContain('release-ios:');
    });

    it('includes iOS release archive & export job when ios is enabled and detected', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
        ios: {
          ...getBaseConfig().ios,
          enabled: true,
          exportMethod: 'app-store',
          buildArtifact: 'ipa',
        },
      });
      const project = createMockProject({
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/TestApp.xcworkspace',
          schemes: ['TestApp'],
        },
      });

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('release-ios:');
      expect(yaml).toContain('name: Build & Archive iOS Release');
      expect(yaml).toContain('runs-on: macos-14');
      expect(yaml).toContain('Prepare Export Options Plist');
      expect(yaml).toContain('<string>app-store</string>');
      expect(yaml).toContain('Build & Archive iOS App');
      expect(yaml).toContain(
        'xcodebuild \\\n            -workspace "ios/TestApp.xcworkspace" \\\n            -scheme "TestApp" \\\n            -configuration Release \\\n            -destination \'generic/platform=iOS\' \\\n            -archivePath "$RUNNER_TEMP/build/TestApp.xcarchive" \\\n            archive',
      );
      expect(yaml).toContain('Export Release Artifact');
      expect(yaml).toContain(
        'xcodebuild \\\n            -exportArchive \\\n            -archivePath "$RUNNER_TEMP/build/TestApp.xcarchive" \\\n            -exportOptionsPlist "$RUNNER_TEMP/ExportOptions.plist" \\\n            -exportPath "ios/build/output"',
      );
      expect(yaml).toContain('Upload iOS Release Artifact');
      expect(yaml).toContain('name: ios-release-${{ github.ref_name }}-ipa');
      expect(yaml).toContain('path: ios/build/output/*.ipa');
      expect(yaml).toContain('if-no-files-found: error');
      expect(yaml).toContain('TestFlight publishing is disabled by default');
    });

    it('supports TestFlight upload when storePublishing=true with App Store Connect credentials', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
        ios: {
          ...getBaseConfig().ios,
          enabled: true,
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: true,
        },
        signing: {
          ...getBaseConfig().signing,
          ios: {
            appStoreConnectKeyContentSecretName: 'CUSTOM_ASC_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'CUSTOM_ASC_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'CUSTOM_ASC_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'CUSTOM_ASC_ISSUER_ID',
          },
        },
      });
      const project = createMockProject({
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/TestApp.xcworkspace',
          schemes: ['TestApp'],
        },
      });

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('Validate App Store Connect Credentials');
      expect(yaml).toContain('ASC_KEY_CONTENT: ${{ secrets.CUSTOM_ASC_KEY_CONTENT }}');
      expect(yaml).toContain('ASC_KEY_ID: ${{ secrets.CUSTOM_ASC_KEY_ID }}');
      expect(yaml).toContain('ASC_ISSUER_ID: ${{ secrets.CUSTOM_ASC_ISSUER_ID }}');
      expect(yaml).toContain('Setup Ruby for Fastlane');
      expect(yaml).toContain('Publish to Apple TestFlight');
      expect(yaml).toContain('pilot upload --ipa "$ARTIFACT_FILE"');
      expect(yaml).toContain('Cleanup App Store Connect Credentials');
      expect(yaml).toContain('rm -f "$RUNNER_TEMP/asc_key.json"');
    });

    it('supports iOS-only project (android disabled, ios enabled)', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
        ios: {
          ...getBaseConfig().ios,
          enabled: true,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/TestApp.xcworkspace',
          schemes: ['TestApp'],
        },
      });

      const mainYaml = generateMainBuildWorkflow(config, project);
      expect(mainYaml).toContain('build-ios:');
      expect(mainYaml).not.toContain('build-android:');
      expect(validateWorkflowYaml(mainYaml).valid).toBe(true);

      const releaseYaml = generateReleaseTagWorkflow(config, project);
      expect(releaseYaml).toContain('release-ios:');
      expect(releaseYaml).not.toContain('release-android:');
      expect(releaseYaml).not.toContain('release-notice:');
      expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);
    });

    it('supports Android-only project (android enabled, ios disabled)', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
        ios: {
          ...getBaseConfig().ios,
          enabled: false,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: true,
          hasGradlew: true,
          buildGradleFound: true,
        },
        ios: {
          hasIOS: false,
          hasPodfile: false,
          schemes: [],
        },
      });

      const mainYaml = generateMainBuildWorkflow(config, project);
      expect(mainYaml).toContain('build-android:');
      expect(mainYaml).not.toContain('build-ios:');
      expect(validateWorkflowYaml(mainYaml).valid).toBe(true);

      const releaseYaml = generateReleaseTagWorkflow(config, project);
      expect(releaseYaml).toContain('release-android:');
      expect(releaseYaml).not.toContain('release-ios:');
      expect(releaseYaml).not.toContain('release-notice:');
      expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);
    });

    it('generates Android release signing env block with standard properties when signing is enabled', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            ...getBaseConfig().signing.android,
            enabled: true,
          },
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: true,
          hasGradlew: true,
          buildGradleFound: true,
        },
      });

      const releaseYaml = generateReleaseTagWorkflow(config, project);
      expect(releaseYaml).toContain(
        'ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_FILE: ${{ runner.temp }}/release.keystore',
      );
      expect(releaseYaml).toContain(
        'ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/release.keystore',
      );
      expect(releaseYaml).toContain('ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/release.keystore');
      expect(releaseYaml).toContain('Cleanup Signing Keystore');
      expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);
    });

    it('generates Android release signing env block with custom secret and env var names', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            ...getBaseConfig().signing.android,
            enabled: true,
            keystoreSecretName: 'CUSTOM_KEYSTORE_B64',
            keystorePasswordSecretName: 'CUSTOM_KEYSTORE_PWD',
            keyAliasSecretName: 'CUSTOM_KEY_ALIAS_NAME',
            keyPasswordSecretName: 'CUSTOM_KEY_PWD',
            keystorePathEnvName: 'CUSTOM_KEYSTORE_FILE_PATH',
          },
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: true,
          hasGradlew: true,
          buildGradleFound: true,
        },
      });

      const releaseYaml = generateReleaseTagWorkflow(config, project);
      expect(releaseYaml).toContain(
        'CUSTOM_KEYSTORE_FILE_PATH: ${{ runner.temp }}/release.keystore',
      );
      expect(releaseYaml).toContain('CUSTOM_KEYSTORE_PWD: ${{ secrets.CUSTOM_KEYSTORE_PWD }}');
      expect(releaseYaml).toContain('CUSTOM_KEY_ALIAS_NAME: ${{ secrets.CUSTOM_KEY_ALIAS_NAME }}');
      expect(releaseYaml).toContain('CUSTOM_KEY_PWD: ${{ secrets.CUSTOM_KEY_PWD }}');
      expect(releaseYaml).toContain(
        'ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_FILE: ${{ runner.temp }}/release.keystore',
      );
      expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);
    });

    it('supports combined Android and iOS project (both enabled and detected)', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
        ios: {
          ...getBaseConfig().ios,
          enabled: true,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: true,
          hasGradlew: true,
          buildGradleFound: true,
        },
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/TestApp.xcworkspace',
          schemes: ['TestApp'],
        },
      });

      const mainYaml = generateMainBuildWorkflow(config, project);
      expect(mainYaml).toContain('build-android:');
      expect(mainYaml).toContain('build-ios:');
      expect(validateWorkflowYaml(mainYaml).valid).toBe(true);

      const releaseYaml = generateReleaseTagWorkflow(config, project);
      expect(releaseYaml).toContain('release-android:');
      expect(releaseYaml).toContain('release-ios:');
      expect(releaseYaml).not.toContain('release-notice:');
      expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);
    });
  });

  describe('Package Manager Setup Matrix', () => {
    it('configures npm with npm ci and cache: npm', () => {
      const config = createMockConfig({ packageManager: 'npm' });
      const project = createMockProject({
        packageManager: {
          manager: 'npm',
          lockfile: 'package-lock.json',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'npm install',
          frozenInstallCommand: 'npm ci',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('cache: npm');
      expect(yaml).toContain('run: npm ci');
      expect(yaml).not.toContain('Setup pnpm');
      expect(yaml).not.toContain('Setup Bun');
    });

    it('configures yarn classic with yarn install --frozen-lockfile and cache: yarn', () => {
      const config = createMockConfig({ packageManager: 'yarn' });
      const project = createMockProject({
        packageManager: {
          manager: 'yarn',
          lockfile: 'yarn.lock',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'yarn install',
          frozenInstallCommand: 'yarn install --frozen-lockfile',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('cache: yarn');
      expect(yaml).toContain('run: yarn install --frozen-lockfile');
    });

    it('configures yarn berry with yarn install --immutable and cache: yarn', () => {
      const config = createMockConfig({ packageManager: 'yarn' });
      const project = createMockProject({
        packageManager: {
          manager: 'yarn',
          lockfile: 'yarn.lock',
          ambiguous: false,
          isYarnBerry: true,
          installCommand: 'yarn install',
          frozenInstallCommand: 'yarn install --immutable',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('cache: yarn');
      expect(yaml).toContain('run: yarn install --immutable');
    });

    it('configures pnpm with setup-pnpm action and cache: pnpm', () => {
      const config = createMockConfig({ packageManager: 'pnpm' });
      const project = createMockProject({
        packageManager: {
          manager: 'pnpm',
          lockfile: 'pnpm-lock.yaml',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'pnpm install',
          frozenInstallCommand: 'pnpm install --frozen-lockfile',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.pnpmSetup}`);
      expect(yaml).toContain('run_install: false');
      expect(yaml).toContain('cache: pnpm');
      expect(yaml).toContain('run: pnpm install --frozen-lockfile');
    });

    it('configures bun with setup-bun action and no node cache', () => {
      const config = createMockConfig({ packageManager: 'bun' });
      const project = createMockProject({
        packageManager: {
          manager: 'bun',
          lockfile: 'bun.lockb',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'bun install',
          frozenInstallCommand: 'bun install --frozen-lockfile',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.setupBun}`);
      expect(yaml).toContain('run: bun install --frozen-lockfile');
      expect(yaml).not.toContain('cache: bun');
    });

    it('omits cache configuration when cacheDependencies is false', () => {
      const config = createMockConfig({
        githubActions: {
          ...getBaseConfig().githubActions,
          cacheDependencies: false,
        },
      });
      const project = createMockProject();

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).not.toContain('cache: npm');
    });
  });

  describe('generateGitHubWorkflows Orchestrator', () => {
    it('generates all three enabled workflows by default', async () => {
      const config = createMockConfig();
      const project = createMockProject();

      const result = await generateGitHubWorkflows(config, project);
      expect(result.workflows).toHaveLength(3);
      expect(result.workflows.map((w) => w.id)).toEqual([
        'pr-validation',
        'main-build',
        'release-tag',
      ]);
      expect(result.warnings).toHaveLength(0);
    });

    it('respects workflow toggles in configuration', async () => {
      const config = createMockConfig({
        githubActions: {
          ...getBaseConfig().githubActions,
          workflows: {
            prValidation: true,
            mainBuild: false,
            releaseTag: false,
          },
        },
      });
      const project = createMockProject();

      const result = await generateGitHubWorkflows(config, project);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0]?.id).toBe('pr-validation');
    });

    it('emits a warning when android is enabled but native directory is missing', async () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
      });

      const result = await generateGitHubWorkflows(config, project);
      expect(result.warnings.some((w) => w.includes('no "android/" directory was found'))).toBe(
        true,
      );
    });

    it('emits a warning when package manager detection is ambiguous', async () => {
      const config = createMockConfig();
      const project = createMockProject({
        packageManager: {
          manager: 'yarn',
          lockfile: 'yarn.lock',
          ambiguous: true,
          conflictingManagers: ['yarn', 'npm'],
          conflictingLockfiles: ['yarn.lock', 'package-lock.json'],
          isYarnBerry: false,
          installCommand: 'yarn install',
          frozenInstallCommand: 'yarn install --frozen-lockfile',
        },
      });

      const result = await generateGitHubWorkflows(config, project);
      expect(result.warnings.some((w) => w.includes('Ambiguous package manager detection'))).toBe(
        true,
      );
    });

    it('produces completely deterministic output across repeated invocations', async () => {
      const config = createMockConfig();
      const project = createMockProject();

      const run1 = await generateGitHubWorkflows(config, project);
      const run2 = await generateGitHubWorkflows(config, project);

      expect(run1.workflows.length).toBe(run2.workflows.length);
      for (let i = 0; i < run1.workflows.length; i++) {
        expect(run1.workflows[i]?.content).toBe(run2.workflows[i]?.content);
      }
    });

    describe('Phase A — Script Detection & Trigger Alignment', () => {
      it('omits typecheck step when project has no typecheck script and config has no custom command', async () => {
        const config = createMockConfig({
          scripts: {
            lint: 'npm run lint',
            test: 'npm test',
          },
        });
        const project = createMockProject({
          scripts: {
            lint: 'eslint .',
            test: 'jest',
          },
        });

        const prYaml = generatePrValidationWorkflow(config, project);
        expect(prYaml).toContain('name: Run Lint');
        expect(prYaml).toContain('name: Run Tests');
        expect(prYaml).not.toContain('Typecheck');

        const mainYaml = generateMainBuildWorkflow(config, project);
        expect(mainYaml).not.toContain('Typecheck');
      });

      it('safely skips legacy config with typecheck="npm run typecheck" when package.json lacks typecheck script', async () => {
        const config = createMockConfig({
          scripts: {
            lint: 'npm run lint',
            typecheck: 'npm run typecheck',
            test: 'npm test',
          },
        });
        const project = createMockProject({
          scripts: {
            lint: 'eslint .',
            test: 'jest',
          },
        });

        const result = await generateGitHubWorkflows(config, project);
        const prWf = result.workflows.find((w) => w.id === 'pr-validation');
        expect(prWf).toBeDefined();
        expect(prWf?.content).not.toContain('npm run typecheck');
        expect(
          result.warnings.some(
            (w) =>
              w.includes('Skipped typecheck step') && w.includes('does not exist in package.json'),
          ),
        ).toBe(true);
      });

      it('generates custom standalone typecheck command (e.g. npx tsc --noEmit) even if package.json has no typecheck script', async () => {
        const config = createMockConfig({
          scripts: {
            typecheck: 'npx tsc --noEmit',
          },
        });
        const project = createMockProject({
          scripts: {
            lint: 'eslint .',
            test: 'jest',
          },
        });

        const prYaml = generatePrValidationWorkflow(config, project);
        expect(prYaml).toContain('name: Run Typecheck');
        expect(prYaml).toContain('run: npx tsc --noEmit');
      });

      it('generates custom referenced package script (e.g. npm run check:types) when it exists in package.json', async () => {
        const config = createMockConfig({
          scripts: {
            typecheck: 'npm run check:types',
          },
        });
        const project = createMockProject({
          scripts: {
            lint: 'eslint .',
            'check:types': 'tsc --noEmit',
            test: 'jest',
          },
        });

        const prYaml = generatePrValidationWorkflow(config, project);
        expect(prYaml).toContain('name: Run Typecheck');
        expect(prYaml).toContain('run: npm run check:types');
      });

      it('generates no workflows and returns warning when githubActions.enabled is false', async () => {
        const config = createMockConfig({
          githubActions: {
            ...getBaseConfig().githubActions,
            enabled: false,
          },
        });
        const project = createMockProject();

        const result = await generateGitHubWorkflows(config, project);
        expect(result.workflows).toHaveLength(0);
        expect(
          result.warnings.some((w) =>
            w.includes('GitHub Actions workflow generation is disabled in configuration'),
          ),
        ).toBe(true);
      });

      it('respects triggers.pullRequest=false by skipping PR workflow and logging conflict warning', async () => {
        const config = createMockConfig({
          githubActions: {
            ...getBaseConfig().githubActions,
            triggers: {
              pullRequest: false,
              main: true,
              releaseTags: true,
            },
          },
        });
        const project = createMockProject();

        const result = await generateGitHubWorkflows(config, project);
        const ids = result.workflows.map((w) => w.id);
        expect(ids).not.toContain('pr-validation');
        expect(ids).toContain('main-build');
        expect(ids).toContain('release-tag');
        expect(
          result.warnings.some((w) =>
            w.includes(
              'Skipping pr-validation.yml because githubActions.triggers.pullRequest is false',
            ),
          ),
        ).toBe(true);
      });

      it('respects triggers.main=false by skipping main-build.yml', async () => {
        const config = createMockConfig({
          githubActions: {
            ...getBaseConfig().githubActions,
            triggers: {
              pullRequest: true,
              main: false,
              releaseTags: true,
            },
          },
        });
        const project = createMockProject();

        const result = await generateGitHubWorkflows(config, project);
        const ids = result.workflows.map((w) => w.id);
        expect(ids).toContain('pr-validation');
        expect(ids).not.toContain('main-build');
        expect(ids).toContain('release-tag');
        expect(
          result.warnings.some((w) =>
            w.includes('Skipping main-build.yml because githubActions.triggers.main is false'),
          ),
        ).toBe(true);
      });

      it('respects triggers.releaseTags=false by skipping release-tag.yml', async () => {
        const config = createMockConfig({
          githubActions: {
            ...getBaseConfig().githubActions,
            triggers: {
              pullRequest: true,
              main: true,
              releaseTags: false,
            },
          },
        });
        const project = createMockProject();

        const result = await generateGitHubWorkflows(config, project);
        const ids = result.workflows.map((w) => w.id);
        expect(ids).toContain('pr-validation');
        expect(ids).toContain('main-build');
        expect(ids).not.toContain('release-tag');
        expect(
          result.warnings.some((w) =>
            w.includes(
              'Skipping release-tag.yml because githubActions.triggers.releaseTags is false',
            ),
          ),
        ).toBe(true);
      });

      it('warns when iOS bundleId contains an unresolved Xcode build setting macro', async () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            bundleId: 'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
          },
        });
        const project = createMockProject();

        const result = await generateGitHubWorkflows(config, project);
        expect(
          result.warnings.some(
            (w) =>
              w.includes('contains an unresolved Xcode build setting macro') ||
              w.includes('Replace the Xcode macro'),
          ),
        ).toBe(true);
      });
    });

    describe('Phase B — iOS Build & Deployment Workflows Verification', () => {
      it('falls back to -project when no xcworkspace exists', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            workspace: undefined,
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: false,
            workspace: undefined,
            xcodeproj: 'ios/BareApp.xcodeproj',
            schemes: ['BareApp'],
          },
        });

        const mainYaml = generateMainBuildWorkflow(config, project);
        expect(mainYaml).toContain('-project "ios/BareApp.xcodeproj"');
        expect(mainYaml).not.toContain('-workspace');

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        expect(releaseYaml).toContain('-project "ios/BareApp.xcodeproj"');
        expect(releaseYaml).not.toContain('-workspace');
      });

      it('filters out test schemes (Tests, UITests) and selects the app target scheme', () => {
        const config = createMockConfig({
          projectName: 'MyRealApp',
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            scheme: undefined,
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/MyRealApp.xcworkspace',
            schemes: ['MyRealAppTests', 'MyRealAppUITests', 'MyRealApp'],
          },
        });

        const mainYaml = generateMainBuildWorkflow(config, project);
        expect(mainYaml).toContain('-scheme "MyRealApp"');
        expect(mainYaml).not.toContain('-scheme "MyRealAppTests"');
        expect(mainYaml).not.toContain('-scheme "MyRealAppUITests"');

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        expect(releaseYaml).toContain('-scheme "MyRealApp"');
      });

      it('handles custom packagePath and directories with spaces safely', () => {
        const config = createMockConfig({
          projectName: 'Space App',
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            packagePath: 'packages/my app/ios',
            workspace: 'packages/my app/ios/Space App.xcworkspace',
            scheme: 'Space App',
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            packagePath: 'packages/my app/ios',
            workspace: 'packages/my app/ios/Space App.xcworkspace',
            schemes: ['Space App'],
          },
        });

        const mainYaml = generateMainBuildWorkflow(config, project);
        expect(mainYaml).toContain('cd "packages/my app/ios"');
        expect(mainYaml).toContain('-workspace "packages/my app/ios/Space App.xcworkspace"');
        expect(mainYaml).toContain('-scheme "Space App"');
        expect(mainYaml).toContain('-derivedDataPath "packages/my app/ios/build"');
        expect(mainYaml).toContain(
          'path: packages/my app/ios/build/Build/Products/Debug-iphonesimulator/*.app',
        );

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        expect(releaseYaml).toContain('cd "packages/my app/ios"');
        expect(releaseYaml).toContain('-workspace "packages/my app/ios/Space App.xcworkspace"');
        expect(releaseYaml).toContain('-scheme "Space App"');
        expect(releaseYaml).toContain('mkdir -p "packages/my app/ios/build/output"');
        expect(releaseYaml).toContain('-exportPath "packages/my app/ios/build/output"');
        expect(releaseYaml).toContain('path: packages/my app/ios/build/output/*.ipa');
      });

      it('generates signing prerequisite validation and provisioning steps with cleanup on always()', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            teamId: 'TEAM123456',
          },
          signing: {
            ...getBaseConfig().signing,
            ios: {
              ...getBaseConfig().signing.ios,
              certificateSecretName: 'CUSTOM_IOS_CERT',
              certificatePasswordSecretName: 'CUSTOM_IOS_PWD',
              provisioningProfileSecretName: 'CUSTOM_IOS_PROFILE',
            },
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/TestApp.xcworkspace',
            schemes: ['TestApp'],
          },
        });

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        expect(releaseYaml).toContain('Validate iOS Release Signing Prerequisites');
        expect(releaseYaml).toContain('CERT_B64: ${{ secrets.CUSTOM_IOS_CERT }}');
        expect(releaseYaml).toContain('CERT_PWD: ${{ secrets.CUSTOM_IOS_PWD }}');
        expect(releaseYaml).toContain('PROFILE_B64: ${{ secrets.CUSTOM_IOS_PROFILE }}');
        expect(releaseYaml).toContain('Provision iOS Distribution Certificate & Profile');
        expect(releaseYaml).toContain(
          'security create-keychain -p "$KEYCHAIN_PWD" "$KEYCHAIN_PATH"',
        );
        expect(releaseYaml).toContain('security import "$RUNNER_TEMP/cert.p12"');
        expect(releaseYaml).toContain(
          '~/Library/MobileDevice/Provisioning\\ Profiles/embedded.mobileprovision',
        );
        expect(releaseYaml).toContain('Missing required secret: CUSTOM_IOS_CERT');
        expect(releaseYaml).toContain('Missing required secret: CUSTOM_IOS_PWD');
        expect(releaseYaml).toContain('Missing required secret: CUSTOM_IOS_PROFILE');
        expect(releaseYaml).toContain(
          'App Store Connect API credentials are a separate requirement used only for automated TestFlight publishing.',
        );
        expect(releaseYaml).toContain('Prepare Export Options Plist');
        expect(releaseYaml).toContain('EFFECTIVE_TEAM_ID="TEAM123456"');
        expect(releaseYaml).toContain('<key>teamID</key>');
        expect(releaseYaml).toContain('Cleanup iOS Signing Keychain');
        expect(releaseYaml).toContain('security delete-keychain "$RUNNER_TEMP/build.keychain"');
      });

      it('requires iOS signing credentials in release-tag workflow even when signing.ios.enabled is false, and omits App Store Connect credentials when TestFlight publishing is disabled', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            uploadToTestFlight: false,
          },
          githubActions: {
            ...getBaseConfig().githubActions,
            storePublishing: false,
          },
          signing: {
            ...getBaseConfig().signing,
            ios: {
              ...getBaseConfig().signing.ios,
              enabled: false,
            },
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/TestApp.xcworkspace',
            schemes: ['TestApp'],
          },
        });

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        // Signing prerequisites are still required for signed App Store IPA export
        expect(releaseYaml).toContain('Validate iOS Release Signing Prerequisites');
        expect(releaseYaml).toContain(
          'CERT_B64: ${{ secrets.IOS_DISTRIBUTION_CERTIFICATE_BASE64 }}',
        );
        expect(releaseYaml).toContain('CERT_PWD: ${{ secrets.IOS_CERTIFICATE_PASSWORD }}');
        expect(releaseYaml).toContain(
          'PROFILE_B64: ${{ secrets.IOS_PROVISIONING_PROFILE_BASE64 }}',
        );
        expect(releaseYaml).toContain(
          'Missing required secret: IOS_DISTRIBUTION_CERTIFICATE_BASE64',
        );
        expect(releaseYaml).toContain('Missing required secret: IOS_CERTIFICATE_PASSWORD');
        expect(releaseYaml).toContain('Missing required secret: IOS_PROVISIONING_PROFILE_BASE64');
        expect(releaseYaml).toContain('Provision iOS Distribution Certificate & Profile');
        expect(releaseYaml).toContain("-destination 'generic/platform=iOS'");
        expect(releaseYaml).toContain('-archivePath "$RUNNER_TEMP/build/TestApp.xcarchive"');
        expect(releaseYaml).toContain('-exportArchive');

        // TestFlight publishing is disabled: App Store Connect API credentials are not required
        expect(releaseYaml).not.toContain('Validate App Store Connect Credentials');
        expect(releaseYaml).not.toContain('APP_STORE_CONNECT_API_KEY_KEY_CONTENT');
        expect(releaseYaml).not.toContain('pilot upload');
      });

      it('enforces App Store Connect credential validation and pilot upload when storePublishing is enabled', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            uploadToTestFlight: false,
          },
          githubActions: {
            ...getBaseConfig().githubActions,
            storePublishing: true,
          },
          signing: {
            ...getBaseConfig().signing,
            ios: {
              ...getBaseConfig().signing.ios,
              appStoreConnectKeyContentSecretName: 'CUSTOM_ASC_KEY',
              appStoreConnectKeyIdSecretName: 'CUSTOM_ASC_KEY_ID',
              appStoreConnectIssuerIdSecretName: 'CUSTOM_ASC_ISSUER_ID',
            },
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/TestApp.xcworkspace',
            schemes: ['TestApp'],
          },
        });

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        // Signing prerequisites remain
        expect(releaseYaml).toContain('Validate iOS Release Signing Prerequisites');

        // App Store Connect credentials validation step is included with custom secret names
        expect(releaseYaml).toContain('Validate App Store Connect Credentials');
        expect(releaseYaml).toContain('ASC_KEY_CONTENT: ${{ secrets.CUSTOM_ASC_KEY }}');
        expect(releaseYaml).toContain('ASC_KEY_ID: ${{ secrets.CUSTOM_ASC_KEY_ID }}');
        expect(releaseYaml).toContain('ASC_ISSUER_ID: ${{ secrets.CUSTOM_ASC_ISSUER_ID }}');
        expect(releaseYaml).toContain(
          "Required secret 'CUSTOM_ASC_KEY' is missing for TestFlight publishing.",
        );
        expect(releaseYaml).toContain(
          "Required secret 'CUSTOM_ASC_KEY_ID' is missing for TestFlight publishing.",
        );
        expect(releaseYaml).toContain(
          "Required secret 'CUSTOM_ASC_ISSUER_ID' is missing for TestFlight publishing.",
        );

        // Fastlane pilot upload step is included
        expect(releaseYaml).toContain('Publish to Apple TestFlight');
        expect(releaseYaml).toContain('pilot upload --ipa "$ARTIFACT_FILE"');
      });

      it('handles Fastlane Gemfile detection and Pilot upload correctly in release workflow', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            uploadToTestFlight: true,
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/TestApp.xcworkspace',
            schemes: ['TestApp'],
          },
        });

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        expect(releaseYaml).toContain('Setup Ruby for Fastlane');
        expect(releaseYaml).toContain('Install Fastlane');
        expect(releaseYaml).toContain('if [ -f "Gemfile" ]; then');
        expect(releaseYaml).toContain('elif [ -f "ios/Gemfile" ]; then');
        expect(releaseYaml).toContain('gem install fastlane --no-document');
        expect(releaseYaml).toContain('chmod 600 "$RUNNER_TEMP/asc_key.json"');
        expect(releaseYaml).toContain('pilot upload --ipa "$ARTIFACT_FILE"');
        expect(releaseYaml).toContain('Cleanup App Store Connect Credentials');
        expect(releaseYaml).toContain('rm -f "$RUNNER_TEMP/asc_key.json"');
      });

      it('strictly ensures TestFlight upload is NEVER included in PR validation or main build workflows', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
            uploadToTestFlight: true,
          },
          githubActions: {
            ...getBaseConfig().githubActions,
            storePublishing: true,
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/TestApp.xcworkspace',
            schemes: ['TestApp'],
          },
        });

        const prYaml = generatePrValidationWorkflow(config, project);
        expect(prYaml).not.toContain('TestFlight');
        expect(prYaml).not.toContain('pilot upload');
        expect(prYaml).not.toContain('asc_key.json');

        const mainYaml = generateMainBuildWorkflow(config, project);
        expect(mainYaml).not.toContain('TestFlight');
        expect(mainYaml).not.toContain('pilot upload');
        expect(mainYaml).not.toContain('asc_key.json');
      });

      it('isolates simulator build to main-build.yml and release archive to release-tag.yml', () => {
        const config = createMockConfig({
          ios: {
            ...getBaseConfig().ios,
            enabled: true,
          },
        });
        const project = createMockProject({
          ios: {
            hasIOS: true,
            hasPodfile: true,
            workspace: 'ios/TestApp.xcworkspace',
            schemes: ['TestApp'],
          },
        });

        const prYaml = generatePrValidationWorkflow(config, project);
        expect(prYaml).not.toContain('build-ios:');
        expect(prYaml).not.toContain('iphonesimulator');

        const mainYaml = generateMainBuildWorkflow(config, project);
        expect(mainYaml).toContain('build-ios:');
        expect(mainYaml).toContain('iphonesimulator');
        expect(mainYaml).toContain('CODE_SIGNING_ALLOWED=NO');
        expect(mainYaml).not.toContain('generic/platform=iOS\n');
        expect(mainYaml).not.toContain('archive');

        const releaseYaml = generateReleaseTagWorkflow(config, project);
        expect(releaseYaml).toContain('release-ios:');
        expect(releaseYaml).not.toContain('iphonesimulator');
        expect(releaseYaml).toContain('archive');
        expect(releaseYaml).toContain('exportArchive');
      });
    });
  });
});
