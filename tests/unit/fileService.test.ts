import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileService } from '../../src/main/files/fileService.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('FileService', () => {
  it('lists bounded project files and previews UTF-8 text without exposing absolute paths', () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, 'hello.ts'), 'export const proof = "NOREVINQ_FILE_OK"\n')
    writeFileSync(join(fixture.root, 'README'), 'plain text without an extension\n')
    const service = new FileService(fixture.database)
    const directory = service.listDirectory({ projectId: fixture.projectId, path: '' })
    expect(directory.entries.map(({ path }) => path)).toEqual(['hello.ts', 'README'])
    expect(directory.entries.every(({ path }) => !path.startsWith(fixture.root))).toBe(true)
    expect(service.readPreview({ projectId: fixture.projectId, path: 'hello.ts' })).toMatchObject({
      kind: 'text', content: 'export const proof = "NOREVINQ_FILE_OK"\n', truncated: false,
    })
    expect(service.readPreview({ projectId: fixture.projectId, path: 'README' })).toMatchObject({
      kind: 'text', content: 'plain text without an extension\n',
    })
    fixture.database.close()
  })

  it('truncates large text and refuses oversized image previews', () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, 'large.txt'), 'a'.repeat(2 * 1024 * 1024 + 50))
    writeFileSync(join(fixture.root, 'large.png'), '')
    truncateSync(join(fixture.root, 'large.png'), 50 * 1024 * 1024 + 1)
    const service = new FileService(fixture.database)
    const text = service.readPreview({ projectId: fixture.projectId, path: 'large.txt' })
    expect(text.kind).toBe('text')
    expect(text.content).toHaveLength(2 * 1024 * 1024)
    expect(text.truncated).toBe(true)
    expect(service.readPreview({ projectId: fixture.projectId, path: 'large.png' }).kind).toBe('too-large')
    fixture.database.close()
  })

  it('issues opaque expiring media URLs and never serializes project paths into them', () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, 'proof.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    let now = 1_000
    const service = new FileService(fixture.database, { now: () => now })
    const preview = service.readPreview({ projectId: fixture.projectId, path: 'proof.png' })
    expect(preview.kind).toBe('image')
    expect(preview.url).toMatch(/^norevinq-file:\/\/preview\/[0-9a-f-]{36}$/u)
    expect(preview.url).not.toContain(fixture.root)
    const token = preview.url?.split('/').at(-1) ?? ''
    expect(service.resolvePreviewToken(token)?.path).toBe(join(realpathSync(fixture.root), 'proof.png'))
    now += 15 * 60 * 1_000
    expect(service.resolvePreviewToken(token)).toBeNull()
    fixture.database.close()
  })

  it('issues inline image previews only for active projects or the trusted Norevinq artifact directory', () => {
    const fixture = createFixture()
    const artifacts = join(fixture.root, '..', 'agent-home', 'generated_images')
    mkdirSync(artifacts, { recursive: true })
    const projectImage = join(fixture.root, 'project-image.png')
    const generatedImage = join(artifacts, 'generated image.webp')
    writeFileSync(projectImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(generatedImage, Buffer.from([0x52, 0x49, 0x46, 0x46]))
    const service = new FileService(fixture.database, { trustedArtifactRoots: [artifacts] })

    expect(service.readAgentImage({ projectId: fixture.projectId, path: projectImage })).toMatchObject({
      name: 'project-image.png', mimeType: 'image/png',
    })
    expect(service.readAgentImage({ projectId: fixture.projectId, path: generatedImage })).toMatchObject({
      name: 'generated image.webp', mimeType: 'image/webp',
    })
    expect(service.readAgentImage({ projectId: fixture.projectId, path: generatedImage }).url)
      .toMatch(/^norevinq-file:\/\/preview\/[0-9a-f-]{36}$/u)
    fixture.database.close()
  })

  it('rejects agent image paths outside trusted roots and active content such as SVG', () => {
    const fixture = createFixture()
    const artifacts = join(fixture.root, '..', 'agent-home', 'generated_images')
    const outside = mkdtempSync(join(tmpdir(), 'norevinq-agent-image-outside-'))
    temporaryPaths.push(outside)
    mkdirSync(artifacts, { recursive: true })
    const outsideImage = join(outside, 'outside.png')
    const svg = join(artifacts, 'active.svg')
    writeFileSync(outsideImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error()</script></svg>')
    const service = new FileService(fixture.database, { trustedArtifactRoots: [artifacts] })

    expect(() => service.readAgentImage({ projectId: fixture.projectId, path: outsideImage })).toThrow(/outside/u)
    expect(() => service.readAgentImage({ projectId: fixture.projectId, path: svg })).toThrow(/format/u)
    fixture.database.close()
  })

  it('rejects traversal, absolute paths, and every symbolic-link component', () => {
    const fixture = createFixture()
    const outside = mkdtempSync(join(tmpdir(), 'norevinq-files-outside-'))
    temporaryPaths.push(outside)
    writeFileSync(join(outside, 'secret.txt'), 'not available')
    symlinkSync(outside, join(fixture.root, 'escape'))
    const service = new FileService(fixture.database)
    expect(() => service.readPreview({ projectId: fixture.projectId, path: '../secret.txt' })).toThrow(/escapes/u)
    expect(() => service.readPreview({ projectId: fixture.projectId, path: join(outside, 'secret.txt') })).toThrow(/relative/u)
    expect(() => service.readPreview({ projectId: fixture.projectId, path: 'escape/secret.txt' })).toThrow(/Symbolic links/u)
    fixture.database.close()
  })

  it('invalidates a preview token when the file identity is replaced', () => {
    const fixture = createFixture()
    const path = join(fixture.root, 'proof.png')
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const service = new FileService(fixture.database)
    const preview = service.readPreview({ projectId: fixture.projectId, path: 'proof.png' })
    const token = preview.url?.split('/').at(-1) ?? ''
    renameSync(path, join(fixture.root, 'original.png'))
    writeFileSync(path, 'replacement')

    expect(service.resolvePreviewToken(token)).toBeNull()
    fixture.database.close()
  })

  it('opens regular artifacts only after IPC confirmation and blocks executable-like files', async () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, 'report.pdf'), '%PDF-1.4')
    writeFileSync(join(fixture.root, 'run.command'), '#!/bin/sh\n')
    const opened: string[] = []
    const service = new FileService(fixture.database, { openPath: (path) => { opened.push(path); return Promise.resolve('') } })
    await service.openExternal({ projectId: fixture.projectId, path: 'report.pdf', confirmed: true })
    expect(opened).toEqual([join(realpathSync(fixture.root), 'report.pdf')])
    await expect(service.openExternal({ projectId: fixture.projectId, path: 'run.command', confirmed: true }))
      .rejects.toThrow(/Executable/u)
    fixture.database.close()
  })
})

function createFixture(): { root: string; projectId: string; database: StateDatabase } {
  const fixture = mkdtempSync(join(tmpdir(), 'norevinq-files-test-'))
  temporaryPaths.push(fixture)
  const root = join(fixture, 'project')
  mkdirSync(root)
  const database = new StateDatabase(join(fixture, 'state.sqlite3'))
  const projectId = database.upsertProject(root).id
  return { root, projectId, database }
}
