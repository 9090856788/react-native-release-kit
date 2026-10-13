# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-12

### Added
- **GitHub Actions Workflow Generator (`Phase 2`)**:
  - `pr-validation.yml`: pull-request validation workflow on configured `mainBranch` with concurrency, least-privilege permissions, dependency caching, and dynamic project quality scripts (`lint`, `typecheck`, `test`).
  - `main-build.yml`: main branch push and `workflow_dispatch` validation build with Android debug compilation (`assembleDebug` or `bundleDebug`) and artifact uploads.
  - `release-tag.yml`: release tag push and `workflow_dispatch` deployment workflow triggering on `releaseTagPattern` (e.g. `v*`) with Android release compilation and optional store credential verification.
- **Package Manager Multi-Engine Support**:
  - Full frozen lockfile installation support: `npm ci`, `yarn install --immutable` (Yarn Berry), `yarn install --frozen-lockfile` (Yarn Classic), `pnpm install --frozen-lockfile`, and `bun install --frozen-lockfile`.
  - Recursive monorepo lockfile resolution.
  - Conflicting lockfile detection and ambiguity diagnostics.
- **Workflow Safety & Inspection Flags**:
  - `--dry-run`: previews proposed workflow files in terminal without touching the filesystem.
  - `--diff`: produces unified git-style diffs against existing workflow files without modifying disk.
  - `--force`: explicit safeguard preventing silent overwrites of modified workflows.
  - Safe unchanged detection skipping unmodified workflow rewrites.
- **Security & Reliability**:
  - Pin third-party GitHub Actions to immutable full commit SHAs with semantic version documentation comments.
  - Workflow YAML validation and GitHub Actions expression delimiter parity checks.

## [0.1.0] - 2026-10-11

### Added
- Foundation release (`Phase 1`).
- Typed configuration API with `defineConfig` and Zod runtime schema validation.
- Multi-format configuration loader (`react-native-release.config.ts`, `.js`, `.mjs`, `.cjs`, `.json`).
- Automated React Native CLI project detector (versions, native Android/iOS folder presence).
- Package manager detector (`npm`, `yarn`, `pnpm`, `bun`).
- CLI interface powered by Commander:
  - `init`: Interactive and headless project setup generating `react-native-release.config.ts`.
  - `doctor`: Comprehensive environment diagnostics for Node.js, React Native, Java/Android SDK, macOS/Xcode/CocoaPods, and config validity.
  - Registered command interfaces for `setup`, `build`, and `deploy`.
- Safe process execution and structured, secret-sanitizing logger.

