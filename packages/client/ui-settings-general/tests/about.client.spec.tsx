// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AboutSectionComponentProps } from '../src/client/AboutSection.tsx'
import { AboutSection } from '../src/client/AboutSection.tsx'
import { en } from '../src/client/locales.ts'

// Global standard kit stubs: the About section consumes none of these hooks.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const unusedHook = (() => { throw new Error('unused by the About section') }) as never
const kit = { useSessions: unusedHook, useSessionPendingInteraction: unusedHook, useResource, useWorkspaces: unusedHook }

// The seat resolves keys from the package dictionary and fills {placeholders}.
const t = ((key: string, values?: Readonly<Record<string, unknown>>) => {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replaceAll(/\{([^{}]+)\}/gu, (match, name: string) => String(values?.[name] ?? match))
}) as unknown as AboutSectionComponentProps['t']

const about = {
  name: 'DeepSeek Harness Desktop',
  version: '0.1.5-alpha.1',
  electron: '44.0.0',
  node: '24.17.0',
  platform: 'win32',
  basis: 'deepseek-harness dsh 0.1.5-alpha.1',
  repoUrl: 'https://github.com/wahu2008/DeepSeekHarnessDesktop',
  dshHome: 'C:\\Users\\Administrator\\.dsh',
}

type UpdateState = { phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'; version?: string; message?: string }

interface CarrierStub {
  about: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  updates: {
    check: ReturnType<typeof vi.fn>
    install: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    listener: (state: UpdateState) => void
  }
}

/** Install a carrier bridge on the jsdom window and return its spies. */
function mountCarrier(): CarrierStub {
  const carrier: CarrierStub = {
    about: vi.fn(() => Promise.resolve(about)),
    openExternal: vi.fn(() => Promise.resolve(true)),
    updates: {
      check: vi.fn(() => Promise.resolve<UpdateState>({ phase: 'idle' })),
      install: vi.fn(() => Promise.resolve()),
      subscribe: vi.fn((listener: (state: UpdateState) => void) => {
        carrier.updates.listener = listener
        return () => { carrier.updates.listener = () => {} }
      }),
      listener: () => {},
    },
  }
  ;(window as unknown as { dshDesktop?: unknown }).dshDesktop = { protocolVersion: 1, ...carrier }
  return carrier
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
})

function renderAbout() {
  return render(<AboutSection {...kit} t={t} close={vi.fn()} />)
}

describe('AboutSection', () => {
  it('renders nothing without the desktop carrier bridge', () => {
    const { container } = renderAbout()
    expect(container.firstChild).toBeNull()
  })

  it('renders the release identity and opens the repository in the shell', async () => {
    const carrier = mountCarrier()
    renderAbout()
    expect(await screen.findByText(/DeepSeek Harness Desktop/u)).toBeTruthy()
    expect(screen.getByText('0.1.5-alpha.1')).toBeTruthy()
    expect(screen.getByText('Electron 44.0.0 · Node 24.17.0 · win32')).toBeTruthy()
    expect(screen.getByText('deepseek-harness dsh 0.1.5-alpha.1')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: about.repoUrl }))
    expect(carrier.openExternal).toHaveBeenCalledWith(about.repoUrl)
  })

  it('reports the runtime row as empty until the identity arrives', async () => {
    let resolveAbout: (value: typeof about) => void = () => {}
    mountCarrier().about.mockReturnValue(new Promise((resolve) => { resolveAbout = resolve }))
    const { container } = renderAbout()
    expect(container.textContent).toContain('Runtime')
    resolveAbout(about)
    await waitFor(() => { expect(screen.getByText(/Electron 44\.0\.0/u)).toBeTruthy() })
  })

  it('follows shell-published update states and unsubscribes on unmount', async () => {
    const carrier = mountCarrier()
    const view = renderAbout()
    expect(carrier.updates.subscribe).toHaveBeenCalledTimes(1)
    // An untouched page makes no claim: the boot-time idle broadcast is not a check.
    expect(screen.getByRole('status').textContent).toBe('')
    carrier.updates.listener({ phase: 'idle' })
    expect(screen.getByRole('status').textContent).toBe('')
    carrier.updates.listener({ phase: 'checking' })
    expect(await screen.findByText('Checking for updates…')).toBeTruthy()
    carrier.updates.listener({ phase: 'idle' })
    expect(await screen.findByText('You already have the latest version.')).toBeTruthy()
    carrier.updates.listener({ phase: 'available', version: '0.1.6-alpha.1' })
    expect(await screen.findByText('Version 0.1.6-alpha.1 is available.')).toBeTruthy()
    carrier.updates.listener({ phase: 'installing', version: '0.1.6-alpha.1' })
    expect(await screen.findByText('Downloading and installing 0.1.6-alpha.1…')).toBeTruthy()
    carrier.updates.listener({ phase: 'ready' })
    expect(await screen.findByText('The update is ready; the application is restarting.')).toBeTruthy()
    carrier.updates.listener({ phase: 'error', message: 'network down' })
    expect(await screen.findByText('Update failed: network down')).toBeTruthy()
    view.unmount()
    expect(carrier.updates.listener).toBeInstanceOf(Function)
  })

  it('checks for updates on demand and shows the latest-version answer', async () => {
    const carrier = mountCarrier()
    renderAbout()
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('You already have the latest version.')).toBeTruthy()
    expect(carrier.updates.check).toHaveBeenCalledTimes(1)
  })

  it('offers installation for an available release and installs it', async () => {
    const carrier = mountCarrier()
    carrier.updates.check.mockResolvedValue({ phase: 'available', version: '0.1.6-alpha.1' })
    renderAbout()
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    const install = await screen.findByRole('button', { name: 'Install and Restart' })
    fireEvent.click(install)
    await waitFor(() => { expect(carrier.updates.install).toHaveBeenCalledTimes(1) })
  })

  it('surfaces a rejected check as the update failure line', async () => {
    const carrier = mountCarrier()
    carrier.updates.check.mockRejectedValue(new Error('offline'))
    renderAbout()
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Update failed: offline')).toBeTruthy()
  })

  it('surfaces a rejected install as the update failure line', async () => {
    const carrier = mountCarrier()
    carrier.updates.check.mockResolvedValue({ phase: 'available', version: '0.1.6-alpha.1' })
    carrier.updates.install.mockRejectedValue('bad signature')
    renderAbout()
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Install and Restart' }))
    expect(await screen.findByText('Update failed: bad signature')).toBeTruthy()
  })
})
