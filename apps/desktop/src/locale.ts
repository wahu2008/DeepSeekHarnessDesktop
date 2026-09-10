/** Typed English and Chinese copy owned by the Electron shell. */

/**
 * Shell-owned strings only. The fork moved desktop plugin management into the
 * dsh Settings surface (Plugins → Desktop plugins) and the update check into
 * About, so their copy lives in the client dictionaries; what remains here is
 * what the main process itself renders: the startup failure box and the
 * boot-time "an update is available" prompt.
 */
export const en = {
  startupFailed: 'DeepSeek Harness could not start',
  unknownError: 'Unknown error',
  updateTitle: 'DeepSeek Harness Update',
  updateAvailable: 'An update is available',
  updateDetail: 'DeepSeek Harness {version}\n\nThis release includes its matching dsh version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  startupFailed: 'DeepSeek Harness 无法启动',
  unknownError: '未知错误',
  updateTitle: 'DeepSeek Harness 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'DeepSeek Harness {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
} as const satisfies DesktopMessages

/** Locale payload owned by the shell's own dialogs. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
