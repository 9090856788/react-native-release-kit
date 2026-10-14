import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  detectPackageManager,
  detectAndroid,
  detectIOS,
  detectProject,
} from '../../src/detector/index.js';

describe('Project & Environment Detectors', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('detectPackageManager', () => {
    it('detects yarn classic when yarn.lock is present without berry config', async () => {
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('yarn');
      expect(pm.lockfile).toBe('yarn.lock');
      expect(pm.isYarnBerry).toBe(false);
      expect(pm.frozenInstallCommand).toBe('yarn install --frozen-lockfile');
      expect(pm.ambiguous).toBe(false);
    });

    it('detects yarn berry when .yarnrc.yml is present', async () => {
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');
      await fs.writeFile(path.join(testDir, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('yarn');
      expect(pm.lockfile).toBe('yarn.lock');
      expect(pm.isYarnBerry).toBe(true);
      expect(pm.frozenInstallCommand).toBe('yarn install --immutable');
      expect(pm.ambiguous).toBe(false);
    });

    it('detects pnpm when pnpm-lock.yaml is present', async () => {
      await fs.writeFile(path.join(testDir, 'pnpm-lock.yaml'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('pnpm');
      expect(pm.lockfile).toBe('pnpm-lock.yaml');
      expect(pm.frozenInstallCommand).toBe('pnpm install --frozen-lockfile');
    });

    it('detects bun when bun.lockb is present', async () => {
      await fs.writeFile(path.join(testDir, 'bun.lockb'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('bun');
      expect(pm.lockfile).toBe('bun.lockb');
      expect(pm.frozenInstallCommand).toBe('bun install --frozen-lockfile');
    });

    it('detects bun when bun.lock is present', async () => {
      await fs.writeFile(path.join(testDir, 'bun.lock'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('bun');
      expect(pm.lockfile).toBe('bun.lock');
      expect(pm.frozenInstallCommand).toBe('bun install --frozen-lockfile');
    });

    it('detects conflicting lockfiles and marks detection as ambiguous', async () => {
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');
      await fs.writeFile(path.join(testDir, 'package-lock.json'), '{}');
      const pm = detectPackageManager(testDir);
      expect(pm.ambiguous).toBe(true);
      expect(pm.conflictingManagers).toEqual(['yarn', 'npm']);
      expect(pm.conflictingLockfiles).toEqual(['yarn.lock', 'package-lock.json']);
    });

    it('detects parent directory lockfile in monorepo scenario', async () => {
      const subDir = path.join(testDir, 'packages', 'app');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'pnpm-lock.yaml'), '');
      const pm = detectPackageManager(subDir);
      expect(pm.manager).toBe('pnpm');
      expect(pm.lockfile).toBe('pnpm-lock.yaml');
      expect(pm.ambiguous).toBe(false);
    });

    it('defaults to npm if no lockfile found', () => {
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('npm');
      expect(pm.lockfile).toBeNull();
      expect(pm.frozenInstallCommand).toBe('npm ci');
      expect(pm.ambiguous).toBe(false);
    });
  });

  describe('detectAndroid', () => {
    it('returns hasAndroid=false when no android directory exists', async () => {
      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(false);
      expect(res.buildGradleFound).toBe(false);
    });

    it('detects Android structure and applicationId from build.gradle', async () => {
      const appDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
        android {
            namespace "com.awesome.myapp"
            defaultConfig {
                applicationId "com.awesome.myapp"
            }
        }
        `,
      );
      await fs.writeFile(path.join(testDir, 'android', 'gradlew'), '#!/bin/sh');

      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(true);
      expect(res.buildGradleFound).toBe(true);
      expect(res.applicationId).toBe('com.awesome.myapp');
      expect(res.hasGradlew).toBe(true);
      expect(res.usesDebugSigningInRelease).toBe(false);
    });

    it('detects unsafe release signing configuration when release build type uses debug keys (Groovy DSL)', async () => {
      const appDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
        android {
            namespace "com.vaultguard.app"
            defaultConfig {
                applicationId "com.vaultguard.app"
            }
            signingConfigs {
                debug {
                    storeFile file('debug.keystore')
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
        `,
      );
      await fs.writeFile(path.join(testDir, 'android', 'gradlew'), '#!/bin/sh');

      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(true);
      expect(res.usesDebugSigningInRelease).toBe(true);
      expect(res.hasReleaseSigningConfig).toBe(false);
      expect(res.signingDetails?.usesDebugSigningInRelease).toBe(true);
    });

    it('detects unsafe release signing configuration in Kotlin DSL (build.gradle.kts)', async () => {
      const appDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(appDir, 'build.gradle.kts'),
        `
        android {
            namespace = "com.vaultguard.app"
            buildTypes {
                getByName("release") {
                    signingConfig = signingConfigs.getByName("debug")
                }
            }
        }
        `,
      );
      await fs.writeFile(path.join(testDir, 'android', 'gradlew'), '#!/bin/sh');

      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(true);
      expect(res.usesDebugSigningInRelease).toBe(true);
      expect(res.hasReleaseSigningConfig).toBe(false);
    });

    it('detects secure environment-variable-backed release signing configuration', async () => {
      const appDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
        android {
            namespace "com.secure.app"
            signingConfigs {
                release {
                    storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
                    storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                    keyAlias System.getenv("ANDROID_KEY_ALIAS")
                    keyPassword System.getenv("ANDROID_KEY_PASSWORD")
                }
            }
            buildTypes {
                release {
                    signingConfig signingConfigs.release
                }
            }
        }
        `,
      );
      await fs.writeFile(path.join(testDir, 'android', 'gradlew'), '#!/bin/sh');

      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(true);
      expect(res.usesDebugSigningInRelease).toBe(false);
      expect(res.hasReleaseSigningConfig).toBe(true);
      expect(res.hasSigningConfigEnv).toBe(true);
      expect(res.signingDetails?.hasEnvBasedSigning).toBe(true);
    });
  });

  describe('detectIOS', () => {
    it('returns hasIOS=false when no ios directory exists', async () => {
      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(false);
      expect(res.schemes).toEqual([]);
    });

    it('detects workspace, scheme, and Podfile', async () => {
      const iosDir = path.join(testDir, 'ios');
      await fs.mkdir(path.join(iosDir, 'AwesomeApp.xcworkspace'), { recursive: true });
      await fs.writeFile(path.join(iosDir, 'Podfile'), "platform :ios, '13.4'");

      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(true);
      expect(res.hasPodfile).toBe(true);
      expect(res.workspace).toBe('ios/AwesomeApp.xcworkspace');
      expect(res.schemes).toContain('AwesomeApp');
    });

    it('supports custom iOS packagePath (e.g. packages/mobile/ios)', async () => {
      const customIosDir = path.join(testDir, 'packages', 'mobile', 'ios');
      await fs.mkdir(path.join(customIosDir, 'CustomApp.xcworkspace'), { recursive: true });
      await fs.writeFile(path.join(customIosDir, 'Podfile'), "platform :ios, '14.0'");

      const res = await detectIOS(testDir, { packagePath: 'packages/mobile/ios' });
      expect(res.hasIOS).toBe(true);
      expect(res.packagePath).toBe('packages/mobile/ios');
      expect(res.workspace).toBe('packages/mobile/ios/CustomApp.xcworkspace');
      expect(res.schemes).toContain('CustomApp');
    });

    it('skips test-target bundle identifier when extracting from project.pbxproj', async () => {
      const iosDir = path.join(testDir, 'ios', 'MyApp.xcodeproj');
      await fs.mkdir(iosDir, { recursive: true });

      // Simulate a pbxproj where the Test target appears first
      const pbxprojContent = `
/* Begin XCBuildConfiguration section */
		1111 /* Debug Test Target */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				BUNDLE_LOADER = "$(TEST_HOST)";
				PRODUCT_BUNDLE_IDENTIFIER = "com.company.myappTests";
				PRODUCT_NAME = "MyAppTests";
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/MyApp.app/MyApp";
			};
			name = Debug;
		};
		2222 /* Release App Target */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				PRODUCT_BUNDLE_IDENTIFIER = "com.company.myapp";
				PRODUCT_NAME = "MyApp";
			};
			name = Release;
		};
/* End XCBuildConfiguration section */
`;
      await fs.writeFile(path.join(iosDir, 'project.pbxproj'), pbxprojContent);

      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(true);
      expect(res.bundleId).toBe('com.company.myapp');
      expect(res.hasUnresolvedBundleIdMacro).toBe(false);
      expect(res.isPlaceholderBundleId).toBe(false);
    });

    it('detects unresolved Xcode macro in bundle identifier from project.pbxproj', async () => {
      const iosDir = path.join(testDir, 'ios', 'MyApp.xcodeproj');
      await fs.mkdir(iosDir, { recursive: true });

      const pbxprojContent = `
/* Begin XCBuildConfiguration section */
		1111 /* Release App Target */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = "org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)";
				PRODUCT_NAME = "MyApp";
			};
			name = Release;
		};
/* End XCBuildConfiguration section */
`;
      await fs.writeFile(path.join(iosDir, 'project.pbxproj'), pbxprojContent);

      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(true);
      expect(res.bundleId).toBe('org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)');
      expect(res.hasUnresolvedBundleIdMacro).toBe(true);
      expect(res.isPlaceholderBundleId).toBe(true);
    });

    it('falls back to xcodeproj and extracts scheme when no xcworkspace exists', async () => {
      const iosDir = path.join(testDir, 'ios');
      await fs.mkdir(path.join(iosDir, 'BareProject.xcodeproj'), { recursive: true });

      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(true);
      expect(res.workspace).toBeUndefined();
      expect(res.xcodeproj).toBe('ios/BareProject.xcodeproj');
      expect(res.schemes).toContain('BareProject');
    });

    it('handles projects and workspaces with spaces in name safely', async () => {
      const iosDir = path.join(testDir, 'ios');
      await fs.mkdir(path.join(iosDir, 'My Awesome App.xcworkspace'), { recursive: true });
      await fs.mkdir(path.join(iosDir, 'My Awesome App.xcodeproj'), { recursive: true });

      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(true);
      expect(res.workspace).toBe('ios/My Awesome App.xcworkspace');
      expect(res.xcodeproj).toBe('ios/My Awesome App.xcodeproj');
      expect(res.schemes).toContain('My Awesome App');
    });
  });

  describe('detectProject', () => {
    it('detects React Native project details from package.json', async () => {
      const pkg = {
        name: 'sample-rn-app',
        dependencies: {
          react: '18.3.1',
          'react-native': '0.76.1',
        },
        scripts: {
          lint: 'eslint .',
          test: 'jest',
        },
      };
      await fs.writeFile(path.join(testDir, 'package.json'), JSON.stringify(pkg, null, 2));
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');

      const res = await detectProject(testDir);
      expect(res.isReactNative).toBe(true);
      expect(res.reactNativeVersion).toBe('0.76.1');
      expect(res.projectName).toBe('sample-rn-app');
      expect(res.packageManager.manager).toBe('yarn');
      expect(res.scripts.lint).toBe('eslint .');
    });

    it('reports isReactNative=false if react-native is missing', async () => {
      const pkg = {
        name: 'regular-node-lib',
        dependencies: {
          lodash: '4.17.21',
        },
      };
      await fs.writeFile(path.join(testDir, 'package.json'), JSON.stringify(pkg, null, 2));

      const res = await detectProject(testDir);
      expect(res.isReactNative).toBe(false);
      expect(res.reactNativeVersion).toBeUndefined();
    });
  });
});
