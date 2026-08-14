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

  it('renders local image links emitted as ordinary Markdown links', () => {
    expect(parseAgentMessage('图片已生成：[查看原图](</Volumes/Test Disk/norevinq/image.png>)')).toEqual([
      { type: 'text', text: '图片已生成：' },
      {
        type: 'localImage',
        alt: '查看原图',
        path: '/Volumes/Test Disk/norevinq/image.png',
      },
    ])
  })

  it('renders an absolute generated image path emitted as inline code', () => {
    const path = '/Volumes/Test Disk/norevinq/generated_images/thread/exec-result.png'
    expect(parseAgentMessage(`图片已显示在上一条消息上方。原图保存在：\n\n\`${path}\``)).toEqual([
      { type: 'text', text: '图片已显示在上一条消息上方。原图保存在：\n\n' },
      { type: 'localImage', alt: 'exec-result.png', path },
    ])
  })

  it('does not turn remote URLs or malformed markdown into renderable media', () => {
    const text = '![远程](https://example.com/tracker.png) ![缺失](relative.png) [文档](</tmp/report.txt>) `/tmp/report.txt`'
    expect(parseAgentMessage(text)).toEqual([{ type: 'text', text }])
  })
})
