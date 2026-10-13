# Architecture Documentation

## Overview

`react-native-release-kit` is an opinionated infrastructure toolkit designed specifically for React Native CLI applications. It automates CI/CD configuration, native builds, and store deployments without replacing native tools (Gradle, Xcode, Fastlane, GitHub Actions).

## Core Architectural Design

The library is organized into discrete layers:

```
src/
├── cli/          # CLI parsing with Commander
├── commands/     # init, doctor, setup, build, deploy handlers
├── config/       # Schema, types, defaults, and runtime loader (jiti)
├── detector/     # RN version, lockfile, Android Gradle, and iOS schemes
├── validators/   # Doctor environment checks and secret validation
├── generators/   # GitHub Actions and Fastlane generators
├── adapters/     # Gradle, Xcode, and store publishing wrappers
└── utils/        # Logger, filesystem, safe process execution, diffs
```

## Security Principles

1. **Zero Hardcoded Secrets**: Secrets are never written to configuration files or generated workflows. Workflows reference GitHub Secrets by environment name.
2. **Secret Masking**: The internal logger filters out token patterns, keys, passwords, and GitHub PATs.
3. **No Unsafe Interpolation**: Process execution relies on safe argument passing (`execa`) to prevent command injection.
4. **Idempotence & Diff Guarantees**: Existing files are never silently overwritten without confirmation or `--force`. `--dry-run` allows diff inspection.

