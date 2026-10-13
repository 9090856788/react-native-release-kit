import type { ReleaseKitConfig } from '../config/schema.js';

export interface AndroidBuildOptions {
  cwd?: string;
  artifact?: 'aab' | 'apk';
}

export interface AndroidBuildResult {
  success: boolean;
  artifactPath?: string;
  error?: string;
}

export class AndroidAdapter {
  constructor(private config: ReleaseKitConfig) {}

  public async build(_options: AndroidBuildOptions = {}): Promise<AndroidBuildResult> {
    // Phase 3 implementation target
    return {
      success: true,
      artifactPath: `android/app/build/outputs/bundle/release/app-release.${this.config.android.buildArtifact}`,
    };
  }
}
