import path from 'node:path';
import type { ReleaseKitConfig } from '../config/schema.js';
import type { ProjectDetectionResult } from '../detector/types.js';
import { getFrozenInstallCommand } from '../detector/package-manager.js';
import { validateIOSBundleId } from '../validators/config.js';
import { formatGradleTaskForWorkflow } from '../adapters/android.js';

export interface WorkflowFile {
  id: 'pr-validation' | 'main-build' | 'release-tag';
  name: string;
  relativePath: string;
  absolutePath: string;
  content: string;
}

export interface WorkflowGenerationResult {
  workflows: WorkflowFile[];
  warnings: string[];
}

export interface GenerateWorkflowsOptions {
  cwd?: string;
}

// SHA-pinned third-party actions with version documentation comments
export const GITHUB_ACTIONS_SHAS = {
  checkout: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
  setupNode: 'actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0',
  setupJava: 'actions/setup-java@3a4f6e1af504cf6a31855fa899c6aa5355ba6c12 # v4.7.0',
  uploadArtifact: 'actions/upload-artifact@4cec3d8aa04e39d1a68397de0c4cd6fb9dce8ec1 # v4.6.1',
  pnpmSetup: 'pnpm/action-setup@a3252b78d4704d58107c474d22168393c52e46a7 # v4.0.0',
  setupBun: 'oven-sh/setup-bun@4bc047ad259df6fc24a6c9b0f9a0cb08cf17fbe5 # v2.0.1',
  setupRuby: 'ruby/setup-ruby@359bebbc29cbe6c86eb6bde9f4fb9bf5e2f901a4 # v1.207.0',
} as const;

function capitalize(val: string): string {
  if (!val) return '';
  return val.charAt(0).toUpperCase() + val.slice(1);
}

/**
 * Extracts the target package.json script name if the command invokes npm/yarn/pnpm/bun script runner.
 * Returns null if the command is a standalone/custom binary invocation (e.g. "npx tsc --noEmit").
 */
export function extractReferencedPackageScript(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Match "<pm> run <script>" or "<pm> run-script <script>"
  const runMatch = trimmed.match(
    /^(?:npm|yarn|pnpm|bun)\s+run(?:-script)?\s+([a-zA-Z0-9_:-]+)(?:\s|$)/,
  );
  if (runMatch?.[1]) {
    return runMatch[1];
  }

  // Match "<pm> test" or "<pm> t"
  if (/^(?:npm|yarn|pnpm|bun)\s+(?:test|t)(?:\s|$)/.test(trimmed)) {
    return 'test';
  }

  // Match shorthand "<yarn|pnpm> <script>" (excluding built-in package manager subcommands)
  const shorthandMatch = trimmed.match(
    /^(?:yarn|pnpm)\s+(?!dlx\b|exec\b|install\b|add\b|remove\b|why\b|info\b|config\b|cache\b|workspaces?\b|node\b|patch\b|dedupe\b|unlink\b|link\b|init\b|create\b|--version\b|-v\b)([a-zA-Z0-9_:-]+)(?:\s|$)/,
  );
  if (shorthandMatch?.[1]) {
    return shorthandMatch[1];
  }

  return null;
}

