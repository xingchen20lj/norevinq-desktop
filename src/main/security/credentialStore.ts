import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

export type EncryptionAdapter = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

type CredentialDocument = {
  version: 1
  values: Record<string, string>
}

export class CredentialStore {
  readonly #path: string
  readonly #encryption: EncryptionAdapter

  constructor(path: string, encryption: EncryptionAdapter) {
    this.#path = path
    this.#encryption = encryption
  }

  isAvailable(): boolean {
    return this.#encryption.isEncryptionAvailable()
  }

  get(name: string): string | null {
    const encrypted = this.#read().values[name]
    if (!encrypted) return null
    return this.#encryption.decryptString(Buffer.from(encrypted, 'base64'))
  }

  set(name: string, value: string): void {
    if (!this.isAvailable()) throw new Error('Operating-system credential encryption is unavailable.')
    const document = this.#read()
    document.values[name] = this.#encryption.encryptString(value).toString('base64')
    this.#write(document)
  }

  delete(name: string): void {
    const document = this.#read()
    if (!(name in document.values)) return
    document.values = Object.fromEntries(Object.entries(document.values).filter(([key]) => key !== name))
    this.#write(document)
  }

  #read(): CredentialDocument {
    if (!existsSync(this.#path)) return { version: 1, values: {} }
    const metadata = lstatSync(this.#path)
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Credential store path is not a regular file.')
    const value = JSON.parse(readFileSync(this.#path, 'utf8')) as Partial<CredentialDocument>
    if (value.version !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)) {
      throw new Error('Credential store format is invalid.')
    }
    return { version: 1, values: { ...value.values } }
  }

  #write(document: CredentialDocument): void {
    const directory = dirname(this.#path)
    mkdirSync(directory, { mode: 0o700, recursive: true })
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`
    let descriptor: number | null = null
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600)
      writeFileSync(descriptor, `${JSON.stringify(document)}\n`, { encoding: 'utf8' })
      closeSync(descriptor)
      descriptor = null
      renameSync(temporaryPath, this.#path)
      chmodSync(this.#path, 0o600)
    } finally {
      if (descriptor !== null) closeSync(descriptor)
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
  }
}
