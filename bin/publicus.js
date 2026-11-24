#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'

async function main() {
  const { values, positionals } = parseArgs({
    options: { name: { type: 'string', short: 'n' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  })
  if (values.help) {
    console.log('Usage: publicus [--name filename] [file|-]')
    return
  }
  if (positionals.length > 1) throw new Error('Pass one file or pipe data to stdin')
  const [path] = positionals
  const useStdin = !path || path === '-'
  if (useStdin && process.stdin.isTTY) throw new Error('Pass a file or pipe data to stdin')

  const id = process.env.PUBLICUS_CLIENT_ID
  const secret = process.env.PUBLICUS_CLIENT_SECRET
  if (!id || !secret) throw new Error('Set PUBLICUS_CLIENT_ID and PUBLICUS_CLIENT_SECRET')
  const endpoint = new URL('/api/files', process.env.PUBLICUS_ORIGIN ?? 'https://p.rokoucha.net')
  if (endpoint.protocol !== 'https:') throw new Error('PUBLICUS_ORIGIN must use HTTPS')
  const name = values.name ?? (useStdin ? 'stdin.txt' : basename(path))
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    duplex: 'half',
    headers: {
      'CF-Access-Client-Id': id,
      'CF-Access-Client-Secret': secret,
      'X-File-Name': encodeURIComponent(name),
    },
    body: useStdin ? process.stdin : createReadStream(path),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.error ?? `Upload failed (HTTP ${response.status})`)
  }
  const result = await response.json()
  const shared = new URL(result.url)
  if (shared.origin !== endpoint.origin || !shared.pathname.startsWith('/s/')) {
    throw new Error('Server returned an unexpected share URL')
  }
  console.log(shared.href)
}

main().catch(error => {
  console.error('publicus: ' + (error.cause?.message ?? error.message))
  process.exitCode = 1
})
