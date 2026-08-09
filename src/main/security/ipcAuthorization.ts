import type { IpcMainInvokeEvent } from 'electron'

export type IpcSenderAuthorizer = (event: IpcMainInvokeEvent) => boolean

export function requireAuthorizedIpcSender(
  event: IpcMainInvokeEvent,
  authorizer: IpcSenderAuthorizer | null,
): void {
  if (!authorizer?.(event)) throw new Error('Unauthorized IPC sender.')
}
