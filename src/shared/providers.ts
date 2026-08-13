export type CredentialSource = 'environment' | 'os-vault' | 'none'

export type DeepSeekProviderStatus = {
  configured: boolean
  credentialSource: CredentialSource
  credentialStorageAvailable: boolean
  responsesModels: ('deepseek-v4-flash' | 'deepseek-v4-pro')[]
}

export type ProviderStatus = {
  deepseek: DeepSeekProviderStatus
}

export type SaveDeepSeekCredentialInput = {
  apiKey: string
}
