import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configureAndroidReleaseSigning,
  parseGradleBlocks,
} from '../../src/adapters/android-signing-config.js';

describe('configureAndroidReleaseSigning', () => {
  let projectRoot: string;
  let gradleFile: string;

  const originalGradle = `plugins {
    id("com.android.application")
}

android {
    namespace "com.test.app"
    defaultConfig {
        applicationId "com.test.app"
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'release-kit-signing-test-'));
    gradleFile = path.join(projectRoot, 'android', 'app', 'build.gradle');

    await fs.mkdir(path.dirname(gradleFile), { recursive: true });
    await fs.writeFile(gradleFile, originalGradle, 'utf8');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('adds environment-based release signing to a supported Gradle file', async () => {
    const result = await configureAndroidReleaseSigning({ projectRoot });

    expect(result.changed).toBe(true);
    expect(result.dsl).toBe('groovy');
    expect(result.content).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');
    expect(result.content).toContain('signingConfig signingConfigs.release');

    const saved = await fs.readFile(gradleFile, 'utf8');
    expect(saved).toBe(result.content);
  });

  it('changes only the release block when it uses debug signing and leaves debug block unchanged', async () => {
    await configureAndroidReleaseSigning({ projectRoot });

    const saved = await fs.readFile(gradleFile, 'utf8');
    const roots = parseGradleBlocks(saved);

    const android = roots.find((r) => r.name === 'android');
    expect(android).toBeDefined();

    const buildTypes = android!.children.find((c) => c.name === 'buildTypes');
    expect(buildTypes).toBeDefined();

    const debug = buildTypes!.children.find((c) => c.name === 'debug');
    const release = buildTypes!.children.find((c) => c.name === 'release');
    expect(debug).toBeDefined();
    expect(release).toBeDefined();

    const debugBody = saved.slice(debug!.openBrace + 1, debug!.closeBrace);
    const releaseBody = saved.slice(release!.openBrace + 1, release!.closeBrace);

    // debug block must keep debug signing and NOT have release signing
    expect(debugBody).toContain('signingConfig signingConfigs.debug');
    expect(debugBody).not.toContain('signingConfig signingConfigs.release');

    // release block must have release signing and NOT have debug signing
    expect(releaseBody).toContain('signingConfig signingConfigs.release');
    expect(releaseBody).not.toContain('signingConfig signingConfigs.debug');

    // signingConfigs block must contain the release configuration
    const signingConfigs = android!.children.find((c) => c.name === 'signingConfigs');
    expect(signingConfigs).toBeDefined();
    const scBody = saved.slice(signingConfigs!.openBrace + 1, signingConfigs!.closeBrace);
    expect(scBody).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');
  });

  it('leaves the debug block byte-for-byte unchanged when adding release signing', async () => {
    const origRoots = parseGradleBlocks(originalGradle);
    const origAndroid = origRoots.find((r) => r.name === 'android')!;
    const origBuildTypes = origAndroid.children.find((c) => c.name === 'buildTypes')!;
    const origDebug = origBuildTypes.children.find((c) => c.name === 'debug')!;
    const origDebugText = originalGradle.slice(origDebug.start, origDebug.closeBrace + 1);

    await configureAndroidReleaseSigning({ projectRoot });

    const saved = await fs.readFile(gradleFile, 'utf8');
    const roots = parseGradleBlocks(saved);
    const android = roots.find((r) => r.name === 'android')!;
    const buildTypes = android.children.find((c) => c.name === 'buildTypes')!;
    const debug = buildTypes.children.find((c) => c.name === 'debug')!;

    const finalDebugText = saved.slice(debug.start, debug.closeBrace + 1);
    expect(finalDebugText).toBe(origDebugText);
  });

  it('refuses to modify release build type if it does not have signingConfig signingConfigs.debug', async () => {
    const noSigningGradle = `plugins {
    id("com.android.application")
}
android {
    namespace "com.test.app"
    defaultConfig { applicationId "com.test.app" }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            minifyEnabled false
        }
    }
}
`;
    await fs.writeFile(gradleFile, noSigningGradle, 'utf8');

    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'The release build type does not use the standard debug signing configuration (signingConfigs.debug)',
    );

    expect(await fs.readFile(gradleFile, 'utf8')).toBe(noSigningGradle);
  });

  it('does not write changes during a dry run', async () => {
    const result = await configureAndroidReleaseSigning({
      projectRoot,
      dryRun: true,
    });

    expect(result.changed).toBe(true);
    expect(result.message).toContain('Dry run');
    expect(result.content).toContain('signingConfigs.release');

    const saved = await fs.readFile(gradleFile, 'utf8');
    expect(saved).toBe(originalGradle);
  });

  it('preserves an existing release signing configuration', async () => {
    const existing = originalGradle.replace(
      'signingConfig signingConfigs.debug\n        }\n    }\n}',
      'signingConfig signingConfigs.release\n        }\n    }\n}',
    );

    await fs.writeFile(gradleFile, existing, 'utf8');

    const result = await configureAndroidReleaseSigning({ projectRoot });

    expect(result.changed).toBe(false);
    expect(result.message).toContain('already exist');
    expect(await fs.readFile(gradleFile, 'utf8')).toBe(existing);
  });

  it('preserves an existing custom release signing configuration without overwriting it', async () => {
    const customGradle = `plugins {
    id("com.android.application")
}
android {
    namespace "com.custom.app"
    defaultConfig { applicationId "com.custom.app" }
    signingConfigs {
        customRelease {
            storeFile file("my-custom.keystore")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.customRelease
        }
    }
}
`;
    await fs.writeFile(gradleFile, customGradle, 'utf8');

    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'The release build type has a custom signingConfig reference',
    );

    expect(await fs.readFile(gradleFile, 'utf8')).toBe(customGradle);
  });

  it('adds release signing to an existing signingConfigs block preserving debug signing', async () => {
    const gradleWithExistingSigning = `android {
    namespace "com.test.app"
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;
    await fs.writeFile(gradleFile, gradleWithExistingSigning, 'utf8');

    const result = await configureAndroidReleaseSigning({ projectRoot });

    expect(result.changed).toBe(true);

    const saved = await fs.readFile(gradleFile, 'utf8');
    const roots = parseGradleBlocks(saved);
    const android = roots.find((r) => r.name === 'android')!;
    const signingConfigs = android.children.find((c) => c.name === 'signingConfigs')!;

    // Ensure signingConfigs now has both debug and release
    const debugSigning = signingConfigs.children.find((c) => c.name === 'debug');
    const releaseSigning = signingConfigs.children.find((c) => c.name === 'release');
    expect(debugSigning).toBeDefined();
    expect(releaseSigning).toBeDefined();

    const scBody = saved.slice(signingConfigs.openBrace + 1, signingConfigs.closeBrace);
    expect(scBody).toContain("storeFile file('debug.keystore')");
    expect(scBody).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');

    // Ensure buildTypes.release was updated
    const buildTypes = android.children.find((c) => c.name === 'buildTypes')!;
    const release = buildTypes.children.find((c) => c.name === 'release')!;
    const releaseBody = saved.slice(release.openBrace + 1, release.closeBrace);
    expect(releaseBody).toContain('signingConfig signingConfigs.release');
  });

  it('rejects Kotlin DSL without modifying it', async () => {
    await fs.rm(gradleFile);

    const kotlinFile = path.join(projectRoot, 'android', 'app', 'build.gradle.kts');
    const kotlinContent = `plugins {
    id("com.android.application")
}
android {
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
`;
    await fs.writeFile(kotlinFile, kotlinContent, 'utf8');

    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Automatic Kotlin DSL editing is not enabled yet',
    );

    expect(await fs.readFile(kotlinFile, 'utf8')).toBe(kotlinContent);
  });

  it('does not write secret values into Gradle files', async () => {
    const result = await configureAndroidReleaseSigning({ projectRoot });

    expect(result.content).toContain('System.getenv(');
    expect(result.content).not.toContain('my-secret-password');
    expect(result.content).not.toContain('my-secret-alias');
  });

  it('fails safely when required blocks are missing', async () => {
    // Missing android block
    await fs.writeFile(gradleFile, 'plugins { id("com.android.application") }\n', 'utf8');
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Could not safely identify the "android" block',
    );

    // Missing buildTypes block inside android
    await fs.writeFile(
      gradleFile,
      'android {\n    namespace "com.test.app"\n    defaultConfig { applicationId "com.test.app" }\n}\n',
      'utf8',
    );
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Could not safely identify the "buildTypes" block',
    );

    // Missing release block inside buildTypes
    await fs.writeFile(
      gradleFile,
      'android {\n    buildTypes {\n        debug { signingConfig signingConfigs.debug }\n    }\n}\n',
      'utf8',
    );
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Could not safely identify the "release" block',
    );

    // Missing file entirely
    await fs.rm(gradleFile);
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Could not find build.gradle or build.gradle.kts',
    );
  });

  it('rejects ambiguous or malformed Gradle structures', async () => {
    // 1. Multiple buildTypes blocks in android
    const ambiguousBuildTypes = `android {
    buildTypes {
        release { signingConfig signingConfigs.debug }
    }
    buildTypes {
        debug { }
    }
}
`;
    await fs.writeFile(gradleFile, ambiguousBuildTypes, 'utf8');
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Multiple "buildTypes" blocks were found in the same scope',
    );

    // 2. Multiple release blocks in buildTypes
    const ambiguousRelease = `android {
    buildTypes {
        release { signingConfig signingConfigs.debug }
        release { minifyEnabled false }
    }
}
`;
    await fs.writeFile(gradleFile, ambiguousRelease, 'utf8');
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Multiple "release" blocks were found in the same scope',
    );

    // 3. Unbalanced braces
    const unbalanced = `android {
    buildTypes {
        release {
`;
    await fs.writeFile(gradleFile, unbalanced, 'utf8');
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Malformed Gradle file',
    );

    // 4. Both Groovy and Kotlin DSL files exist
    const kotlinFile = path.join(projectRoot, 'android', 'app', 'build.gradle.kts');
    await fs.writeFile(gradleFile, originalGradle, 'utf8');
    await fs.writeFile(kotlinFile, 'android { }', 'utf8');
    await expect(configureAndroidReleaseSigning({ projectRoot })).rejects.toThrow(
      'Both Groovy and Kotlin Gradle files exist',
    );
  });

  it('is idempotent on repeated execution', async () => {
    // First run: modifies the file
    const firstResult = await configureAndroidReleaseSigning({ projectRoot });
    expect(firstResult.changed).toBe(true);

    const firstSaved = await fs.readFile(gradleFile, 'utf8');
    expect(firstSaved).toBe(firstResult.content);

    // Second run: file already has release signing configuration
    const secondResult = await configureAndroidReleaseSigning({ projectRoot });
    expect(secondResult.changed).toBe(false);
    expect(secondResult.content).toBe(firstSaved);

    const secondSaved = await fs.readFile(gradleFile, 'utf8');
    expect(secondSaved).toBe(firstSaved);
  });

  it('handles nested braces, comments, and quoted braces safely', async () => {
    const complexGradle = `// Comment with braces: { } and release { }
/*
 * Multi-line comment:
 * android {
 *     buildTypes {
 *         release {
 *             signingConfig signingConfigs.debug
 *         }
 *     }
 * }
 */
android {
    namespace "com.test.complex"

    // String with braces
    def regexPattern = ".*{1,3}.*"
    def closureDescription = "buildTypes { release { } }"

    defaultConfig {
        applicationId "com.test.complex"
        manifestPlaceholders = [hostName: "example.com"]
    }

    buildTypes {
        debug {
            // debug block with nested closure
            matchingFallbacks = ['debug']
            signingConfig signingConfigs.debug
        }

        release {
            // release block with comment
            // signingConfig signingConfigs.debug
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;
    await fs.writeFile(gradleFile, complexGradle, 'utf8');

    const result = await configureAndroidReleaseSigning({ projectRoot });
    expect(result.changed).toBe(true);

    const saved = await fs.readFile(gradleFile, 'utf8');

    // Verify comments and strings were preserved
    expect(saved).toContain('// Comment with braces: { } and release { }');
    expect(saved).toContain('Multi-line comment:');
    expect(saved).toContain('def regexPattern = ".*{1,3}.*"');
    expect(saved).toContain('def closureDescription = "buildTypes { release { } }"');

    // Verify debug block was not changed
    const roots = parseGradleBlocks(saved);
    const android = roots.find((r) => r.name === 'android')!;
    const buildTypes = android.children.find((c) => c.name === 'buildTypes')!;

    const debug = buildTypes.children.find((c) => c.name === 'debug')!;
    const debugBody = saved.slice(debug.openBrace + 1, debug.closeBrace);
    expect(debugBody).toContain('signingConfig signingConfigs.debug');
    expect(debugBody).not.toContain('signingConfig signingConfigs.release');

    // Verify release block was updated
    const release = buildTypes.children.find((c) => c.name === 'release')!;
    const releaseBody = saved.slice(release.openBrace + 1, release.closeBrace);
    expect(releaseBody).toContain('signingConfig signingConfigs.release');
    // The commented-out debug signing must remain intact as a comment
    expect(releaseBody).toContain('// signingConfig signingConfigs.debug');
  });
});
