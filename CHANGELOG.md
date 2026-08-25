# Changelog

All notable changes to Cosmos Pay are documented here.
Generated from [Conventional Commits](https://www.conventionalcommits.org) by [git-cliff](https://git-cliff.org).
## [1.5.0] - 2026-08-25

### Bug Fixes
- Restore package-lock.json, corrupted by the Capacitor/Tauri merge (b2f5a20)

## [1.4.1] - 2026-08-24

### Miscellaneous
- Bump the minor-and-patch group with 2 updates (#56) (8122517)

## [1.4.0] - 2026-08-20

### Features
- Implement native build workflows for Android and iOS, including version stamping (0c195fa)
- Implement keyboard handling for better UI interaction and footer positioning (679fc21)
- Mejorar la gestión del teclado para una mejor experiencia de usuario y animaciones de interfaz (df55a20)
- Internationalization updates and error handling improvements (3c51fb5)
- Agregar archivos de configuración y bloqueos para la gestión de Gradle en Android (b784f2e)
- Actualizar configuraciones de CI y mejorar la gestión de ventanas en el diseño de escritorio (74c9cdf)

### Bug Fixes
- Update references from Podfile to Package.swift in CI workflows (a561c5c)
- Unblock the pipeline — missing script, locale-bound tests, target/ in the typecheck (7a35ed0)
- Write android:allowBackup="false" when the manifest has none (a7f4643)
- Build iOS in the release configuration, and drop the MSI on a prerelease (4cca39c)
- Derive the version from the tags, and build every platform on every run (527cbb7)
- Stop xcodebuild's env dump from truncating the iOS error out of the log (bd43575)
- Compile both iOS halves instead of building an .ipa that cannot be built (d17f6d2)

### Refactor
- Enhance responsive and device authentication tests (1a658b7)

## [1.3.0] - 2026-08-19

### Features
- Enhance camera functionality and permissions handling (d85b329)
- Add safe area insets and gutter variables for responsive design (1fa5fa0)
- Implement device authentication feature with biometric and passcode support (cf732b0)
- Enhance device authentication and signing gate functionality (1fa445d)
- Enhance password handling and device authentication (6a7c248)

## [1.2.4] - 2026-08-17

### Features
- Implement request response handling with timeout and recovery for service worker communication (9acf979)
- Add Node globals shim for browser compatibility (4ad49d7)
- Implement auto-lock feature and improve network validation (c8c3c14)

### Bug Fixes
- Resolve cited paths case-sensitively so CI and Windows agree (cd1bbef)

### Miscellaneous
- Bump actions/setup-java from 5.6.0 to 5.7.0 (4c759af)
- Bump astro from 7.1.6 to 7.2.1 in the minor-and-patch group (bbb7f62)

### Refactor
- Restructure by feature, extract styles, and harden the signing path (4dc8e66)

## [1.2.3] - 2026-08-12

### Miscellaneous
- Bump android-actions/setup-android from 3 to 4 (93d2883)
- Bump actions/setup-node from 6 to 7 (c8932c8)
- Bump the minor-and-patch group across 1 directory with 12 updates (a65e78e)
- Bump actions/setup-java from 5 to 5.6.0 (d3e66e4)
- Update package.json to add uuid dependency and maintain elliptic override (734a32c)

## [1.2.2] - 2026-07-11

### Bug Fixes
- Revert TypeScript to ^6.0.3 to unbreak `astro check` (9aef408)

### Miscellaneous
- Update GitHub Actions workflows and improve asset handling for Pages deployment (1e5c156)
- Update TypeScript to version 7.0.2 in package.json and package-lock.json (0c75b51)

### CI/CD
- Auto-generate changelogs from Conventional Commits with git-cliff (453020d)

## [1.2.1] - 2026-07-11

### Miscellaneous
- Bump actions/deploy-pages from 4 to 5 (3be084d)
- Bump softprops/action-gh-release from 2 to 3 (af4a42e)
- Bump actions/checkout from 4 to 7 (f555f43)
- Bump actions/setup-java from 4 to 5 (57da55b)
- Bump actions/configure-pages from 5 to 6 (d6586c0)
- Bump the minor-and-patch group across 1 directory with 3 updates (6f451e7)

## [1.2.0] - 2026-07-11

### Features
- Update extension files and localizations for improved user experience (39cf598)
- Update workflows and localization for improved clarity and functionality (4901dc3)
- Add Dependabot configuration for automatic dependency updates and enhance release workflow with security audits (686ed73)

### Bug Fixes
- Downgrade vite-plugin-node-polyfills to version 0.2.0 for compatibility (7ca1f3a)
- Restore vite-plugin-node-polyfills to ^0.28.0 + guard elliptic out of the bundle (2f0eeab)

### Refactor
- Update workflow files for improved clarity and consistency (1a0dc67)
- Update build output paths to use dist/web/ for clarity and consistency (6301452)


