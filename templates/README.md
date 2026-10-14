# Starter CI/CD Templates

This directory contains starter templates shipped with `react-native-release-kit` for reference and manual adaptation:

- `workflows/pr-validation.yml`: Starter pull request validation workflow.
- `workflows/main-build.yml`: Starter main branch compilation & debug artifact build workflow.
- `workflows/release-tag.yml`: Starter production tag release, signed build, and store deployment workflow.
- `fastlane/Appfile`: Starter Fastlane Appfile reading store identifiers from environment variables.
- `fastlane/Fastfile.android`: Starter Android Fastfile with `build_release`, `deploy_internal`, `deploy_closed`, and `deploy_production` lanes.
- `fastlane/Fastfile.ios`: Starter iOS Fastfile with `build_release` and `deploy_testflight` lanes.

## Automatic Generation vs. Static Templates

When configuring CI/CD in your project, prefer running the automated CLI generator:

```bash
npx react-native-release-kit setup --provider github-actions --fastlane
```

The CLI generator inspects your project dynamically:
- Automatically detects your package manager (`npm`, `yarn`, `pnpm`, `bun`) and generates frozen-lockfile commands.
- Automatically detects existing npm quality scripts (`lint`, `typecheck`, `test`).
- Automatically detects Xcode workspaces, projects, schemes, and bundle identifiers.
- Automatically detects Android modules, application IDs, and Gradle configurations.
- Pins GitHub Action dependencies to secure immutable commit SHAs.

The static files in this directory serve as canonical references illustrating the expected file structure and lane conventions.

