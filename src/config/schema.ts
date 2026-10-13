import { z } from 'zod';

export const PackageManagerSchema = z.enum(['npm', 'yarn', 'pnpm', 'bun']);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const AndroidArtifactSchema = z.enum(['aab', 'apk']);
export type AndroidArtifact = z.infer<typeof AndroidArtifactSchema>;

export const AndroidTrackSchema = z.enum(['internal', 'alpha', 'beta', 'production']);
export type AndroidTrack = z.infer<typeof AndroidTrackSchema>;

export const IOSArtifactSchema = z.enum(['ipa', 'app']);
export type IOSArtifact = z.infer<typeof IOSArtifactSchema>;

export const IOSExportMethodSchema = z.enum(['app-store', 'ad-hoc', 'development', 'enterprise']);
export type IOSExportMethod = z.infer<typeof IOSExportMethodSchema>;

export const ScriptsConfigSchema = z
  .object({
    lint: z.string().default('npm run lint'),
    typecheck: z.string().default('npm run typecheck'),
    test: z.string().default('npm test'),
  })
  .default({
    lint: 'npm run lint',
    typecheck: 'npm run typecheck',
    test: 'npm test',
  });

export const AndroidConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    buildArtifact: AndroidArtifactSchema.default('aab'),
    buildTask: z.string().default('bundleRelease'),
    deploymentTrack: AndroidTrackSchema.default('internal'),
    applicationId: z.string().optional(),
    packagePath: z.string().default('android'),
    publishStore: z.boolean().default(false),
  })
  .default({
    enabled: true,
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    deploymentTrack: 'internal',
    packagePath: 'android',
    publishStore: false,
  });

export const IOSConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    buildArtifact: IOSArtifactSchema.default('ipa'),
    scheme: z.string().optional(),
    workspace: z.string().optional(),
    bundleId: z.string().optional(),
    exportMethod: IOSExportMethodSchema.default('app-store'),
    packagePath: z.string().default('ios'),
  })
  .default({
    enabled: true,
    buildArtifact: 'ipa',
    exportMethod: 'app-store',
    packagePath: 'ios',
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
    keystoreSecretName: z.string().default('ANDROID_KEYSTORE_BASE64'),
    keystorePasswordSecretName: z.string().default('ANDROID_KEYSTORE_PASSWORD'),
    keyAliasSecretName: z.string().default('ANDROID_KEY_ALIAS'),
    keyPasswordSecretName: z.string().default('ANDROID_KEY_PASSWORD'),
  })
  .default({
    keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
    keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
    keyAliasSecretName: 'ANDROID_KEY_ALIAS',
    keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
  });

export const IOSSigningConfigSchema = z
  .object({
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
      appStoreConnectKeyContentSecretName: keyContentSecret,
      appStoreConnectApiKeySecretName: keyContentSecret,
      appStoreConnectKeyIdSecretName: val.appStoreConnectKeyIdSecretName,
      appStoreConnectIssuerIdSecretName: val.appStoreConnectIssuerIdSecretName,
    };
  })
  .default({
    appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
    appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
  });

export const SigningConfigSchema = z
  .object({
    android: AndroidSigningConfigSchema.default({
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
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
  });

export const ReleaseKitConfigSchema = z.object({
  projectName: z.string().min(1, 'Project name is required'),
  packageManager: PackageManagerSchema.default('npm'),
  projectRoot: z.string().default('.'),
  scripts: ScriptsConfigSchema.default({
    lint: 'npm run lint',
    typecheck: 'npm run typecheck',
    test: 'npm test',
  }),
  android: AndroidConfigSchema.default({
    enabled: true,
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    deploymentTrack: 'internal',
    packagePath: 'android',
    publishStore: false,
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
  }),
});

export type ReleaseKitConfig = z.infer<typeof ReleaseKitConfigSchema>;
export type ReleaseKitUserConfig = z.input<typeof ReleaseKitConfigSchema>;
