import {
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './scripts/notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './scripts/verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  installWindowsNsisBootstrapSigner,
} from './scripts/windows-sign.mjs'
import { resolveDesktopAutoUpdateConfig } from './scripts/desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'

/** Fork extension: environment variables that select Windows release signing. */
const WINDOWS_SIGNING_ENV_NAMES = [
  'DSH_DESKTOP_WINDOWS_CER_FILE',
  'DSH_DESKTOP_WINDOWS_KEY_CONTAINER',
  'DSH_DESKTOP_WINDOWS_SIGNTOOL',
  'DSH_DESKTOP_WINDOWS_TOKEN_PIN',
]

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const appId = resolveDesktopAppId(env)
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32'
  const macOSSigning = packagesMacOS ? resolveMacOSSigningEnvironment(env) : undefined
  if (packagesMacOS) resolveMacOSNotarizationEnvironment(env)
  // Fork behavior: Windows release signing is optional. When none of the four
  // DSH_DESKTOP_WINDOWS_* credentials is present the target is packaged
  // unsigned (forceCodeSigning disabled, no SafeNet signer). Setting any one of
  // them keeps the upstream contract: all four are required and validation
  // throws for a partial set, so a configured signing identity is never
  // silently downgraded to an unsigned artifact.
  const windowsSigningRequested = packagesWindows && WINDOWS_SIGNING_ENV_NAMES
    .some((name) => env[name] !== undefined && env[name] !== '')
  const windowsSigner = windowsSigningRequested
    ? createWindowsTokenSigner({
        certificateFile: env.DSH_DESKTOP_WINDOWS_CER_FILE,
        signTool: env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
        tokenPin: env.DSH_DESKTOP_WINDOWS_TOKEN_PIN,
        keyContainer: env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER,
      })
    : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const update = resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)
  const buildPaths = desktopTargetBuildPaths(update.target)
  // Fork extension: DSH_DESKTOP_ELECTRON_DIST points electron-builder at an
  // already-unpacked Electron distribution so Windows packaging copies it into
  // the app directory instead of extracting the zip and renaming the staging
  // directory. Local Windows builds without an AV exclusion can hit EPERM on
  // that rename while the AV scans freshly written executables. Unset by
  // default, so release automation keeps the upstream zip-extract path.
  const electronDist = env.DSH_DESKTOP_ELECTRON_DIST?.trim()
  return {
    appId,
    productName: 'DeepSeek Harness',
    artifactName: 'deepseek-harness-${version}-${os}-${arch}.${ext}',
    ...(electronDist === undefined || electronDist === '' ? {} : { electronDist }),
    directories: { output: buildPaths.artifacts },
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.seed, to: 'seed' },
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      identity: macOSSigning?.signingIdentity,
      forceCodeSigning: true,
      hardenedRuntime: true,
      notarize: true,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: true,
      writeUpdateInfo: false,
    },
    afterSign: context => {
      if (context.electronPlatformName !== 'darwin') return
      verifyMacOSSignatureAfterSign(context, macOSSigning ?? resolveMacOSSigningEnvironment(env))
    },
    artifactBuildCompleted: artifact => {
      if (!artifact.file.endsWith('.dmg')) return
      return notarizeMacOSDiskImageArtifact(
        artifact,
        env,
        macOSSigning ?? resolveMacOSSigningEnvironment(env),
      )
    },
    win: {
      forceCodeSigning: windowsSigner !== undefined,
      ...(windowsSigner !== undefined
        ? {
            signtoolOptions: {
              sign: windowsSigner,
              signingHashAlgorithms: ['sha256'],
            },
          }
        : {}),
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
    },
    publish: [{ provider: 'generic', url: update.publicUrl }],
  }
}

export default createElectronBuilderConfig()
