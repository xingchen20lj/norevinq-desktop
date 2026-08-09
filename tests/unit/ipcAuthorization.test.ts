import { describe, expect, it, vi } from 'vitest'
import { requireAuthorizedIpcSender } from '../../src/main/security/ipcAuthorization.js'
import type { IpcMainInvokeEvent } from 'electron'

describe('IPC sender authorization', () => {
  it('allows only an event accepted by the main-window top-frame policy', () => {
    const event = { sender: { id: 7 }, senderFrame: { routingId: 1 } } as unknown as IpcMainInvokeEvent
    const authorize = vi.fn((candidate: IpcMainInvokeEvent) => candidate === event)

    expect(() => requireAuthorizedIpcSender(event, authorize)).not.toThrow()
    expect(authorize).toHaveBeenCalledWith(event)
  })

  it('fails closed when no policy exists or the sender is not trusted', () => {
    const event = { sender: { id: 9 }, senderFrame: null } as unknown as IpcMainInvokeEvent

    expect(() => requireAuthorizedIpcSender(event, null)).toThrow('Unauthorized IPC sender')
    expect(() => requireAuthorizedIpcSender(event, () => false)).toThrow('Unauthorized IPC sender')
  })
})
