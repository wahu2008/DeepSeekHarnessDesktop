/**
 * Archive management settings section. Lists every session in the
 * registry-global archive set and exposes the two management verbs:
 * 取消归档 (unarchive — restores the session to its grouping surface) and
 * 永久删除 (delete — permanently removes the session's durable content, and
 * only applies to archived sessions). The section is a registration of the
 * `settings.section` slot, so it arrives with the framework's data hooks
 * (`useSessions` / `useWorkspaces`) and the shell's `close` affordance.
 */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `settings.section` SlotMap entry so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { relativeTime } from './tree.ts'
import css from './ArchiveManagement.module.css'

/** Injected verbs the section drives on the workspaces domain. */
export interface ArchiveManagementInjected {
  /** Remove one session from the archive set (restores its grouping position). */
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  /** Permanently delete one archived session's durable content. */
  deleteSession: (sessionId: SessionId) => Promise<void>
}

/** Full section props: the framework runtime share, the locale seat, and the injected verbs. */
export type ArchiveManagementProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'workspace'>
  & Omit<ArchiveManagementInjected, 'hooks'>

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
function timeLabel(updatedAt: number, now: number, t: ArchiveManagementProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/**
 * Render the archive list.
 * @param props - framework share (useSessions/useWorkspaces/close) + locale + verbs.
 * @returns the section content.
 */
export function ArchiveManagementSection({
  useSessions, useWorkspaces, unarchiveSession, deleteSession, t,
}: ArchiveManagementProps) {
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s.items)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const [busy, setBusy] = useState<SessionId | null>(null)
  const [confirmId, setConfirmId] = useState<SessionId | null>(null)
  const [confirmTitle, setConfirmTitle] = useState('')
  const now = Date.now()

  const rows = archived.flatMap(id => {
    const summary = sessions.byId[id]
    if (summary === undefined) return []
    const workspace = workspaces.find(w => w.sessionIds.includes(id))
    return [{ id, summary, workspace }]
  })

  const unarchive = (id: SessionId): void => {
    setBusy(id)
    void unarchiveSession(id)
      .catch((reason: unknown) => { console.warn('session unarchive rejected:', reason) })
      .finally(() => { setBusy(null) })
  }

  const confirmDelete = (): void => {
    if (confirmId === null || busy !== null) return
    const id = confirmId
    setBusy(id)
    void deleteSession(id)
      .catch((reason: unknown) => { console.warn('session delete rejected:', reason) })
      .finally(() => { setBusy(null); setConfirmId(null) })
  }

  return (
    <div className={css.root}>
      {rows.length === 0 && <div className={css.empty}>{t('archive.empty')}</div>}
      <ul className={css.list}>
        {rows.map(({ id, summary, workspace }) => (
          <li key={id} className={css.row} role="listitem">
            <div className={css.meta}>
              <div className={css.title}>{summary.displayTitle}</div>
              <div className={css.sub}>
                <span>{timeLabel(summary.updatedAt, now, t)}</span>
                {workspace !== undefined && (
                  <span>{t('archive.workspace', { name: workspace.title })}</span>
                )}
              </div>
            </div>
            <div className={css.actions}>
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => { unarchive(id) }}
              >
                {busy === id ? t('archive.unarchive.pending') : t('archive.unarchive')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => { setConfirmId(id); setConfirmTitle(summary.displayTitle) }}
              >
                {busy === id ? t('archive.delete.pending') : t('archive.delete')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={confirmId !== null}
        onClose={() => { if (busy === null) setConfirmId(null) }}
        title={t('archive.delete.title')}
        closeLabel={t('close')}
      >
        <div className={css.confirm}>
          <div className={css.confirmTitle}>{t('archive.delete.title')}</div>
          <div className={css.confirmDesc}>{t('archive.delete.desc', { name: confirmTitle })}</div>
          <div className={css.confirmActions}>
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => { setConfirmId(null) }}>
              {t('close')}
            </Button>
            <Button type="button" variant="primary" disabled={busy !== null} onClick={confirmDelete}>
              {busy !== null ? t('archive.delete.pending') : t('archive.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
