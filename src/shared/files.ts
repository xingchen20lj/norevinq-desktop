export type FilePreviewKind = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'binary' | 'too-large'

export type FileContextInput = {
  projectId: string
  worktreeId?: string
}

export type FilePathInput = FileContextInput & {
  path: string
}

export type FileOpenInput = FilePathInput & {
  confirmed: true
}

export type AgentImagePreviewInput = FileContextInput & {
  path: string
}

export type AgentImagePreview = {
  name: string
  size: number
  mimeType: string
  url: string
}

export type ProjectFileEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink'
  size: number | null
  modifiedAt: string
  previewKind: FilePreviewKind | null
}

export type ProjectDirectory = FileContextInput & {
  path: string
  entries: ProjectFileEntry[]
  truncated: boolean
}

export type ProjectFilePreview = FileContextInput & {
  path: string
  name: string
  size: number
  modifiedAt: string
  mimeType: string
  kind: FilePreviewKind
  content: string | null
  url: string | null
  truncated: boolean
}
