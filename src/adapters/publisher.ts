import type { ReleaseKitConfig } from '../config/schema.js';

export interface PublishOptions {
  platform: 'android' | 'ios';
  track?: string;
}

export interface PublishResult {
  success: boolean;
  message: string;
}

export class PublisherAdapter {
  constructor(private config: ReleaseKitConfig) {}

  public async publish(_options: PublishOptions): Promise<PublishResult> {
    // Phase 3 & 4 implementation target
    return {
      success: true,
      message: `Publish adapter ready for ${this.config.projectName}`,
    };
  }
}
