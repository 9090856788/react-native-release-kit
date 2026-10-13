import path from 'node:path';
import type { ReleaseKitConfig } from '../config/schema.js';
import type { ProjectDetectionResult } from '../detector/types.js';

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
} as const;

import { getFrozenInstallCommand } from '../detector/package-manager.js';

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

function buildQualityCheckSteps(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string[] {
  const steps: string[] = [];
  const scripts = project.scripts || {};
  const pm = config.packageManager || project.packageManager.manager;
  const runner = pm === 'npm' ? 'npm run' : pm;
  const testRunner = pm === 'npm' ? 'npm test' : `${pm} test`;

  if (scripts['lint']) {
    steps.push(`      - name: Run Lint
        run: ${config.scripts.lint || `${runner} lint`}`);
  }

  if (scripts['typecheck']) {
    steps.push(`      - name: Run Typecheck
        run: ${config.scripts.typecheck || `${runner} typecheck`}`);
  }

  if (scripts['test']) {
    steps.push(`      - name: Run Tests
        run: ${config.scripts.test || testRunner}`);
  }

  if (steps.length === 0) {
    steps.push(`      - name: Verify Environment
        run: node --version`);
  }

  return steps;
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

export function generateMainBuildWorkflow(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string {
  const mainBranch = config.githubActions.mainBranch;
  const pmSteps = buildPackageManagerSteps(config, project);
  const checkSteps = buildQualityCheckSteps(config, project).join('\n\n');
  const hasAndroid = config.android.enabled && project.android.hasAndroid;
  const retentionDays = config.githubActions.artifactRetentionDays;
  const isAab = config.android.buildArtifact === 'aab';
  const artifactType = isAab ? 'aab' : 'apk';
  const buildTask = isAab ? 'bundleDebug' : 'assembleDebug';
  const artifactPath = isAab
    ? 'android/app/build/outputs/bundle/debug/*.aab'
    : 'android/app/build/outputs/apk/debug/*.apk';

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
        run: chmod +x android/gradlew

      - name: Build Android ${artifactType.toUpperCase()}
        run: |
          cd android
          ./gradlew ${buildTask}

      - name: Upload Android Build Artifact
        uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}
        with:
          name: android-\${{ github.sha }}-${artifactType}
          path: ${artifactPath}
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

${checkSteps}${androidJobYaml}
`;
}

export function generateReleaseTagWorkflow(
  config: ReleaseKitConfig,
  project: ProjectDetectionResult,
): string {
  const tagPattern = config.githubActions.releaseTagPattern;
  const pmSteps = buildPackageManagerSteps(config, project);
  const hasAndroid = config.android.enabled && project.android.hasAndroid;
  const retentionDays = config.githubActions.artifactRetentionDays;
  const isAab = config.android.buildArtifact === 'aab';
  const artifactType = isAab ? 'aab' : 'apk';
  const buildTask = config.android.buildTask || (isAab ? 'bundleRelease' : 'assembleRelease');
  const artifactPath = isAab
    ? 'android/app/build/outputs/bundle/release/*.aab'
    : 'android/app/build/outputs/apk/release/*.apk';

  let storePublishingSection = '';
  if (config.githubActions.storePublishing) {
    storePublishingSection = `

      - name: Validate Store Credentials
        env:
          KEYSTORE_BASE64: \${{ secrets.${config.signing.android.keystoreSecretName} }}
          KEYSTORE_PASSWORD: \${{ secrets.${config.signing.android.keystorePasswordSecretName} }}
          KEY_ALIAS: \${{ secrets.${config.signing.android.keyAliasSecretName} }}
          KEY_PASSWORD: \${{ secrets.${config.signing.android.keyPasswordSecretName} }}
        run: |
          if [ -z "$KEYSTORE_BASE64" ]; then
            echo "::error::Required secret '${config.signing.android.keystoreSecretName}' is missing."
            exit 1
          fi
          echo "Store credentials verified successfully."`;
  } else {
    storePublishingSection = `

      # Store publishing is disabled by default. Artifacts are safely archived above.
      # To enable store deployment, set githubActions.storePublishing to true in react-native-release.config.ts`;
  }

  let androidReleaseJob = '';
  if (hasAndroid) {
    androidReleaseJob = `
  release-android:
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
        run: chmod +x android/gradlew

      - name: Build Android Release ${artifactType.toUpperCase()}
        run: |
          cd android
          ./gradlew ${buildTask}

      - name: Upload Release Artifact
        uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}
        with:
          name: android-release-\${{ github.ref_name }}-${artifactType}
          path: ${artifactPath}
          if-no-files-found: error
          retention-days: ${retentionDays}${storePublishingSection}`;
  } else {
    androidReleaseJob = `
  release-notice:
    name: Release Notification
    runs-on: ubuntu-latest
    steps:
      - name: Notice
        run: echo "No native Android project enabled or detected for release tag \${{ github.ref_name }}."`;
  }

  return `name: Release Deployment

on:
  push:
    tags:
      - '${tagPattern}'
  workflow_dispatch:

permissions:
  contents: read

jobs:${androidReleaseJob}
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

  const workflowsDir = path.resolve(cwd, '.github', 'workflows');
  const workflowsConfig = config.githubActions.workflows;

  if (workflowsConfig.prValidation) {
    const prContent = generatePrValidationWorkflow(config, project);
    workflows.push({
      id: 'pr-validation',
      name: 'PR Validation',
      relativePath: '.github/workflows/pr-validation.yml',
      absolutePath: path.resolve(workflowsDir, 'pr-validation.yml'),
      content: prContent,
    });
  }

  if (workflowsConfig.mainBuild) {
    const mainContent = generateMainBuildWorkflow(config, project);
    workflows.push({
      id: 'main-build',
      name: 'Main Branch Build',
      relativePath: '.github/workflows/main-build.yml',
      absolutePath: path.resolve(workflowsDir, 'main-build.yml'),
      content: mainContent,
    });
  }

  if (workflowsConfig.releaseTag) {
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
