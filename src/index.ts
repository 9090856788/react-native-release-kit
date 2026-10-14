// Main public API for react-native-release-kit

export {
  defineConfig,
  loadConfig,
  findConfigFile,
  findAllConfigFiles,
  CONFIG_FILE_NAMES,
  ReleaseKitConfigSchema,
  PackageManagerSchema,
  AndroidArtifactSchema,
  AndroidVariantSchema,
  AndroidTrackSchema,
  AndroidReleaseStatusSchema,
  IOSArtifactSchema,
  IOSExportMethodSchema,
  ScriptsConfigSchema,
  AndroidConfigSchema,
  IOSConfigSchema,
  GitHubActionsConfigSchema,
  SigningConfigSchema,
  createDefaultConfig,
  getDefaultScripts,
} from './config/index.js';

export type {
  ReleaseKitConfig,
  ReleaseKitUserConfig,
  PackageManager,
  AndroidArtifact,
  AndroidVariant,
  AndroidTrack,
  AndroidReleaseStatus,
  IOSArtifact,
  IOSExportMethod,
  LoadedConfigResult,
} from './config/index.js';

export {
  detectProject,
  detectPackageManager,
  detectAndroid,
  detectIOS,
  hasUnresolvedXcodeMacro,
  isPlaceholderIOSBundleId,
  extractApplicationBundleIdFromPbxproj,
} from './detector/index.js';

export type {
  ProjectDetectionResult,
  PackageManagerDetection,
  AndroidDetection,
  IOSDetection,
  DetectProjectOptions,
  DetectIOSOptions,
} from './detector/index.js';

export {
  AndroidAdapter,
  SUPPORTED_ANDROID_TRACKS,
  resolveGradleTask,
  formatGradleTaskForWorkflow,
  validateAndroidSigning,
  provisionSigningKeystore,
  locateBuiltArtifact,
  PublisherAdapter,
  validateServiceAccountCredentials,
  provisionServiceAccountKey,
  classifyPlayStoreError,
} from './adapters/index.js';

export type {
  AndroidBuildOptions,
  AndroidBuildResult,
  AndroidProjectValidationResult,
  AndroidSigningValidationResult,
  PublishOptions,
  PublishResult,
  PublishErrorCategory,
  ServiceAccountValidationResult,
  ClassifyPlayStoreErrorOptions,
} from './adapters/index.js';

export {
  generateGitHubWorkflows,
  generatePrValidationWorkflow,
  generateMainBuildWorkflow,
  generateReleaseTagWorkflow,
  extractReferencedPackageScript,
  generateFastlaneFiles,
  generateAndroidAppfile,
  generateAndroidFastfile,
  generateIOSAppfile,
  generateIOSFastfile,
  generateUnifiedAppfile,
  generateUnifiedFastfile,
} from './generators/index.js';

export {
  runDoctorChecks,
  validateConfig,
  validateIOSBundleId,
  validateSecretName,
  validateRequiredSecretNames,
  checkSecretNamesPresent,
} from './validators/index.js';

export type {
  DoctorOptions,
  DoctorReport,
  DoctorCheckItem,
  CheckStatus,
  ConfigValidationResult,
  ValidateConfigOptions,
  IOSBundleIdValidationResult,
  SecretValidationResult,
} from './validators/index.js';

export {
  initCommand,
  doctorCommand,
  setupCommand,
  buildCommand,
  deployCommand,
} from './commands/index.js';

export {
  logger,
  maskSecrets,
  registerSecretForRedaction,
  clearRegisteredSecrets,
  safeWriteFile,
  fileExists,
  readFileUtf8,
  readJsonFile,
  safeExec,
  generateDiff,
  formatUnifiedDiff,
  validateWorkflowYaml,
} from './utils/index.js';

export type { YamlValidationResult } from './utils/index.js';
