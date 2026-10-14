import type { ReleaseKitConfig } from '../config/schema.js';

export interface IOSBuildOptions {
  cwd?: string;
  artifact?: 'ipa' | 'app';
}

export interface IOSBuildResult {
  success: boolean;
  artifactPath?: string;
  error?: string;
  remediation?: string;
}

export class IOSAdapter {
  constructor(public readonly config: ReleaseKitConfig) {}

  public async build(_options: IOSBuildOptions = {}): Promise<IOSBuildResult> {
    return {
      success: false,
      error:
        'Local native iOS build execution via CLI is not supported in this version. Use the generated GitHub Actions workflows (.github/workflows/main-build.yml or release-tag.yml) on a macOS runner.',
      remediation:
        'Run "npx react-native-release-kit setup" to generate GitHub Actions workflows with Xcode build and signing support.',
    };
  }
}
