import { z } from 'zod';

export const PackageManagerSchema = z.enum(['npm', 'yarn', 'pnpm', 'bun']);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const AndroidArtifactSchema = z.enum(['aab', 'apk']);
export type AndroidArtifact = z.infer<typeof AndroidArtifactSchema>;

export const AndroidVariantSchema = z.enum(['debug', 'release']);
export type AndroidVariant = z.infer<typeof AndroidVariantSchema>;

export const AndroidTrackSchema = z.enum(['internal', 'closed', 'alpha', 'beta', 'production']);
export type AndroidTrack = z.infer<typeof AndroidTrackSchema>;

export const AndroidReleaseStatusSchema = z.enum(['completed', 'draft', 'inProgress', 'halted']);
export type AndroidReleaseStatus = z.infer<typeof AndroidReleaseStatusSchema>;

export const IOSArtifactSchema = z.enum(['ipa', 'app']);
export type IOSArtifact = z.infer<typeof IOSArtifactSchema>;

export const IOSExportMethodSchema = z.enum(['app-store', 'ad-hoc', 'development', 'enterprise']);
export type IOSExportMethod = z.infer<typeof IOSExportMethodSchema>;

export const ScriptsConfigSchema = z
  .object({
    lint: z.string().optional(),
    typecheck: z.string().optional(),
    test: z.string().optional(),
  })
  .default({});

export const AndroidConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    buildVariant: AndroidVariantSchema.default('release'),
    buildArtifact: AndroidArtifactSchema.default('aab'),
    buildTask: z
      .string()
      .refine((val) => !/[\r\n"`;$&|<>]/.test(val) && !val.includes('..'), {
        message: 'buildTask must not contain shell metacharacters or "..".',
      })
      .default('bundleRelease'),
    appModule: z
      .string()
      .regex(/^:?[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)*$/, {
        message:
          'Invalid appModule format. Expected standard Gradle module name (e.g. "app" or ":clientApp").',
      })
      .default('app'),
    flavor: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, {
        message:
          'Invalid flavor. Expected alphanumeric identifier (e.g. "staging" or "production").',
      })
      .optional(),
    deploymentTrack: AndroidTrackSchema.default('internal'),
    releaseStatus: AndroidReleaseStatusSchema.default('draft'),
    applicationId: z.string().optional(),
    packagePath: z
      .string()
      .refine(
        (val) =>
          !val.startsWith('/') &&
          !val.startsWith('\\') &&
          !val.includes('..') &&
          !/[\r\n"`;$&|<>]/.test(val),
        { message: 'packagePath must be a relative path without ".." or shell metacharacters.' },
      )
      .default('android'),
    publishStore: z.boolean().default(false),
    allowProductionPublish: z.boolean().default(false),
  })
  .default({
    enabled: true,
    buildVariant: 'release',
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    appModule: 'app',
    deploymentTrack: 'internal',
    releaseStatus: 'draft',
    packagePath: 'android',
    publishStore: false,
    allowProductionPublish: false,
  });

export const IOSConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    buildArtifact: IOSArtifactSchema.default('ipa'),
    scheme: z
      .string()
      .refine((val) => !/[\r\n"`;$&|<>]/.test(val) && !val.includes('..'), {
        message: 'Invalid iOS scheme name contains forbidden characters.',
      })
      .optional(),
    workspace: z
      .string()
      .refine(
        (val) =>
          !val.startsWith('/') &&
          !val.startsWith('\\') &&
          !val.includes('..') &&
          !/[\r\n"`;$&|<>]/.test(val),
        { message: 'workspace must be a relative path without ".." or shell metacharacters.' },
      )
      .optional(),
    bundleId: z.string().optional(),
    teamId: z.string().optional(),
    exportMethod: IOSExportMethodSchema.default('app-store'),
    packagePath: z
      .string()
      .refine(
        (val) =>
          !val.startsWith('/') &&
          !val.startsWith('\\') &&
          !val.includes('..') &&
          !/[\r\n"`;$&|<>]/.test(val),
        { message: 'packagePath must be a relative path without ".." or shell metacharacters.' },
      )
      .default('ios'),
    publishStore: z.boolean().default(false),
    uploadToTestFlight: z.boolean().default(false),
  })
  .default({
    enabled: true,
    buildArtifact: 'ipa',
    exportMethod: 'app-store',
    packagePath: 'ios',
    publishStore: false,
    uploadToTestFlight: false,
  });

export const GitHubActionsRunnerSchema = z
  .object({
    android: z.string().default('ubuntu-latest'),
    ios: z.string().default('macos-14'),
  })
  .default({
    android: 'ubuntu-latest',
    ios: 'macos-14',
  });

export const GitHubActionsTriggersSchema = z
  .object({
    pullRequest: z.boolean().default(true),
    main: z.boolean().default(true),
    releaseTags: z.boolean().default(true),
  })
  .default({
    pullRequest: true,
    main: true,
    releaseTags: true,
  });

export const GitHubActionsWorkflowsSchema = z
  .object({
    prValidation: z.boolean().default(true),
    mainBuild: z.boolean().default(true),
    releaseTag: z.boolean().default(true),
  })
  .default({
    prValidation: true,
    mainBuild: true,
    releaseTag: true,
  });

