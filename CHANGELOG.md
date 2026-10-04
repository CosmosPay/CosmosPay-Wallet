# Changelog

All notable changes to Cosmos Pay are documented here.
Generated from [Conventional Commits](https://www.conventionalcommits.org) by [git-cliff](https://git-cliff.org).
## [1.12.0] - 2026-10-04

### Features
- Add optional app password for wallet backup and recovery (e07298e)
- Implement Argon2id for cloud backup encryption and enhance password criteria (31cd4cd)
- Add cross-chain swap functionality with NEAR Intents support (fa26717)
- Add cross-chain swap functionality with NEAR Intents support (923d278)
- Implement chain swap functionality for Solana and Monad (26d1f0e)
- Implement email recovery for wallet backups (99d7346)
- Implement retry mechanism for network errors in API calls (53c9a89)
- Add support for testnet chain sending and recovery (d681156)

### Bug Fixes
- Align the tauri-plugin-opener crate with its npm package, sync server spec (fb312a5)

### Refactor
- Update public key fetching to use gateway API (53a0fa7)

### Testing
- Follow the 12-character minimum on the password placeholder (5451665)
- Assert the v4 Argon2id backup box on sign-in (8ad612c)

### Dependencies
- Bump stellar-sdk and tauri plugin-opener, patch audit findings (4d584cd)

## [1.11.1] - 2026-09-27

### Miscellaneous
- Sync the community server contract (59be7b9)

## [1.11.0] - 2026-09-27

### Features
- Add yield protocol directory (ce4d470)
- Integrate DeFindex vaults in wallet (e3e1a4a)
- Surface BlindPay ramps on home (de6570e)
- Implement dev icon handling for local builds across platforms (cb972dc)
- Eliminar componente y estilos de inicio de sesión social (b0bfe48)
- Implement sign-in methods UI and functionality (db9314a)
- Mejorar manejo de errores en el proxy de desarrollo y optimizar dependencias (fe7e293)
- Enhance SEP-10 and recovery features (3006f4e)
- Switch the sign-in backend with a flag, not a rewrite (fc61913)
- Implement recovery process with identity tokens and email codes (4151b8b)
- Add OpenAPI sync script and gateway contract tests (e177362)
- Agregar manejo de token de sesión en el proceso de inicio de sesión y recuperación (16aeff7)
- Implement passkey unlock functionality (075c23b)
- Implement passkey creation, retrieval, and status commands (0dc2fcd)
- Agregar soporte para la configuración de MFA en el proceso de inicio de sesión (8c3d1f8)

### Bug Fixes
- Accept human-readable DeFindex amounts (4c06df1)
- Add direct earn route (d57d36b)
- Add explicit ramps action (2991139)
- Use bank funding language for ramps (c6e3bff)
- Adapt to @stellar/stellar-sdk 17 (4ec9ae0)
- Read contract calls with the stellar-sdk 17 XDR shape (399bc71)
- Compile the cosmos plugin against API 36 for tauri 2.12 (5b21bc0)

### Miscellaneous
- Bump @astrojs/react from 6.0.6 to 7.0.0 (fc3c7a8)
- Bump the minor-and-patch group with 2 updates (281320b)
- Bump @stellar/stellar-sdk from 16.3.0 to 17.1.0 (35db486)
- Sync package-lock with dev (47c78b8)
- Sync package-lock with dev (78af29e)
- Sync package-lock with dev (1e99c06)
- Bump @astrojs/react from 6.0.6 to 7.0.0 (a282ce2)

### Refactor
- Remove legacy Pollar tests and add new legacy wallet purge tests (231b8ea)

### Dependencies
- Update npm and Rust dependencies to latest (d356400)

## [1.10.0] - 2026-09-21

### Miscellaneous
- Bump the minor-and-patch group with 3 updates (6fbef9c)

## [1.9.0] - 2026-09-19

### Features
- La wallet pasa a la identidad nueva de Cosmos (5b1958a)
- El nombre en la bienvenida va como lockup SVG, no tipeado (1c2f33e)

## [1.8.0] - 2026-09-16

### Features
- Implement commission handling for swaps, including validation and error messages (2957822)
- Implement social login flow with email verification and access code handling (c9f4933)
- Update Android setup to include necessary packages for successful builds (ede25aa)

## [1.7.0] - 2026-09-10

### Features
- Enhance web signer functionality and improve connected sites management (87bf40a)
- Implement asset registry and public key management (cc54de2)
- Refactor asset issuer management by removing KNOWN_ISSUERS and integrating asset registry for accurate portfolio calculations (e68b394)
- Implement ownership attestation and trace ID for telemetry (9c7f443)

## [1.6.1] - 2026-09-07

### Miscellaneous
- Bump the minor-and-patch group across 1 directory with 5 updates (8997b5f)

## [1.6.0] - 2026-09-07

### Features
- Add styles for GatewayOps and SocialLogin components (3e9fbbd)
- Implement brokered social login flow (39c3a5a)
- Update external link handling and social login flow (85963ce)
- Add diagnostics preference and telemetry reporting (d5cbab1)
- Update README with social login details and enhance package dependencies (d72b460)

### Refactor
- Update device authentication to use vault key instead of app password (add2518)

## [1.5.1] - 2026-08-30

### Miscellaneous
- Bump actions/setup-java from 5 to 6 (#64) (d3f1672)
- Bump android-actions/setup-android from 3 to 4 (#63) (c9ed297)
- Bump the minor-and-patch group with 4 updates (#65) (ab300e6)

## [1.5.0] - 2026-08-25

### Features
- Implement keyboard handling for better UI interaction and footer positioning (679fc21)
- Mejorar la gestión del teclado para una mejor experiencia de usuario y animaciones de interfaz (df55a20)
- Internationalization updates and error handling improvements (3c51fb5)
- Agregar archivos de configuración y bloqueos para la gestión de Gradle en Android (b784f2e)
- Actualizar configuraciones de CI y mejorar la gestión de ventanas en el diseño de escritorio (74c9cdf)

### Bug Fixes
- Unblock the pipeline — missing script, locale-bound tests, target/ in the typecheck (7a35ed0)
- Write android:allowBackup="false" when the manifest has none (a7f4643)
- Build iOS in the release configuration, and drop the MSI on a prerelease (4cca39c)
- Derive the version from the tags, and build every platform on every run (527cbb7)
- Stop xcodebuild's env dump from truncating the iOS error out of the log (bd43575)
- Compile both iOS halves instead of building an .ipa that cannot be built (d17f6d2)
- Restore package-lock.json, corrupted by the Capacitor/Tauri merge (b2f5a20)

### Refactor
- Enhance responsive and device authentication tests (1a658b7)

## [1.4.1] - 2026-08-24

### Miscellaneous
- Bump the minor-and-patch group with 2 updates (#56) (8122517)

## [1.4.0] - 2026-08-20

### Features
- Implement native build workflows for Android and iOS, including version stamping (0c195fa)

### Bug Fixes
- Update references from Podfile to Package.swift in CI workflows (a561c5c)

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


