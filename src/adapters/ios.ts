import type { ReleaseKitConfig } from '../config/schema.js';

export interface IOSBuildOptions {
  cwd?: string;
  artifact?: 'ipa' | 'app';
}

export interface IOSBuildResult {
  success: boolean;
  artifactPath?: string;
  error?: string;
}

export class IOSAdapter {
  constructor(private config: ReleaseKitConfig) {}

  public async build(_options: IOSBuildOptions = {}): Promise<IOSBuildResult> {
    // Phase 4 implementation target
    return {
      success: true,
      artifactPath: `ios/build/${this.config.ios.scheme || this.config.projectName}.${this.config.ios.buildArtifact}`,
    };
  }
}
