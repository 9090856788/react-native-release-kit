import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type {
  ReleaseKitConfig,
  AndroidArtifact,
  AndroidVariant,
  AndroidTrack,
} from '../config/schema.js';
import { detectAndroid } from '../detector/android.js';
import { validateRequiredSecretNames } from '../validators/secrets.js';
import { safeExec } from '../utils/process.js';
import { logger, maskSecrets, registerSecretForRedaction } from '../utils/logger.js';
import { readFileUtf8 } from '../utils/fs.js';
import { configureAndroidReleaseSigning } from './android-signing-config.js';

export const SUPPORTED_ANDROID_TRACKS: readonly AndroidTrack[] = [
  'internal',
  'closed',
  'alpha',
  'beta',
  'production',
];

export interface AndroidBuildOptions {
  cwd?: string;
  variant?: AndroidVariant;
  artifact?: AndroidArtifact;
  appModule?: string;
  flavor?: string;
  buildTask?: string;
  sign?: boolean;
  timeoutMs?: number;
  dryRun?: boolean;
  skipEnvCheck?: boolean;
  env?: NodeJS.ProcessEnv;
  extraGradleArgs?: string[];
}

export interface AndroidProjectValidationResult {
  valid: boolean;
  androidDir: string;
  gradlewPath?: string;
  appModule: string;
  applicationId?: string;
  errors: string[];
  warnings: string[];
  remediations: string[];
}

export interface AndroidSigningValidationResult {
  valid: boolean;
  mode: 'file' | 'base64' | 'none';
  keystorePath?: string;
  missingVars: string[];
  errors: string[];
  remediations: string[];
}

export interface AndroidBuildResult {
  success: boolean;
  artifactPath?: string;
  artifactSize?: number;
  artifactType: AndroidArtifact;
  variant: AndroidVariant;
  flavor?: string;
  appModule: string;
  gradleTask: string;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  remediation?: string;
}

export interface ResolveGradleTaskOptions {
  variant: AndroidVariant;
  artifact: AndroidArtifact;
  appModule?: string;
  flavor?: string;
  customTask?: string;
}

function capitalize(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Resolves the module-qualified Gradle task name for the requested build variant, artifact, and flavor.
 */
export function resolveGradleTask(options: ResolveGradleTaskOptions): string {
  const appModule = options.appModule || 'app';

  if (options.customTask && options.customTask.trim().length > 0) {
    const trimmed = options.customTask.trim();
    const clean = trimmed.replace(/^:+/, '');
    if (clean.startsWith(`${appModule}:`)) {
      return `:${clean}`;
    }
    if (clean.includes(':')) {
      return `:${clean}`;
    }
    return `:${appModule}:${clean}`;
  }

  const verb = options.artifact === 'aab' ? 'bundle' : 'assemble';
  const flavorPart = options.flavor ? capitalize(options.flavor.trim()) : '';
  const variantPart = capitalize(options.variant);

  return `:${appModule}:${verb}${flavorPart}${variantPart}`;
}

/**
 * Normalizes Gradle task for workflow shell execution (cd android && ./gradlew <task>).
 * Strips duplicate or malformed colons while ensuring custom modules (e.g. :mobile, :clientApp)
 * are properly qualified with their module prefix.
 */
export function formatGradleTaskForWorkflow(task: string, appModule: string = 'app'): string {
  const trimmed = task.trim();
  const clean = trimmed.replace(/^:+/, '');

  if (appModule === 'app') {
    if (clean.includes(':') || trimmed.startsWith(':')) {
      return `:${clean}`;
    }
    return clean;
  }

  if (clean.startsWith(`${appModule}:`)) {
    return `:${clean}`;
  }
  if (clean.includes(':')) {
    return `:${clean}`;
  }
  return `:${appModule}:${clean}`;
}

function isLikelyValidBase64(input: string): boolean {
  const cleaned = input.replace(/\s+/g, '');
  if (cleaned.length < 16 || cleaned.length % 4 !== 0) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return false;
  }
  try {
    const buf = Buffer.from(cleaned, 'base64');
    return buf.length >= 12;
  } catch {
    return false;
  }
}

/**
 * Validates Android release signing environment variables and secret naming without logging secret values.
 */
