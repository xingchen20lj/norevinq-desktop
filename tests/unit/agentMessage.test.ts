import { describe, expect, it } from 'vitest'
import { parseAgentMessage } from '../../src/shared/agentMessage.js'

describe('parseAgentMessage', () => {
  it('extracts angle-bracketed local images while preserving surrounding text', () => {
    expect(parseAgentMessage('图片保存在：\n\n![水墨山水](</tmp/generated images/landscape.png>)')).toEqual([
      { type: 'text', text: '图片保存在：\n\n' },
      { type: 'localImage', alt: '水墨山水', path: '/tmp/generated images/landscape.png' },
    ])
  })

  it('supports Windows absolute image paths and multiple images', () => {
    expect(parseAgentMessage('![一](C:\\Norevinq\\one.png)\n![二](D:/Norevinq/two.webp)')).toEqual([
      { type: 'localImage', alt: '一', path: 'C:\\Norevinq\\one.png' },
      { type: 'text', text: '\n' },
      { type: 'localImage', alt: '二', path: 'D:/Norevinq/two.webp' },
    ])
  })

  it('does not turn remote URLs or malformed markdown into renderable media', () => {
    const text = '![远程](https://example.com/tracker.png) ![缺失](relative.png)'
    expect(parseAgentMessage(text)).toEqual([{ type: 'text', text }])
  })
})
