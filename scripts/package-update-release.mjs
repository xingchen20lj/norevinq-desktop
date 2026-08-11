import { build, Platform } from 'electron-builder'
import { requireSecureUpdateUrl } from './update-release-config.mjs'

const updateUrl = requireSecureUpdateUrl(process.env.ASTER_UPDATE_URL)
const platform = process.platform === 'darwin'
  ? Platform.MAC
  : process.platform === 'win32'
    ? Platform.WINDOWS
    : null

if (!platform) throw new Error(`Update release packaging is not configured for ${process.platform}.`)

const artifacts = await build({
  targets: platform.createTarget(),
  publish: 'never',
  config: {
    electronUpdaterCompatibility: '>=2.16',
    publish: [{ provider: 'generic', url: updateUrl }],
  },
})

console.log(`Generated ${String(artifacts.length)} update artifacts for ${updateUrl}`)
