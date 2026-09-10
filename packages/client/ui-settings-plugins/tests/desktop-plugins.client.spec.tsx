// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { DesktopPluginsTabProps } from '../src/client/DesktopPluginsTab.tsx'
import { DesktopPluginsTab } from '../src/client/DesktopPluginsTab.tsx'
import { en } from '../src/client/locales.ts'

/** Serve one desktop-plugin record list through the carrier stub. */
interface BridgeStub {
  list: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

function mountBridge(plugins: readonly { name: string; version: string }[] = []): BridgeStub {
  const bridge: BridgeStub = {
    list: vi.fn(() => Promise.resolve(plugins)),
    add: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
  }
  ;(window as unknown as { dshDesktop?: unknown }).dshDesktop = { protocolVersion: 1, plugins: bridge }
  return bridge
}

// Global standard kit stubs: the tab consumes none of these hooks.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const unusedHook = (() => { throw new Error('unused by the desktop plugins tab') }) as never
const kit = { useSessions: unusedHook, useSessionPendingInteraction: unusedHook, useResource, useWorkspaces: unusedHook }

const t = ((key: string, values?: Readonly<Record<string, unknown>>) => {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replaceAll(/\{([^{}]+)\}/gu, (match, name: string) => String(values?.[name] ?? match))
}) as unknown as DesktopPluginsTabProps['t']

function mountTab() {
  return render(<DesktopPluginsTab {...({ ...kit, t } as unknown as DesktopPluginsTabProps)} />)
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
  vi.restoreAllMocks()
})

describe('DesktopPluginsTab', () => {
  it('explains that the tab needs the packaged desktop application', () => {
    mountTab()
    expect(screen.getByText('Desktop plugins are available only in the packaged Desktop application.')).toBeTruthy()
  })

  it('reads the inventory on mount and reports an empty profile', async () => {
    const bridge = mountBridge()
    mountTab()
    expect(screen.getByRole('status').textContent).toBe('Reading Desktop plugins…')
    expect(await screen.findByText('No Desktop plugins are installed.')).toBeTruthy()
    expect(bridge.list).toHaveBeenCalledTimes(1)
  })

  it('lists installed plugins and re-reads them on refresh', async () => {
    const bridge = mountBridge([{ name: '@scope/plugin', version: '1.2.3' }])
    mountTab()
    expect(await screen.findByText('@scope/plugin')).toBeTruthy()
    expect(screen.getByText('1.2.3')).toBeTruthy()
    bridge.list.mockResolvedValue([{ name: '@scope/plugin', version: '1.3.0' }])
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('1.3.0')).toBeTruthy()
    expect(bridge.list).toHaveBeenCalledTimes(2)
  })

  it('surfaces a failed inventory read', async () => {
    mountBridge().list.mockRejectedValue(new Error('profile is broken'))
    mountTab()
    expect(await screen.findByText('profile is broken')).toBeTruthy()
  })

  it('installs a trimmed package spec and reloads the list', async () => {
    const bridge = mountBridge()
    mountTab()
    await screen.findByText('No Desktop plugins are installed.')
    fireEvent.change(screen.getByLabelText('npm package'), { target: { value: '  @scope/plugin@1.2.3  ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => { expect(bridge.add).toHaveBeenCalledWith('@scope/plugin@1.2.3') })
    expect(await screen.findByText('Done.')).toBeTruthy()
    expect(bridge.list).toHaveBeenCalledTimes(2)
  })

  it('ignores an empty spec and reports a rejected install', async () => {
    const bridge = mountBridge()
    bridge.add.mockRejectedValue(new Error('plugin has no bundle patch'))
    mountTab()
    await screen.findByText('No Desktop plugins are installed.')
    fireEvent.submit(screen.getByRole('button', { name: 'Install' }))
    expect(bridge.add).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('npm package'), { target: { value: '@scope/broken' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Install' }))
    expect(await screen.findByText('plugin has no bundle patch')).toBeTruthy()
  })

  it('updates to the prompted version and skips a no-op answer', async () => {
    const bridge = mountBridge([{ name: '@scope/plugin', version: '1.2.3' }])
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('1.4.0')
    mountTab()
    await screen.findByText('@scope/plugin')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => { expect(bridge.update).toHaveBeenCalledWith('@scope/plugin', '1.4.0') })
    expect(prompt).toHaveBeenCalledWith('Enter the target version for @scope/plugin', '1.2.3')

    prompt.mockReturnValue('1.2.3')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    prompt.mockReturnValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    prompt.mockReturnValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(bridge.update).toHaveBeenCalledTimes(1)
  })

  it('removes an installed plugin and reports a rejected removal', async () => {
    const bridge = mountBridge([{ name: '@scope/plugin', version: '1.2.3' }])
    mountTab()
    await screen.findByText('@scope/plugin')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => { expect(bridge.remove).toHaveBeenCalledWith('@scope/plugin') })

    bridge.remove.mockRejectedValue(new Error('another package transaction is active'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('another package transaction is active')).toBeTruthy()
  })
})

describe('ui-settings-plugins desktop tab registration', () => {
  async function bench() {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const remote = new TestRemote(ctx, {
      credentials: {
        describe: vi.fn(() => Promise.resolve({
          ok: false, error: new RemoteError('gateway/internal', 'no provider', {}),
        })),
        set: vi.fn(),
      },
      session: { modelCatalog: vi.fn(() => Promise.resolve({ ok: true, value: { groups: [], failures: [] } })) },
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: false, error: new RemoteError('gateway/internal', 'no provider', {}),
        })),
      },
    })
    await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    return { ctx, slots, remote }
  }

  it('registers no desktop tab in a bare browser web host', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('settings.plugins.tab').map(entry => entry.options.id)).toEqual(['configurable'])
  })

  it('registers the desktop tab beside the configurable one inside the carrier', async () => {
    mountBridge()
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const tabs = slots.entries('settings.plugins.tab')
      .map(entry => ({
        id: entry.options.id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label),
      }))
      .sort((left, right) => left.order - right.order)
    expect(tabs).toEqual([
      { id: 'configurable', order: 0, label: '插件配置' },
      { id: 'desktop', order: 10, label: '桌面插件' },
    ])
  })
})
