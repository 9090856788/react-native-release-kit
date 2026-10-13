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
  AndroidTrackSchema,
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
  AndroidTrack,
  IOSArtifact,
  IOSExportMethod,
  LoadedConfigResult,
} from './config/index.js';

export { detectProject, detectPackageManager, detectAndroid, detectIOS } from './detector/index.js';

export type {
  ProjectDetectionResult,
  PackageManagerDetection,
  AndroidDetection,
  IOSDetection,
} from './detector/index.js';

export {
  runDoctorChecks,
  validateConfig,
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
