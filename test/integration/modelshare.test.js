// pear:// model sharing — seed a file as a Hyperdrive on one "machine",
// fetch it on another with no internet (local testnet only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import createTestnet from 'hyperdht/testnet.js'
import { seedFile, fetchFile, driveUrl, parseDriveUrl } from '../../lib/modelshare.js'

function tmpdir (name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gaffer-${name}-`))
}

test('driveUrl/parseDriveUrl roundtrip', () => {
  const key = Buffer.alloc(32, 7)
  const url = driveUrl(key, 'model.gguf')
  assert.match(url, /^pear:\/\/[a-z0-9]+\/model\.gguf$/)
  const parsed = parseDriveUrl(url)
  assert.ok(Buffer.from(parsed.key).equals(key))
  assert.equal(parsed.file, '/model.gguf')
})

test('parseDriveUrl rejects non-pear URLs', () => {
  assert.throws(() => parseDriveUrl('https://huggingface.co/model.gguf'), /not a pear/)
  assert.throws(() => parseDriveUrl('pear:model'), /not a pear/)
})

test('a model file seeded on machine A is fetched byte-exact on machine B', async (t) => {
  const tn = await createTestnet(3)
  const srcDir = tmpdir('seed')
  const dstDir = tmpdir('fetch')
  // a fake GGUF — content large enough to span multiple blocks
  const payload = Buffer.concat([Buffer.from('GGUF-FAKE-HEADER'), Buffer.alloc(256 * 1024, 0xab)])
  const modelPath = path.join(srcDir, 'tiny-model.gguf')
  fs.writeFileSync(modelPath, payload)

  const seeder = await seedFile({ filePath: modelPath, storage: path.join(srcDir, 'store'), bootstrap: tn.bootstrap })
  t.after(async () => {
    await seeder.close().catch(() => {})
    await tn.destroy()
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(dstDir, { recursive: true, force: true })
  })
  assert.match(seeder.url, /^pear:\/\/.+\/tiny-model\.gguf$/)

  const dest = path.join(dstDir, 'downloaded.gguf')
  const res = await fetchFile({
    url: seeder.url,
    destPath: dest,
    storage: path.join(dstDir, 'store'),
    bootstrap: tn.bootstrap,
    timeoutMs: 30_000
  })
  assert.equal(res.bytes, payload.byteLength)
  assert.ok(Buffer.from(fs.readFileSync(dest)).equals(payload), 'downloaded bytes identical')
})

test('fetchFile fails cleanly when the file does not exist in the drive', async (t) => {
  const tn = await createTestnet(3)
  const srcDir = tmpdir('seed2')
  const dstDir = tmpdir('fetch2')
  const modelPath = path.join(srcDir, 'real.gguf')
  fs.writeFileSync(modelPath, 'x')
  const seeder = await seedFile({ filePath: modelPath, storage: path.join(srcDir, 'store'), bootstrap: tn.bootstrap })
  t.after(async () => {
    await seeder.close().catch(() => {})
    await tn.destroy()
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(dstDir, { recursive: true, force: true })
  })
  const wrongUrl = seeder.url.replace('real.gguf', 'ghost.gguf')
  await assert.rejects(
    fetchFile({ url: wrongUrl, destPath: path.join(dstDir, 'x'), storage: path.join(dstDir, 'store'), bootstrap: tn.bootstrap, timeoutMs: 8000 }),
    /not found|timeout|REQUEST_TIMEOUT/i
  )
})
