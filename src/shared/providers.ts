export type CredentialSource = 'environment' | 'os-vault' | 'none'

export type DeepSeekProviderStatus = {
  configured: boolean
  credentialSource: CredentialSource
  credentialStorageAvailable: boolean
  responsesModel: 'deepseek-v4-flash'
  unavailableModels: { model: string; reason: string }[]
}

export type ProviderStatus = {
  deepseek: DeepSeekProviderStatus
}

export type SaveDeepSeekCredentialInput = {
  apiKey: string
}