export function validateAndroidSigning(
  config: ReleaseKitConfig,
  env: NodeJS.ProcessEnv = process.env,
): AndroidSigningValidationResult {
  const signingCfg = config.signing.android;
  const errors: string[] = [];
  const remediations: string[] = [];
  const missingVars: string[] = [];

  const nameValidation = validateRequiredSecretNames([
    signingCfg.keystoreSecretName,
    signingCfg.keystorePathEnvName,
    signingCfg.keystorePasswordSecretName,
    signingCfg.keyAliasSecretName,
    signingCfg.keyPasswordSecretName,
  ]);

  if (!nameValidation.valid) {
    errors.push(...nameValidation.errors);
    remediations.push(
      'Ensure all signing secret names in react-native-release.config.ts use SCREAMING_SNAKE_CASE env var names, not raw secret values.',
    );
    return {
      valid: false,
      mode: 'none',
      missingVars,
      errors,
      remediations,
    };
  }

  const configuredPath = config.signing.android.keystorePath?.trim();
  const keystorePathVal =
    env[signingCfg.keystorePathEnvName]?.trim() ||
    (configuredPath ? path.resolve(configuredPath) : undefined);
  const keystoreBase64Val = env[signingCfg.keystoreSecretName]?.trim();
  const keystorePassVal = env[signingCfg.keystorePasswordSecretName]?.trim();
  const keyAliasVal = env[signingCfg.keyAliasSecretName]?.trim();
  const keyPassVal = env[signingCfg.keyPasswordSecretName]?.trim();

  // Register any present secrets for automatic log redaction
  registerSecretForRedaction(keystoreBase64Val);
  registerSecretForRedaction(keystorePassVal);
  registerSecretForRedaction(keyAliasVal);
  registerSecretForRedaction(keyPassVal);

  let mode: 'file' | 'base64' | 'none' = 'none';
  if (keystorePathVal) {
    mode = 'file';
    if (!existsSync(keystorePathVal)) {
      errors.push(
        `Keystore file specified by ${signingCfg.keystorePathEnvName} (or config.signing.android.keystorePath) does not exist at path: ${keystorePathVal}`,
      );
      remediations.push(
        `Verify the file path in ${signingCfg.keystorePathEnvName} or provide a base64-encoded keystore via ${signingCfg.keystoreSecretName}.`,
      );
    }
  } else if (keystoreBase64Val) {
    mode = 'base64';
    if (!isLikelyValidBase64(keystoreBase64Val)) {
      errors.push(
        `Environment variable ${signingCfg.keystoreSecretName} does not contain valid base64-encoded keystore data.`,
      );
      remediations.push(
        `Encode your release keystore with "base64 -i release.keystore | tr -d '\\n'" and store it in ${signingCfg.keystoreSecretName}.`,
      );
    }
  } else {
    missingVars.push(`${signingCfg.keystoreSecretName} (or ${signingCfg.keystorePathEnvName})`);
  }

  if (!keystorePassVal) {
    missingVars.push(signingCfg.keystorePasswordSecretName);
  }
  if (!keyAliasVal) {
    missingVars.push(signingCfg.keyAliasSecretName);
  }
  if (!keyPassVal) {
    missingVars.push(signingCfg.keyPasswordSecretName);
  }

  if (missingVars.length > 0) {
    errors.push(
      `Missing required Android release signing environment variables: ${missingVars.join(', ')}`,
    );
    remediations.push(
      `Export the required environment variables locally or configure them as GitHub Actions secrets before running a signed release build.`,
    );
  }

  return {
    valid: errors.length === 0,
    mode,
    keystorePath: keystorePathVal,
    missingVars,
    errors,
    remediations,
  };
}

export interface ProvisionedKeystore {
  keystorePath: string;
  isTemporary: boolean;
  envOverrides: Record<string, string>;
  cleanup: () => Promise<void>;
}

/**
 * Provisions a temporary keystore file (0o600) if base64 secret is used, or resolves existing keystore path.
 */