export const GitHubActionsConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    mainBranch: z.string().default('main'),
    releaseTagPattern: z.string().default('v*'),
    artifactRetentionDays: z.number().int().min(1).max(90).default(14),
    triggers: GitHubActionsTriggersSchema.default({
      pullRequest: true,
      main: true,
      releaseTags: true,
    }),
    workflows: GitHubActionsWorkflowsSchema.default({
      prValidation: true,
      mainBuild: true,
      releaseTag: true,
    }),
    cacheDependencies: z.boolean().default(true),
    runner: GitHubActionsRunnerSchema.default({
      android: 'ubuntu-latest',
      ios: 'macos-14',
    }),
    nodeVersion: z.string().default('20'),
    javaVersion: z.string().default('17'),
    rubyVersion: z.string().default('3.3'),
    storePublishing: z.boolean().default(false),
  })
  .default({
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
    runner: {
      android: 'ubuntu-latest',
      ios: 'macos-14',
    },
    nodeVersion: '20',
    javaVersion: '17',
    rubyVersion: '3.3',
    storePublishing: false,
  });

export const AndroidSigningConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    keystorePath: z.string().optional(),
    keystoreSecretName: z.string().default('ANDROID_KEYSTORE_BASE64'),
    keystorePathEnvName: z.string().default('ANDROID_KEYSTORE_PATH'),
    keystorePasswordSecretName: z.string().default('ANDROID_KEYSTORE_PASSWORD'),
    keyAliasSecretName: z.string().default('ANDROID_KEY_ALIAS'),
    keyPasswordSecretName: z.string().default('ANDROID_KEY_PASSWORD'),
    serviceAccountSecretName: z.string().default('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'),
    serviceAccountPathEnvName: z.string().default('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH'),
  })
  .default({
    enabled: false,
    keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
    keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
    keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
    keyAliasSecretName: 'ANDROID_KEY_ALIAS',
    keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
    serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
    serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
  });

export const IOSSigningConfigSchema = z
  .object({
    // Controls local signing configuration and validation helpers. Note: setting `enabled: false`
    // does not disable the signing prerequisites of the generated release-tag workflow, which
    // always produces a signed App Store IPA and requires distribution signing secrets.
    enabled: z.boolean().default(false),
    teamId: z.string().optional(),
    certificateSecretName: z.string().default('IOS_DISTRIBUTION_CERTIFICATE_BASE64'),
    certificatePasswordSecretName: z.string().default('IOS_CERTIFICATE_PASSWORD'),
    provisioningProfileSecretName: z.string().default('IOS_PROVISIONING_PROFILE_BASE64'),
    exportMethod: IOSExportMethodSchema.default('app-store'),
    // Primary secret name for API key content (.p8 content or base64)
    appStoreConnectKeyContentSecretName: z.string().optional(),
    // Backward-compatible alias for appStoreConnectKeyContentSecretName
    appStoreConnectApiKeySecretName: z.string().optional(),
    // Secret name for 10-character key ID
    appStoreConnectKeyIdSecretName: z.string().default('APP_STORE_CONNECT_API_KEY_KEY_ID'),
    // Secret name for App Store Connect issuer UUID
    appStoreConnectIssuerIdSecretName: z.string().default('APP_STORE_CONNECT_API_KEY_ISSUER_ID'),
  })
  .transform((val) => {
    const keyContentSecret =
      val.appStoreConnectKeyContentSecretName ??
      val.appStoreConnectApiKeySecretName ??
      'APP_STORE_CONNECT_API_KEY_KEY_CONTENT';

    return {
      enabled: val.enabled ?? false,
      teamId: val.teamId,
      certificateSecretName: val.certificateSecretName ?? 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
      certificatePasswordSecretName:
        val.certificatePasswordSecretName ?? 'IOS_CERTIFICATE_PASSWORD',
      provisioningProfileSecretName:
        val.provisioningProfileSecretName ?? 'IOS_PROVISIONING_PROFILE_BASE64',
      exportMethod: val.exportMethod ?? 'app-store',
      appStoreConnectKeyContentSecretName: keyContentSecret,
      appStoreConnectApiKeySecretName: keyContentSecret,
      appStoreConnectKeyIdSecretName: val.appStoreConnectKeyIdSecretName,
      appStoreConnectIssuerIdSecretName: val.appStoreConnectIssuerIdSecretName,
    };
  })
  .default({
    enabled: false,
    certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
    certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
    provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
    exportMethod: 'app-store',
    appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
    appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
  });

export const SigningConfigSchema = z
  .object({
    android: AndroidSigningConfigSchema.default({
      enabled: false,
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
      serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
    }),
    ios: IOSSigningConfigSchema.default({
      appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
      appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
    }),
  })
  .default({
    android: {
      enabled: false,
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
      serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
    },
    ios: {
      appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
      appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
    },
  });

export const ReleaseKitConfigSchema = z.object({
  projectName: z.string().min(1, 'Project name is required'),
  packageManager: PackageManagerSchema.default('npm'),
  projectRoot: z.string().default('.'),
  scripts: ScriptsConfigSchema.default({}),
  android: AndroidConfigSchema.default({
    enabled: true,
    buildVariant: 'release',
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    appModule: 'app',
    deploymentTrack: 'internal',
    releaseStatus: 'draft',
    packagePath: 'android',
    publishStore: false,
    allowProductionPublish: false,
  }),
  ios: IOSConfigSchema.default({
    enabled: true,
    buildArtifact: 'ipa',
    exportMethod: 'app-store',
    packagePath: 'ios',
  }),
  githubActions: GitHubActionsConfigSchema.default({
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
    runner: {
      android: 'ubuntu-latest',
      ios: 'macos-14',
    },
    nodeVersion: '20',
    javaVersion: '17',
    rubyVersion: '3.3',
    storePublishing: false,
  }),
  signing: SigningConfigSchema.default({
    android: {
      enabled: false,
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
      serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
    },
    ios: {
      appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
      appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
      appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
    },
  }),
});

export type ReleaseKitConfig = z.infer<typeof ReleaseKitConfigSchema>;
export type ReleaseKitUserConfig = z.input<typeof ReleaseKitConfigSchema>;
