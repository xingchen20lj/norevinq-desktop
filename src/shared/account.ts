export type AccountStatus = 'unavailable' | 'loading' | 'signedOut' | 'authenticated' | 'loginPending' | 'error'

export type AccountSummary =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock'; credentialSource: 'codexManaged' | 'awsManaged' }
  | { type: 'unknown'; label: string }

export type AccountRateLimitWindow = {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export type AccountRateLimits = {
  limitId: string | null
  limitName: string | null
  primary: AccountRateLimitWindow | null
  secondary: AccountRateLimitWindow | null
  reachedType: string | null
  availableResetCredits: number | null
}

export type PendingAccountLogin = {
  type: 'browser' | 'deviceCode'
  verificationUrl: string
  userCode: string | null
}

export type AccountSnapshot = {
  status: AccountStatus
  requiresOpenaiAuth: boolean | null
  account: AccountSummary | null
  pendingLogin: PendingAccountLogin | null
  rateLimits: AccountRateLimits | null
  error: string | null
  updatedAt: string | null
}

export type AccountSubscription = (snapshot: AccountSnapshot) => void

export type LoginOpenAiApiKeyInput = {
  apiKey: string
}