export async function provisionSigningKeystore(
  config: ReleaseKitConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProvisionedKeystore> {
  const signingCfg = config.signing.android;
  const configuredPath = config.signing.android.keystorePath?.trim();
  const keystorePathVal =
    env[signingCfg.keystorePathEnvName]?.trim() ||
    (configuredPath ? path.resolve(configuredPath) : undefined);
  const keystoreBase64Val = env[signingCfg.keystoreSecretName]?.trim();
  const keystorePassword = env[signingCfg.keystorePasswordSecretName]?.trim() || '';
  const keyAlias = env[signingCfg.keyAliasSecretName]?.trim() || '';
  const keyPassword = env[signingCfg.keyPasswordSecretName]?.trim() || '';

  registerSecretForRedaction(keystoreBase64Val);
  registerSecretForRedaction(keystorePassword);
  registerSecretForRedaction(keyAlias);
  registerSecretForRedaction(keyPassword);

  let resolvedPath = '';
  let isTemporary = false;

  if (keystorePathVal) {
    resolvedPath = path.resolve(keystorePathVal);
  } else if (keystoreBase64Val) {
    const cleaned = keystoreBase64Val.replace(/\s+/g, '');
    const buffer = Buffer.from(cleaned, 'base64');
    resolvedPath = path.join(
      tmpdir(),
      `rn-release-keystore-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.keystore`,
    );
    await fs.writeFile(resolvedPath, buffer, { mode: 0o600 });
    isTemporary = true;
  } else {
    throw new Error('Cannot provision keystore: neither keystore path nor base64 content is set.');
  }

  const envOverrides: Record<string, string> = {
    [signingCfg.keystorePathEnvName]: resolvedPath,
    [signingCfg.keystorePasswordSecretName]: keystorePassword,
    [signingCfg.keyAliasSecretName]: keyAlias,
    [signingCfg.keyPasswordSecretName]: keyPassword,
    ANDROID_KEYSTORE_PATH: resolvedPath,
    ANDROID_KEYSTORE_PASSWORD: keystorePassword,
    ANDROID_KEY_ALIAS: keyAlias,
    ANDROID_KEY_PASSWORD: keyPassword,
    ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PATH: resolvedPath,
    ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PASSWORD: keystorePassword,
    ORG_GRADLE_PROJECT_ANDROID_KEY_ALIAS: keyAlias,
    ORG_GRADLE_PROJECT_ANDROID_KEY_PASSWORD: keyPassword,
    ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_FILE: resolvedPath,
    ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_PASSWORD: keystorePassword,
    ORG_GRADLE_PROJECT_MYAPP_UPLOAD_KEY_ALIAS: keyAlias,
    ORG_GRADLE_PROJECT_MYAPP_UPLOAD_KEY_PASSWORD: keyPassword,
  };

  let exitHook: (() => void) | undefined;
  if (isTemporary) {
    exitHook = () => {
      try {
        if (existsSync(resolvedPath)) {
          rmSync(resolvedPath, { force: true });
        }
      } catch {
        // Ignore exit hook cleanup errors
      }
    };
    process.once('exit', exitHook);
    process.once('SIGINT', exitHook);
    process.once('SIGTERM', exitHook);
  }

  return {
    keystorePath: resolvedPath,
    isTemporary,
    envOverrides,
    cleanup: async () => {
      if (exitHook) {
        process.removeListener('exit', exitHook);
        process.removeListener('SIGINT', exitHook);
        process.removeListener('SIGTERM', exitHook);
      }
      if (isTemporary && resolvedPath) {
        try {
          await fs.rm(resolvedPath, { force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  };
}

function collectFilesWithExtension(dirPath: string, ext: string): string[] {
  const results: string[] = [];
  if (!existsSync(dirPath)) return results;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFilesWithExtension(fullPath, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return results;
}

/**
 * Locates and validates the generated APK or AAB artifact after a Gradle build.
 */
export function locateBuiltArtifact(
  androidDir: string,
  options: {
    appModule: string;
    artifact: AndroidArtifact;
    variant: AndroidVariant;
    flavor?: string;
  },
): {
  found: boolean;
  artifactPath?: string;
  size?: number;
  searchedPaths: string[];
  error?: string;
} {
  const { appModule, artifact, variant, flavor } = options;
  const ext = `.${artifact}`;
  const outputsBase = path.resolve(androidDir, appModule, 'build', 'outputs');
  const searchedPaths: string[] = [];

  if (artifact === 'aab') {
    const variantDirName = flavor ? `${flavor}${capitalize(variant)}` : variant;
    const primaryDir = path.join(outputsBase, 'bundle', variantDirName);
    searchedPaths.push(primaryDir);
  } else {
    if (flavor) {
      searchedPaths.push(path.join(outputsBase, 'apk', flavor, variant));
      searchedPaths.push(path.join(outputsBase, 'apk', `${flavor}${capitalize(variant)}`));
    } else {
      searchedPaths.push(path.join(outputsBase, 'apk', variant));
    }
  }

  const candidateFiles: string[] = [];
  for (const searchDir of searchedPaths) {
    candidateFiles.push(...collectFilesWithExtension(searchDir, ext));
  }

  // Fallback recursive search under outputs/bundle or outputs/apk if primary directory had a custom flavor dimension structure
  if (candidateFiles.length === 0) {
    const fallbackRoot = path.join(outputsBase, artifact === 'aab' ? 'bundle' : 'apk');
    if (!searchedPaths.includes(fallbackRoot)) {
      searchedPaths.push(fallbackRoot);
    }
    const allInType = collectFilesWithExtension(fallbackRoot, ext);
    const matchingVariant = allInType.filter((f) =>
      f.toLowerCase().includes(variant.toLowerCase()),
    );
    candidateFiles.push(...(matchingVariant.length > 0 ? matchingVariant : allInType));
  }

  if (candidateFiles.length === 0) {
    return {
      found: false,
      searchedPaths,
      error: `Expected ${artifact.toUpperCase()} artifact was not found in: ${searchedPaths.join(', ')}`,
    };
  }

  const chosen = candidateFiles[0]!;
  try {
    const stat = statSync(chosen);
    if (!stat.isFile() || stat.size === 0) {
      return {
        found: false,
        artifactPath: chosen,
        size: stat.size,
        searchedPaths,
        error: `Generated artifact at ${chosen} is empty (0 bytes) or invalid.`,
      };
    }

    return {
      found: true,
      artifactPath: chosen,
      size: stat.size,
      searchedPaths,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      found: false,
      searchedPaths,
      error: `Failed to inspect artifact at ${chosen}: ${msg}`,
    };
  }
}

async function hasLocalPropertiesSdkDir(androidDir: string): Promise<boolean> {
  const localPropsPath = path.join(androidDir, 'local.properties');
  if (!existsSync(localPropsPath)) return false;
  try {
    const content = await readFileUtf8(localPropsPath);
    const match = content.match(/^sdk\.dir\s*=\s*(.+)$/m);
    if (match?.[1]) {
      const sdkPath = match[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\');
      return existsSync(sdkPath);
    }
  } catch {
    // Ignore
  }
  return false;
}

export class AndroidAdapter {
  constructor(private config: ReleaseKitConfig) {}

  /**
   * Validates the Android Gradle project structure, application module, wrapper, Java JDK, and Android SDK.
   */
  public async validateProject(
    cwd: string = process.cwd(),
    options: {
      appModule?: string;
      skipEnvCheck?: boolean;
      env?: NodeJS.ProcessEnv;
    } = {},
  ): Promise<AndroidProjectValidationResult> {
    const packagePath = this.config.android.packagePath || 'android';
    const androidDir = path.resolve(cwd, packagePath);
    const requestedModule = options.appModule || this.config.android.appModule;
    const env = options.env ?? process.env;

    const errors: string[] = [];
    const warnings: string[] = [];
    const remediations: string[] = [];

    const detection = await detectAndroid(cwd, {
      packagePath,
      appModule: requestedModule,
    });

    const appModule = detection.appModule || requestedModule || 'app';

    if (!detection.hasAndroid) {
      errors.push(`Android project directory not found at "${androidDir}".`);
      remediations.push(
        `Verify you are running inside a React Native CLI project root or set "android.packagePath" in react-native-release.config.ts.`,
      );
      return {
        valid: false,
        androidDir,
        appModule,
        errors,
        warnings,
        remediations,
      };
    }

    if (!detection.hasGradlew || !detection.gradlewPath) {
      errors.push(`Gradle wrapper script ("gradlew") not found inside "${androidDir}".`);
      remediations.push(
        `Restore the Gradle wrapper in "${packagePath}/gradlew" (and "${packagePath}/gradle/wrapper/"). Do not rely on a global Gradle installation.`,
      );
    }

    if (!detection.buildGradleFound) {
      const availableHint =
        detection.detectedModules && detection.detectedModules.length > 0
          ? ` Detected modules: ${detection.detectedModules.join(', ')}.`
          : '';
      errors.push(
        `Android application module "${appModule}" does not have a build.gradle or build.gradle.kts file in "${path.join(androidDir, appModule)}".${availableHint}`,
      );
      remediations.push(
        `Specify the correct application module via "--module <name>" or "android.appModule" in react-native-release.config.ts.`,
      );
    }

    if (!options.skipEnvCheck) {
      // Check Java availability
      const javaHome = env.JAVA_HOME;
      if (javaHome && !existsSync(javaHome)) {
        errors.push(`JAVA_HOME points to a non-existent directory: "${javaHome}".`);
        remediations.push(
          'Install JDK 17+ and update JAVA_HOME to point to a valid JDK installation.',
        );
      } else if (!javaHome) {
        const javaCheck = await safeExec('java', ['-version'], { silent: true, env });
        if (javaCheck.exitCode !== 0) {
          errors.push(
            'Java Development Kit (JDK) was not detected (JAVA_HOME is unset and "java" is not in PATH).',
          );
          remediations.push('Install OpenJDK 17 and set JAVA_HOME before running Android builds.');
        }
      }

      // Check Android SDK availability
      const androidHome = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
      const hasSdkEnv = Boolean(androidHome && existsSync(androidHome));
      const hasLocalProps = await hasLocalPropertiesSdkDir(androidDir);

      if (!hasSdkEnv && !hasLocalProps) {
        errors.push(
          'Android SDK location not found. Neither ANDROID_HOME, ANDROID_SDK_ROOT, nor android/local.properties (sdk.dir) points to an existing SDK directory.',
        );
        remediations.push(
          'Set ANDROID_HOME to your Android SDK path (e.g. export ANDROID_HOME=$HOME/Library/Android/sdk) or configure sdk.dir in android/local.properties.',
        );
      }
    }

    return {
      valid: errors.length === 0,
      androidDir,
      gradlewPath: detection.gradlewPath,
      appModule,
      applicationId: this.config.android.applicationId || detection.applicationId,
      errors,
      warnings,
      remediations,
    };
  }

  /**
   * Executes an Android Gradle build (debug or release, APK or AAB) with optional release signing and artifact verification.
   */
  public async build(options: AndroidBuildOptions = {}): Promise<AndroidBuildResult> {
    const startTime = Date.now();
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;

    const variant: AndroidVariant =
      options.variant ?? this.config.android.buildVariant ?? 'release';

    // Default debug builds to APK unless artifact was explicitly passed; release builds use configured buildArtifact (default AAB)
    const artifact: AndroidArtifact =
      options.artifact ??
      (variant === 'debug' ? 'apk' : (this.config.android.buildArtifact ?? 'aab'));

    const flavor = options.flavor ?? this.config.android.flavor;

    // 1. Validate project & prerequisites
    const validation = await this.validateProject(cwd, {
      appModule: options.appModule,
      skipEnvCheck: options.skipEnvCheck,
      env,
    });

    const appModule = validation.appModule;

    // Determine if custom buildTask from config should be used
    const customTask =
      options.buildTask ??
      (!options.variant &&
      !options.artifact &&
      !options.flavor &&
      this.config.android.buildTask &&
      this.config.android.buildTask !== 'bundleRelease'
        ? this.config.android.buildTask
        : undefined);

    const gradleTask = resolveGradleTask({
      variant,
      artifact,
      appModule,
      flavor,
      customTask,
    });

    if (!validation.valid) {
      return {
        success: false,
        artifactType: artifact,
        variant,
        flavor,
        appModule,
        gradleTask,
        durationMs: Date.now() - startTime,
        error: validation.errors.join(' '),
        remediation: validation.remediations.join(' '),
      };
    }

    // 2. Check release signing if building release and signing is enabled
    const shouldSign =
      variant === 'release' && (options.sign ?? this.config.signing.android.enabled);

    const detection = await detectAndroid(cwd, {
      packagePath: this.config.android.packagePath,
      appModule,
    });

    if (shouldSign && detection.usesDebugSigningInRelease) {
      try {
        const configResult = await configureAndroidReleaseSigning({
          projectRoot: cwd,
          androidDir: validation.androidDir,
          appModule,
          dryRun: options.dryRun,
        });
        if (configResult.changed) {
          if (options.dryRun) {
            logger.info(
              `[DRY RUN] Would configure Android release signing in ${configResult.filePath}.`,
            );
          } else {
            logger.info(
              `Automatically configured Android release signing in ${configResult.filePath}.`,
            );
          }
        }
      } catch {
        return {
          success: false,
          artifactType: artifact,
          variant,
          flavor,
          appModule,
          gradleTask,
          durationMs: Date.now() - startTime,
          error: `Unsafe Android release signing configuration: application module "${appModule}" has "signingConfig signingConfigs.debug" configured for the release build type in build.gradle. Gradle would silently sign this release artifact with the insecure debug key.`,
          remediation: `Configure a dedicated release signingConfig in android/${appModule}/build.gradle backed by environment variables (e.g. ANDROID_KEYSTORE_PATH) or Gradle properties before building signed releases.`,
        };
      }
    }

    if (!shouldSign && variant === 'release' && detection.usesDebugSigningInRelease) {
      logger.warn(
        `Android release build type uses debug signing configuration (signingConfigs.debug). Configure production release signing before store deployment.`,
      );
    }

    let provisionedKeystore: ProvisionedKeystore | undefined;

    try {
      if (shouldSign) {
        const signingValidation = validateAndroidSigning(this.config, env);
        if (!signingValidation.valid) {
          return {
            success: false,
            artifactType: artifact,
            variant,
            flavor,
            appModule,
            gradleTask,
            durationMs: Date.now() - startTime,
            error: signingValidation.errors.join(' '),
            remediation: signingValidation.remediations.join(' '),
          };
        }

        if (!options.dryRun) {
          provisionedKeystore = await provisionSigningKeystore(this.config, env);
        }
      }

      if (options.dryRun) {
        return {
          success: true,
          artifactType: artifact,
          variant,
          flavor,
          appModule,
          gradleTask,
          durationMs: Date.now() - startTime,
        };
      }

      const gradlewPath = validation.gradlewPath!;

      // Ensure gradlew is executable on Unix-like systems
      if (process.platform !== 'win32') {
        try {
          await fs.chmod(gradlewPath, 0o755);
        } catch {
          // Ignore if chmod not permitted
        }
      }

      const gradleArgs = [gradleTask, '--console=plain', ...(options.extraGradleArgs ?? [])];

      const execEnv: NodeJS.ProcessEnv = {
        ...env,
        ...(provisionedKeystore?.envOverrides ?? {}),
      };

      logger.debug(`Running Gradle task "${gradleTask}" in ${validation.androidDir}...`);

      const execResult = await safeExec(gradlewPath, gradleArgs, {
        cwd: validation.androidDir,
        env: execEnv,
        timeout: options.timeoutMs ?? 30 * 60 * 1000,
      });

      const sanitizedStdout = maskSecrets(execResult.stdout);
      const sanitizedStderr = maskSecrets(execResult.stderr);

      if (execResult.exitCode !== 0) {
        const failureSummary =
          sanitizedStderr.trim() ||
          sanitizedStdout.trim().split('\n').slice(-10).join('\n') ||
          `Gradle exited with code ${execResult.exitCode}`;

        return {
          success: false,
          artifactType: artifact,
          variant,
          flavor,
          appModule,
          gradleTask,
          durationMs: Date.now() - startTime,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
          error: `Gradle task "${gradleTask}" failed (exit code ${execResult.exitCode}): ${failureSummary}`,
          remediation:
            'Inspect the Gradle error output above, or run "./gradlew ' +
            gradleTask +
            ' --stacktrace" inside your android/ directory for detailed diagnostics.',
        };
      }

      // 3. Locate and verify generated artifact
      const artifactCheck = locateBuiltArtifact(validation.androidDir, {
        appModule,
        artifact,
        variant,
        flavor,
      });

      if (!artifactCheck.found || !artifactCheck.artifactPath) {
        return {
          success: false,
          artifactType: artifact,
          variant,
          flavor,
          appModule,
          gradleTask,
          durationMs: Date.now() - startTime,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
          error:
            artifactCheck.error ||
            `Gradle task "${gradleTask}" exited with 0, but no ${artifact.toUpperCase()} artifact was produced.`,
          remediation:
            'Verify your Gradle buildTypes/productFlavors output configuration and ensure the task generates an output binary.',
        };
      }

      return {
        success: true,
        artifactPath: artifactCheck.artifactPath,
        artifactSize: artifactCheck.size,
        artifactType: artifact,
        variant,
        flavor,
        appModule,
        gradleTask,
        durationMs: Date.now() - startTime,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
      };
    } finally {
      if (provisionedKeystore) {
        await provisionedKeystore.cleanup();
      }
    }
  }
}