function buildPackageManagerSteps(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string {
  const pm = config.packageManager || project.packageManager.manager;
  const isCaching = config.githubActions.cacheDependencies;
  const nodeVersion = config.githubActions.nodeVersion || '20';
  const isYarnBerry = project.packageManager.isYarnBerry ?? false;

  const steps: string[] = [];

  if (pm === 'pnpm') {
    steps.push(`      - name: Setup pnpm
        uses: ${GITHUB_ACTIONS_SHAS.pnpmSetup}
        with:
          run_install: false`);
  } else if (pm === 'bun') {
    steps.push(`      - name: Setup Bun
        uses: ${GITHUB_ACTIONS_SHAS.setupBun}`);
  }

  const cacheLine = isCaching && pm !== 'bun' ? `\n          cache: ${pm}` : '';
  steps.push(`      - name: Setup Node.js
        uses: ${GITHUB_ACTIONS_SHAS.setupNode}
        with:
          node-version: '${nodeVersion}'${cacheLine}`);

  const frozenInstall = getFrozenInstallCommand(pm, isYarnBerry);
  steps.push(`      - name: Install dependencies
        run: ${frozenInstall}`);

  return steps.join('\n\n');
}

interface QualityCheckResolution {
  steps: string[];
  warnings: string[];
}

function isPlaceholderTestScript(cmd?: string): boolean {
  if (!cmd) return false;
  const lower = cmd.toLowerCase().trim();
  return (
    lower.includes('no test specified') && (lower.includes('exit 1') || lower.includes('error:'))
  );
}

function resolveQualityChecks(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): QualityCheckResolution {
  const steps: string[] = [];
  const warnings: string[] = [];
  const pkgScripts = project.scripts || {};
  const pm = config.packageManager || project.packageManager.manager;
  const runner = pm === 'npm' ? 'npm run' : pm;
  const testRunner = pm === 'npm' ? 'npm test' : `${pm} test`;

  const checks: Array<{
    key: 'lint' | 'typecheck' | 'test';
    stepName: string;
    defaultScriptNames: string[];
    defaultCmd: (scriptName: string) => string;
  }> = [
    {
      key: 'lint',
      stepName: 'Run Lint',
      defaultScriptNames: ['lint'],
      defaultCmd: (s) => `${runner} ${s}`,
    },
    {
      key: 'typecheck',
      stepName: 'Run Typecheck',
      defaultScriptNames: ['typecheck', 'type-check'],
      defaultCmd: (s) => `${runner} ${s}`,
    },
    {
      key: 'test',
      stepName: 'Run Tests',
      defaultScriptNames: ['test'],
      defaultCmd: () => testRunner,
    },
  ];

  for (const check of checks) {
    const rawConfigured = config.scripts?.[check.key];

    // If explicitly set to empty string, treat as disabled
    if (rawConfigured !== undefined && rawConfigured.trim() === '') {
      continue;
    }

    if (rawConfigured !== undefined) {
      const configuredCmd = rawConfigured.trim();
      const referencedScript = extractReferencedPackageScript(configuredCmd);

      if (referencedScript !== null) {
        // Command invokes a package.json script — verify that script exists in package.json
        const scriptBody = pkgScripts[referencedScript];
        if (scriptBody) {
          if (check.key === 'test' && isPlaceholderTestScript(scriptBody)) {
            warnings.push(
              `Skipped test step: package.json script "${referencedScript}" is an unconfigured default placeholder ("${scriptBody}").`,
            );
          } else {
            steps.push(`      - name: ${check.stepName}\n        run: ${configuredCmd}`);
          }
        } else {
          const isStandardDefault =
            (check.key === 'lint' && configuredCmd === `${runner} lint`) ||
            (check.key === 'test' && configuredCmd === testRunner);
          if (!isStandardDefault) {
            warnings.push(
              `Skipped ${check.key} step: configured command "${configuredCmd}" references package.json script "${referencedScript}", which does not exist in package.json.`,
            );
          }
        }
      } else {
        // Standalone custom command (e.g. "npx tsc --noEmit") — run as configured
        steps.push(`      - name: ${check.stepName}\n        run: ${configuredCmd}`);
      }
    } else {
      // Not explicitly configured in config.scripts — check if package.json defines the script
      const foundScript = check.defaultScriptNames.find((name) => Boolean(pkgScripts[name]));
      if (foundScript) {
        const scriptBody = pkgScripts[foundScript];
        if (check.key === 'test' && isPlaceholderTestScript(scriptBody)) {
          warnings.push(
            `Skipped test step: package.json script "${foundScript}" is an unconfigured default placeholder ("${scriptBody}").`,
          );
        } else {
          steps.push(
            `      - name: ${check.stepName}\n        run: ${check.defaultCmd(foundScript)}`,
          );
        }
      }
    }
  }

  if (steps.length === 0) {
    steps.push(`      - name: Verify Environment
        run: node --version`);
  }

  return { steps, warnings };
}

function buildQualityCheckSteps(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string[] {
  return resolveQualityChecks(config, project).steps;
}

export function generatePrValidationWorkflow(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string {
  const mainBranch = config.githubActions.mainBranch;
  const pmSteps = buildPackageManagerSteps(config, project);
  const checkSteps = buildQualityCheckSteps(config, project).join('\n\n');

  return `name: PR Validation

on:
  pull_request:
    branches:
      - ${mainBranch}

permissions:
  contents: read
  pull-requests: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.head_ref || github.run_id }}
  cancel-in-progress: true

jobs:
  validate:
    name: Quality Checks & Tests
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: ${GITHUB_ACTIONS_SHAS.checkout}

${pmSteps}

${checkSteps}
`;
}

interface IOSWorkflowSettings {
  packagePath: string;
  scheme: string;
  containerFlag: string;
  workspacePath?: string;
  xcodeProjPath?: string;
  hasPodfile: boolean;
  exportMethod: string;
  artifactType: 'ipa' | 'app';
  artifactPath: string;
  teamId?: string;
}

function resolveIOSWorkflowSettings(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): IOSWorkflowSettings {
  const packagePath = config.ios.packagePath || project.ios.packagePath || 'ios';
  const nonTestSchemes = (project.ios.schemes || []).filter((s) => !/(?:Tests|UITests)$/i.test(s));
  const detectedScheme = nonTestSchemes[0] || project.ios.schemes[0];
  const scheme =
    config.ios.scheme && (detectedScheme ? config.ios.scheme !== config.projectName : true)
      ? config.ios.scheme
      : detectedScheme || config.ios.scheme || config.projectName || 'App';
  const workspacePath = config.ios.workspace
    ? config.ios.workspace.includes('/')
      ? config.ios.workspace
      : `${packagePath}/${config.ios.workspace}`
    : project.ios.workspace;
  const xcodeProjPath = project.ios.xcodeproj;

  const containerFlag = workspacePath
    ? `-workspace "${workspacePath}"`
    : xcodeProjPath
      ? `-project "${xcodeProjPath}"`
      : `-workspace "${packagePath}/${scheme}.xcworkspace"`;

  const exportMethod = config.ios.exportMethod || config.signing.ios.exportMethod || 'app-store';
  const isIpa = (config.ios.buildArtifact || 'ipa') === 'ipa';
  const artifactType = isIpa ? 'ipa' : 'app';
  const artifactPath = isIpa
    ? `${packagePath}/build/output/*.ipa`
    : `${packagePath}/build/output/*.app`;
  const teamId = config.ios.teamId || config.signing.ios.teamId;

  return {
    packagePath,
    scheme,
    containerFlag,
    workspacePath,
    xcodeProjPath,
    hasPodfile: Boolean(project.ios.hasPodfile),
    exportMethod,
    artifactType,
    artifactPath,
    teamId,
  };
}

export function generateMainBuildWorkflow(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string {
  const mainBranch = config.githubActions.mainBranch;
  const pmSteps = buildPackageManagerSteps(config, project);
  const checkSteps = buildQualityCheckSteps(config, project).join('\n\n');
  const hasAndroid = Boolean(config.android.enabled && project.android.hasAndroid);
  const hasIOS = Boolean(config.ios.enabled && project.ios.hasIOS);
  const retentionDays = config.githubActions.artifactRetentionDays;
  const isAab = config.android.buildArtifact === 'aab';
  const artifactType = isAab ? 'aab' : 'apk';

  const packagePath = config.android.packagePath || 'android';
  const appModule = config.android.appModule || project.android.appModule || 'app';
  const flavor = config.android.flavor;
  const flavorCap = flavor ? capitalize(flavor) : '';
  const baseDebugTask = isAab ? `bundle${flavorCap}Debug` : `assemble${flavorCap}Debug`;
  const buildTask = formatGradleTaskForWorkflow(baseDebugTask, appModule);

  const variantOutDir = flavor ? (isAab ? `${flavor}Debug` : `${flavor}/debug`) : 'debug';
  const artifactPath = isAab
    ? `${packagePath}/${appModule}/build/outputs/bundle/${variantOutDir}/*.aab`
    : `${packagePath}/${appModule}/build/outputs/apk/${variantOutDir}/*.apk`;

  let androidJobYaml = '';
  if (hasAndroid) {
    androidJobYaml = `

  build-android:
    name: Build Android (Debug Validation)
    needs: verify
    runs-on: ${config.githubActions.runner.android}
    steps:
      - name: Checkout repository
        uses: ${GITHUB_ACTIONS_SHAS.checkout}

${pmSteps}

      - name: Setup Java JDK
        uses: ${GITHUB_ACTIONS_SHAS.setupJava}
        with:
          distribution: 'zulu'
          java-version: '${config.githubActions.javaVersion}'

      - name: Grant execute permission for gradlew
        run: chmod +x ${packagePath}/gradlew

      - name: Build Android ${artifactType.toUpperCase()}
        run: |
          cd ${packagePath}
          ./gradlew ${buildTask}

      - name: Upload Android Build Artifact
        uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}
        with:
          name: android-debug-\${{ github.sha }}-${artifactType}
          path: ${artifactPath}
          if-no-files-found: error
          retention-days: ${retentionDays}`;
  }

  let iosJobYaml = '';
  if (hasIOS) {
    const iosSettings = resolveIOSWorkflowSettings(config, project);
    const podStep = iosSettings.hasPodfile
      ? `\n\n      - name: Install CocoaPods dependencies\n        run: |\n          cd "${iosSettings.packagePath}"\n          pod install`
      : '';

    iosJobYaml = `

  build-ios:
    name: Build iOS (Simulator Validation)
    needs: verify
    runs-on: ${config.githubActions.runner.ios}
    steps:
      - name: Checkout repository
        uses: ${GITHUB_ACTIONS_SHAS.checkout}

${pmSteps}${podStep}

      - name: Build iOS App (Simulator)
        run: |
          xcodebuild \\
            ${iosSettings.containerFlag} \\
            -scheme "${iosSettings.scheme}" \\
            -configuration Debug \\
            -sdk iphonesimulator \\
            -destination 'generic/platform=iOS Simulator' \\
            -derivedDataPath "${iosSettings.packagePath}/build" \\
            CODE_SIGNING_ALLOWED=NO \\
            build

      - name: Upload iOS Build Artifact
        uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}
        with:
          name: ios-\${{ github.sha }}-simulator
          path: ${iosSettings.packagePath}/build/Build/Products/Debug-iphonesimulator/*.app
          if-no-files-found: error
          retention-days: ${retentionDays}`;
  }

  return `name: Main Branch Build

on:
  push:
    branches:
      - ${mainBranch}
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  verify:
    name: Verify Quality Checks
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: ${GITHUB_ACTIONS_SHAS.checkout}

${pmSteps}

${checkSteps}${androidJobYaml}${iosJobYaml}
`;
}

export function generateReleaseTagWorkflow(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string {
  const tagPattern = config.githubActions.releaseTagPattern;
  const pmSteps = buildPackageManagerSteps(config, project);
  const hasAndroid = Boolean(config.android.enabled && project.android.hasAndroid);
  const hasIOS = Boolean(config.ios.enabled && project.ios.hasIOS);
  const retentionDays = config.githubActions.artifactRetentionDays;
  const isAab = config.android.buildArtifact === 'aab';
  const artifactType = isAab ? 'aab' : 'apk';

  const packagePath = config.android.packagePath || 'android';
  const appModule = config.android.appModule || project.android.appModule || 'app';
  const flavor = config.android.flavor;
  const flavorCap = flavor ? capitalize(flavor) : '';
  const defaultReleaseTask = isAab ? `bundle${flavorCap}Release` : `assemble${flavorCap}Release`;
  const rawTask =
    config.android.buildTask && config.android.buildTask !== 'bundleRelease'
      ? config.android.buildTask
      : defaultReleaseTask;
  const buildTask = formatGradleTaskForWorkflow(rawTask, appModule);

  const variantOutDir = flavor ? (isAab ? `${flavor}Release` : `${flavor}/release`) : 'release';
  const artifactPath = isAab
    ? `${packagePath}/${appModule}/build/outputs/bundle/${variantOutDir}/*.aab`
    : `${packagePath}/${appModule}/build/outputs/apk/${variantOutDir}/*.apk`;

  const isStorePublishing = config.githubActions.storePublishing || config.android.publishStore;
  const isSigningEnabled = config.signing.android.enabled || isStorePublishing;

  let signingPrepareStep = '';
  let signingNoticeStep = '';
  let buildEnvBlock = '';
  let signingCleanupStep = '';

  if (isSigningEnabled) {
    signingPrepareStep = `
      - name: Provision Android Signing Keystore
        env:
          KEYSTORE_BASE64: \${{ secrets.${config.signing.android.keystoreSecretName} }}
        run: |
          if [ -z "$KEYSTORE_BASE64" ]; then
            echo "::error::Required signing secret '${config.signing.android.keystoreSecretName}' is not set."
            exit 1
          fi
          echo "$KEYSTORE_BASE64" | tr -d '\\n\\r ' | base64 --decode > "$RUNNER_TEMP/release.keystore"
          chmod 600 "$RUNNER_TEMP/release.keystore"

`;
    const androidSigningEnvEntries: string[] = [
      `ANDROID_KEYSTORE_PATH: \${{ runner.temp }}/release.keystore`,
      `ANDROID_KEYSTORE_PASSWORD: \${{ secrets.${config.signing.android.keystorePasswordSecretName} }}`,
      `ANDROID_KEY_ALIAS: \${{ secrets.${config.signing.android.keyAliasSecretName} }}`,
      `ANDROID_KEY_PASSWORD: \${{ secrets.${config.signing.android.keyPasswordSecretName} }}`,
      `ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PATH: \${{ runner.temp }}/release.keystore`,
      `ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PASSWORD: \${{ secrets.${config.signing.android.keystorePasswordSecretName} }}`,
      `ORG_GRADLE_PROJECT_ANDROID_KEY_ALIAS: \${{ secrets.${config.signing.android.keyAliasSecretName} }}`,
      `ORG_GRADLE_PROJECT_ANDROID_KEY_PASSWORD: \${{ secrets.${config.signing.android.keyPasswordSecretName} }}`,
      `ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_FILE: \${{ runner.temp }}/release.keystore`,
      `ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_PASSWORD: \${{ secrets.${config.signing.android.keystorePasswordSecretName} }}`,
      `ORG_GRADLE_PROJECT_MYAPP_UPLOAD_KEY_ALIAS: \${{ secrets.${config.signing.android.keyAliasSecretName} }}`,
      `ORG_GRADLE_PROJECT_MYAPP_UPLOAD_KEY_PASSWORD: \${{ secrets.${config.signing.android.keyPasswordSecretName} }}`,
    ];

    if (config.signing.android.keystorePathEnvName !== 'ANDROID_KEYSTORE_PATH') {
      androidSigningEnvEntries.push(
        `${config.signing.android.keystorePathEnvName}: \${{ runner.temp }}/release.keystore`,
      );
    }
    if (config.signing.android.keystorePasswordSecretName !== 'ANDROID_KEYSTORE_PASSWORD') {
      androidSigningEnvEntries.push(
        `${config.signing.android.keystorePasswordSecretName}: \${{ secrets.${config.signing.android.keystorePasswordSecretName} }}`,
      );
    }
    if (config.signing.android.keyAliasSecretName !== 'ANDROID_KEY_ALIAS') {
      androidSigningEnvEntries.push(
        `${config.signing.android.keyAliasSecretName}: \${{ secrets.${config.signing.android.keyAliasSecretName} }}`,
      );
    }
    if (config.signing.android.keyPasswordSecretName !== 'ANDROID_KEY_PASSWORD') {
      androidSigningEnvEntries.push(
        `${config.signing.android.keyPasswordSecretName}: \${{ secrets.${config.signing.android.keyPasswordSecretName} }}`,
      );
    }

    const uniqueEnvLines = Array.from(new Set(androidSigningEnvEntries));
    buildEnvBlock = `        env:\n${uniqueEnvLines.map((line) => `          ${line}`).join('\n')}\n`;
    signingCleanupStep = `

      - name: Cleanup Signing Keystore
        if: always()
        run: rm -f "$RUNNER_TEMP/release.keystore"`;
  } else {
    signingNoticeStep = `
      - name: Android Release Signing Notice
        run: |
          echo "::notice::Automated keystore provisioning is disabled (signing.android.enabled: false). The release build will rely on your project's Gradle signing configuration or produce an unsigned artifact."

`;
  }

  let storePublishingSection = '';
  if (isStorePublishing) {
    const track = config.android.deploymentTrack || 'internal';
    const releaseStatus = config.android.releaseStatus || 'draft';
    const saSecret = config.signing.android.serviceAccountSecretName;
    const artifactFlag = isAab ? '--aab' : '--apk';
    const pkgName =
      config.android.applicationId || project.android.applicationId || 'com.example.app';

    const prodSafeguardBlock =
      track === 'production'
        ? `          if [ "${config.android.allowProductionPublish ? 'true' : 'false'}" != "true" ]; then\n            echo "::error::Production track publishing is blocked by default to prevent accidental store rollouts. Set 'android.allowProductionPublish: true' in react-native-release.config.ts to authorize production deployment."\n            exit 1\n          fi\n`
        : '';

    storePublishingSection = `

      - name: Validate Store Credentials
        env:
          KEYSTORE_BASE64: \${{ secrets.${config.signing.android.keystoreSecretName} }}
          KEYSTORE_PASSWORD: \${{ secrets.${config.signing.android.keystorePasswordSecretName} }}
          KEY_ALIAS: \${{ secrets.${config.signing.android.keyAliasSecretName} }}
          KEY_PASSWORD: \${{ secrets.${config.signing.android.keyPasswordSecretName} }}
          PLAY_SERVICE_ACCOUNT_JSON: \${{ secrets.${saSecret} }}
        run: |
          if [ -z "$KEYSTORE_BASE64" ]; then
            echo "::error::Required secret '${config.signing.android.keystoreSecretName}' is missing."
            exit 1
          fi
          if [ -z "$PLAY_SERVICE_ACCOUNT_JSON" ]; then
            echo "::error::Required secret '${saSecret}' is missing for Google Play publishing."
            exit 1
          fi
          echo "Store credentials verified successfully."

      - name: Setup Ruby for Fastlane
        uses: ${GITHUB_ACTIONS_SHAS.setupRuby}
        with:
          ruby-version: '${config.githubActions.rubyVersion}'
          bundler-cache: true

      - name: Publish to Google Play (${track})
        env:
          PLAY_SERVICE_ACCOUNT_JSON: \${{ secrets.${saSecret} }}
        run: |
${prodSafeguardBlock}          echo "$PLAY_SERVICE_ACCOUNT_JSON" > "$RUNNER_TEMP/play-service-account.json"
          chmod 600 "$RUNNER_TEMP/play-service-account.json"
          ARTIFACT_FILE=\$(ls ${artifactPath} | head -n 1)
          fastlane supply ${artifactFlag} "\$ARTIFACT_FILE" --track "${track}" --release_status "${releaseStatus}" --package_name "${pkgName}" --json_key "$RUNNER_TEMP/play-service-account.json" --skip_upload_metadata true --skip_upload_images true --skip_upload_screenshots true

      - name: Cleanup Google Play Credentials
        if: always()
        run: rm -f "$RUNNER_TEMP/play-service-account.json"`;
  } else if (!isSigningEnabled) {
    storePublishingSection = `

      # Store publishing is disabled by default. Artifacts are safely archived above.
      # To enable store deployment, set githubActions.storePublishing to true in react-native-release.config.ts`;
  }

  let androidReleaseJob = '';
  if (hasAndroid) {
    androidReleaseJob = `  release-android:
    name: Build & Archive Android Release
    runs-on: ${config.githubActions.runner.android}
    steps:
      - name: Checkout repository
        uses: ${GITHUB_ACTIONS_SHAS.checkout}

${pmSteps}

      - name: Setup Java JDK
        uses: ${GITHUB_ACTIONS_SHAS.setupJava}
        with:
          distribution: 'zulu'
          java-version: '${config.githubActions.javaVersion}'

      - name: Grant execute permission for gradlew
        run: chmod +x ${packagePath}/gradlew
${signingPrepareStep}${signingNoticeStep}      - name: Build Android Release ${artifactType.toUpperCase()}
${buildEnvBlock}        run: |
          cd ${packagePath}
          ./gradlew ${buildTask}

      - name: Upload Release Artifact
        uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}
        with:
          name: android-release-\${{ github.ref_name }}-${artifactType}
          path: ${artifactPath}
          if-no-files-found: error
          retention-days: ${retentionDays}${storePublishingSection}${signingCleanupStep}`;
  }

  let iosReleaseJob = '';
  if (hasIOS) {
    const iosSettings = resolveIOSWorkflowSettings(config, project);
    const isIOSStorePublishing = Boolean(
      config.githubActions.storePublishing ||
      config.ios.publishStore ||
      config.ios.uploadToTestFlight,
    );
    const podStep = iosSettings.hasPodfile
      ? `\n\n      - name: Install CocoaPods dependencies\n        run: |\n          cd "${iosSettings.packagePath}"\n          pod install`
      : '';

    const certSecret = config.signing.ios.certificateSecretName;
    const certPwdSecret = config.signing.ios.certificatePasswordSecretName;
    const profileSecret = config.signing.ios.provisioningProfileSecretName;
    const keyContentSecret = config.signing.ios.appStoreConnectKeyContentSecretName;
    const keyIdSecret = config.signing.ios.appStoreConnectKeyIdSecretName;
    const issuerIdSecret = config.signing.ios.appStoreConnectIssuerIdSecretName;

    const signingValidationStep = `

      - name: Validate iOS Release Signing Prerequisites
        env:
          CERT_B64: \${{ secrets.${certSecret} }}
          CERT_PWD: \${{ secrets.${certPwdSecret} }}
          PROFILE_B64: \${{ secrets.${profileSecret} }}
        run: |
          if [ -z "$CERT_B64" ] || [ -z "$PROFILE_B64" ]; then
            echo "::error::iOS release signing prerequisites are not configured. A clean macOS runner cannot sign or export an IPA without signing credentials."
            echo "::notice::Configure the following distribution signing secrets in your GitHub repository:"
            echo "    - ${certSecret}: Base64-encoded .p12 distribution certificate"
            echo "    - ${certPwdSecret}: Password for the .p12 certificate"
            echo "    - ${profileSecret}: Base64-encoded .mobileprovision profile"
            echo "::warning::App Store Connect API credentials alone cannot sign or export an IPA on a clean macOS runner without an installed distribution certificate and provisioning profile."
            exit 1
          fi
          echo "iOS release signing prerequisites verified successfully."

      - name: Provision iOS Distribution Certificate & Profile
        env:
          CERT_B64: \${{ secrets.${certSecret} }}
          CERT_PWD: \${{ secrets.${certPwdSecret} }}
          PROFILE_B64: \${{ secrets.${profileSecret} }}
        run: |
          if [ -n "$CERT_B64" ] && [ -n "$PROFILE_B64" ]; then
            KEYCHAIN_PATH="$RUNNER_TEMP/build.keychain"
            KEYCHAIN_PWD=\$(openssl rand -base64 12)
            security create-keychain -p "$KEYCHAIN_PWD" "$KEYCHAIN_PATH"
            security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
            security unlock-keychain -p "$KEYCHAIN_PWD" "$KEYCHAIN_PATH"
            echo "$CERT_B64" | tr -d '\\n\\r ' | base64 --decode > "$RUNNER_TEMP/cert.p12"
            chmod 600 "$RUNNER_TEMP/cert.p12"
            security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN_PATH" -P "$CERT_PWD" -T /usr/bin/codesign -T /usr/bin/security
            rm -f "$RUNNER_TEMP/cert.p12"
            security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PWD" "$KEYCHAIN_PATH"
            mkdir -p ~/Library/MobileDevice/Provisioning\\ Profiles
            echo "$PROFILE_B64" | tr -d '\\n\\r ' | base64 --decode > ~/Library/MobileDevice/Provisioning\\ Profiles/embedded.mobileprovision
            chmod 600 ~/Library/MobileDevice/Provisioning\\ Profiles/embedded.mobileprovision
            echo "Provisioned iOS distribution certificate and provisioning profile."
          fi`;

    let testFlightSection = '';
    if (isIOSStorePublishing) {
      testFlightSection = `

      - name: Validate App Store Connect Credentials
        env:
          ASC_KEY_CONTENT: \${{ secrets.${keyContentSecret} }}
          ASC_KEY_ID: \${{ secrets.${keyIdSecret} }}
          ASC_ISSUER_ID: \${{ secrets.${issuerIdSecret} }}
        run: |
          if [ -z "$ASC_KEY_CONTENT" ]; then
            echo "::error::Required secret '${keyContentSecret}' is missing for TestFlight publishing."
            exit 1
          fi
          if [ -z "$ASC_KEY_ID" ]; then
            echo "::error::Required secret '${keyIdSecret}' is missing for TestFlight publishing."
            exit 1
          fi
          if [ -z "$ASC_ISSUER_ID" ]; then
            echo "::error::Required secret '${issuerIdSecret}' is missing for TestFlight publishing."
            exit 1
          fi
          echo "App Store Connect credentials verified successfully."

      - name: Setup Ruby for Fastlane
        uses: ${GITHUB_ACTIONS_SHAS.setupRuby}
        with:
          ruby-version: '${config.githubActions.rubyVersion}'

      - name: Install Fastlane
        run: |
          if [ -f "Gemfile" ]; then
            bundle install
          elif [ -f "${iosSettings.packagePath}/Gemfile" ]; then
            cd "${iosSettings.packagePath}"
            bundle install
          else
            gem install fastlane --no-document
          fi

      - name: Publish to Apple TestFlight
        env:
          ASC_KEY_CONTENT: \${{ secrets.${keyContentSecret} }}
          ASC_KEY_ID: \${{ secrets.${keyIdSecret} }}
          ASC_ISSUER_ID: \${{ secrets.${issuerIdSecret} }}
        run: |
          mkdir -p "$RUNNER_TEMP"
          if echo "$ASC_KEY_CONTENT" | grep -q "BEGIN"; then
            IS_B64="false"
          else
            IS_B64="true"
          fi
          cat <<EOF > "$RUNNER_TEMP/asc_key.json"
          {
            "key_id": "$ASC_KEY_ID",
            "issuer_id": "$ASC_ISSUER_ID",
            "key": "$ASC_KEY_CONTENT",
            "is_key_content_base64": \$IS_B64
          }
          EOF
          chmod 600 "$RUNNER_TEMP/asc_key.json"
          ARTIFACT_FILE=\$(ls "${iosSettings.packagePath}/build/output/"*.ipa 2>/dev/null | head -n 1)
          if [ -z "\$ARTIFACT_FILE" ]; then
            echo "::error::No IPA artifact found in ${iosSettings.packagePath}/build/output/ to upload to TestFlight."
            exit 1
          fi
          if [ -f "Gemfile" ]; then
            FASTLANE_CMD="bundle exec fastlane"
          elif [ -f "${iosSettings.packagePath}/Gemfile" ]; then
            FASTLANE_CMD="bundle exec --gemfile=${iosSettings.packagePath}/Gemfile fastlane"
          else
            FASTLANE_CMD="fastlane"
          fi
          \$FASTLANE_CMD pilot upload --ipa "\$ARTIFACT_FILE" --api_key_path "$RUNNER_TEMP/asc_key.json" --skip_waiting_for_build_processing true

      - name: Cleanup App Store Connect Credentials
        if: always()
        run: rm -f "$RUNNER_TEMP/asc_key.json"`;
    } else {
      testFlightSection = `

      # TestFlight publishing is disabled by default. Artifacts are safely archived above.
      # To enable store deployment, set githubActions.storePublishing to true in react-native-release.config.ts`;
    }

    const signingCleanupStep = `

      - name: Cleanup iOS Signing Keychain
        if: always()
        run: |
          security delete-keychain "$RUNNER_TEMP/build.keychain" 2>/dev/null || true
          rm -f "$RUNNER_TEMP/cert.p12" 2>/dev/null || true
          rm -f ~/Library/MobileDevice/Provisioning\\ Profiles/embedded.mobileprovision 2>/dev/null || true`;

    iosReleaseJob = `  release-ios:
    name: Build & Archive iOS Release
    runs-on: ${config.githubActions.runner.ios}
    steps:
      - name: Checkout repository
        uses: ${GITHUB_ACTIONS_SHAS.checkout}

${pmSteps}${podStep}${signingValidationStep}

      - name: Prepare Export Options Plist
        env:
          TEAM_ID: \${{ secrets.IOS_TEAM_ID || secrets.APPLE_TEAM_ID }}
        run: |
          mkdir -p "$RUNNER_TEMP"
          EFFECTIVE_TEAM_ID="${iosSettings.teamId || ''}"
          if [ -z "$EFFECTIVE_TEAM_ID" ] && [ -n "$TEAM_ID" ]; then
            EFFECTIVE_TEAM_ID="$TEAM_ID"
          fi

          cat <<'EOF' > "$RUNNER_TEMP/ExportOptions.plist"
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>method</key>
            <string>${iosSettings.exportMethod}</string>
          EOF

          if [ -n "$EFFECTIVE_TEAM_ID" ]; then
            cat <<EOF >> "$RUNNER_TEMP/ExportOptions.plist"
            <key>teamID</key>
            <string>\$EFFECTIVE_TEAM_ID</string>
          EOF
          fi

          cat <<'EOF' >> "$RUNNER_TEMP/ExportOptions.plist"
            <key>signingStyle</key>
            <string>automatic</string>
            <key>stripSwiftSymbols</key>
            <true/>
          </dict>
          </plist>
          EOF

      - name: Build & Archive iOS App
        run: |
          xcodebuild \\
            ${iosSettings.containerFlag} \\
            -scheme "${iosSettings.scheme}" \\
            -configuration Release \\
            -destination 'generic/platform=iOS' \\
            -archivePath "$RUNNER_TEMP/build/${iosSettings.scheme}.xcarchive" \\
            archive

      - name: Export Release Artifact
        run: |
          mkdir -p "${iosSettings.packagePath}/build/output"
          xcodebuild \\
            -exportArchive \\
            -archivePath "$RUNNER_TEMP/build/${iosSettings.scheme}.xcarchive" \\
            -exportOptionsPlist "$RUNNER_TEMP/ExportOptions.plist" \\
            -exportPath "${iosSettings.packagePath}/build/output"

      - name: Upload iOS Release Artifact
        uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}
        with:
          name: ios-release-\${{ github.ref_name }}-${iosSettings.artifactType}
          path: ${iosSettings.artifactPath}
          if-no-files-found: error
          retention-days: ${retentionDays}${testFlightSection}${signingCleanupStep}`;
  }

  const jobsList: string[] = [];
  if (hasAndroid) {
    jobsList.push(androidReleaseJob);
  }
  if (hasIOS) {
    jobsList.push(iosReleaseJob);
  }
  if (jobsList.length === 0) {
    jobsList.push(`  release-notice:
    name: Release Notification
    runs-on: ubuntu-latest
    steps:
      - name: Notice
        run: echo "No native Android or iOS project enabled or detected for release tag \${{ github.ref_name }}."`);
  }

  const jobsYaml = '\n' + jobsList.join('\n\n');

  return `name: Release Deployment

on:
  push:
    tags:
      - '${tagPattern}'
  workflow_dispatch:

permissions:
  contents: read

jobs:${jobsYaml}
`;
}

export async function generateGitHubWorkflows(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
  options: GenerateWorkflowsOptions = {},
): Promise<WorkflowGenerationResult> {
  const cwd = options.cwd ?? process.cwd();
  const workflows: WorkflowFile[] = [];
  const warnings: string[] = [];

  if (!config.githubActions.enabled) {
    warnings.push(
      'GitHub Actions workflow generation is disabled in configuration (githubActions.enabled is false).',
    );
    return {
      workflows,
      warnings,
    };
  }

  // Warn if conflicting lockfiles detected
  if (project.packageManager.ambiguous) {
    const conflicts = project.packageManager.conflictingLockfiles?.join(', ') || '';
    warnings.push(
      `Ambiguous package manager detection: found conflicting lockfiles (${conflicts}). Using "${config.packageManager}" based on configuration.`,
    );
  }

  // Warn if native Android folder missing when android is enabled
  if (config.android.enabled && !project.android.hasAndroid) {
    warnings.push(
      'Android builds are enabled in configuration, but no "android/" directory was found. Native Android build steps will be omitted from generated workflows.',
    );
  }

  // Validate iOS bundleId placeholder / unresolved macro when iOS is enabled
  if (config.ios.enabled) {
    const effectiveBundleId = config.ios.bundleId ?? project.ios.bundleId;
    if (effectiveBundleId) {
      const bundleValidation = validateIOSBundleId(effectiveBundleId, {
        requireProduction: false,
      });
      if (!bundleValidation.validForDebug) {
        warnings.push(`${bundleValidation.errors[0]} ${bundleValidation.remediation || ''}`.trim());
      } else if (!bundleValidation.validForProduction) {
        warnings.push(
          `${bundleValidation.warnings[0]} ${bundleValidation.remediation || ''}`.trim(),
        );
      }
    }
  }

  // Collect quality script warnings (e.g. when a configured script references a missing package.json script)
  const qualityChecks = resolveQualityChecks(config, project);
  warnings.push(...qualityChecks.warnings);

  const workflowsDir = path.resolve(cwd, '.github', 'workflows');
  const workflowsConfig = config.githubActions.workflows;
  const triggersConfig = config.githubActions.triggers;

  const shouldGeneratePr = workflowsConfig.prValidation && triggersConfig.pullRequest;
  if (workflowsConfig.prValidation !== triggersConfig.pullRequest) {
    if (!triggersConfig.pullRequest) {
      warnings.push(
        'Skipping pr-validation.yml because githubActions.triggers.pullRequest is false (even though githubActions.workflows.prValidation is true).',
      );
    } else {
      warnings.push(
        'Skipping pr-validation.yml because githubActions.workflows.prValidation is false (even though githubActions.triggers.pullRequest is true).',
      );
    }
  }

  if (shouldGeneratePr) {
    const prContent = generatePrValidationWorkflow(config, project);
    workflows.push({
      id: 'pr-validation',
      name: 'PR Validation',
      relativePath: '.github/workflows/pr-validation.yml',
      absolutePath: path.resolve(workflowsDir, 'pr-validation.yml'),
      content: prContent,
    });
  }

  const shouldGenerateMain = workflowsConfig.mainBuild && triggersConfig.main;
  if (workflowsConfig.mainBuild !== triggersConfig.main) {
    if (!triggersConfig.main) {
      warnings.push(
        'Skipping main-build.yml because githubActions.triggers.main is false (even though githubActions.workflows.mainBuild is true).',
      );
    } else {
      warnings.push(
        'Skipping main-build.yml because githubActions.workflows.mainBuild is false (even though githubActions.triggers.main is true).',
      );
    }
  }

  if (shouldGenerateMain) {
    const mainContent = generateMainBuildWorkflow(config, project);
    workflows.push({
      id: 'main-build',
      name: 'Main Branch Build',
      relativePath: '.github/workflows/main-build.yml',
      absolutePath: path.resolve(workflowsDir, 'main-build.yml'),
      content: mainContent,
    });
  }

  const shouldGenerateRelease = workflowsConfig.releaseTag && triggersConfig.releaseTags;
  if (workflowsConfig.releaseTag !== triggersConfig.releaseTags) {
    if (!triggersConfig.releaseTags) {
      warnings.push(
        'Skipping release-tag.yml because githubActions.triggers.releaseTags is false (even though githubActions.workflows.releaseTag is true).',
      );
    } else {
      warnings.push(
        'Skipping release-tag.yml because githubActions.workflows.releaseTag is false (even though githubActions.triggers.releaseTags is true).',
      );
    }
  }

  if (shouldGenerateRelease) {
    const releaseContent = generateReleaseTagWorkflow(config, project);
    workflows.push({
      id: 'release-tag',
      name: 'Release Deployment',
      relativePath: '.github/workflows/release-tag.yml',
      absolutePath: path.resolve(workflowsDir, 'release-tag.yml'),
      content: releaseContent,
    });
  }

  return {
    workflows,
    warnings,
  };
}
