import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import worker from '../src/worker.js'

const origin = 'https://p.rokoucha.net'
const issuer = 'https://test.cloudflareaccess.com'
const objects = new Map()
const env = {
  PUBLIC_ORIGIN: origin,
  ACCESS_ISSUER: issuer,
  ADMIN_AUDIENCE: 'admin',
  API_AUDIENCE: 'api',
  MCP_AUDIENCE: 'mcp',
  ASSETS: { fetch: () => new Response('admin asset') },
  FILES: {
    async put(key, bytes, { customMetadata }) {
      const object = { key, size: bytes.length, uploaded: new Date(), customMetadata }
      objects.set(key, { object, bytes })
      return object
    },
    async list() {
      return { objects: [...objects.values()].map(({ object }) => object), truncated: false }
    },
    async head(key) {
      return objects.get(key)?.object
    },
    async get(key) {
      const record = objects.get(key)
      return record && {
        ...record.object, body: record.bytes,
        text: async () => new TextDecoder().decode(record.bytes),
      }
    },
    async delete(key) {
      objects.delete(key)
    },
  },
}
const tokens = {}
const originalFetch = globalThis.fetch

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'publicus-test' }
  globalThis.fetch = async url => {
    assert.equal(String(url), issuer + '/cdn-cgi/access/certs')
    return Response.json({ keys: [jwk] })
  }
  for (const audience of ['admin', 'api', 'mcp']) {
    tokens[audience] = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer(issuer).setAudience(audience).setExpirationTime('1h').sign(privateKey)
  }
})
after(() => { globalThis.fetch = originalFetch })

function request(path, { audience, headers, ...options } = {}) {
  const merged = new Headers(headers)
  if (audience) merged.set('Cf-Access-Jwt-Assertion', tokens[audience])
  return worker.fetch(new Request(new URL(path, origin), { ...options, headers: merged }), env)
}

test('uploads with the CLI audience, serves anonymous sanitized Markdown, and revokes on deletion', async () => {
  const upload = await request('/api/files', {
    method: 'POST', audience: 'api',
    headers: { 'X-File-Name': encodeURIComponent('メモ.md') },
    body: '# Notes\n<script>alert(1)</script>',
  })
  assert.equal(upload.status, 201)
  const file = await upload.json()
  const shared = await request(file.url)
  assert.equal(shared.headers.get('Cache-Control'), 'no-store')
  assert.equal(shared.headers.get('Content-Type'), 'text/html; charset=utf-8')
  const html = await shared.text()
  assert.match(html, /<h1>Notes<\/h1>/)
  assert.doesNotMatch(html, /<script>/)
  const listed = await request('/admin/api/files', { audience: 'admin' })
  assert.deepEqual((await listed.json()).files, [file])

  const path = '/admin/api/files/' + file.id
  assert.equal((await request(path, { method: 'DELETE', audience: 'admin' })).status, 403)
  assert.equal((await request(path, {
    method: 'DELETE', audience: 'admin', headers: { Origin: origin },
  })).status, 204)
  assert.equal((await request(file.url)).status, 404)
})

test('protected paths reject absent or wrong-audience assertions', async () => {
  for (const path of ['/admin/', '/admin/app.js', '/admin/api/files']) {
    assert.equal((await request(path)).status, 401)
    assert.equal((await request(path, { audience: 'api' })).status, 401)
  }
  assert.equal((await request('/mcp', { audience: 'admin' })).status, 401)
  assert.equal((await request('/api/files', { audience: 'mcp', method: 'POST' })).status, 401)
  assert.equal((await request('/s/../admin/app.js')).status, 401)
  assert.equal((await request('https://example.com/admin/', { audience: 'admin' })).status, 404)
  assert.equal((await request('/admin/', { audience: 'admin' })).status, 200)
})

test('remote MCP negotiates and publishes HTML in an opaque sandbox', async () => {
  async function rpc(method, params) {
    const result = await request('/mcp', {
      method: 'POST', audience: 'mcp',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    assert.equal(result.status, 200)
    return (await result.json()).result
  }

  const hello = await rpc('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  })
  assert.equal(hello.serverInfo.name, 'publicus')
  const tools = await rpc('tools/list', {})
  assert.deepEqual(tools.tools.map(tool => tool.name), ['publish'])

  const html = '<script>document.body.textContent = "hello"</script>'
  const result = await rpc('tools/call', {
    name: 'publish', arguments: { name: 'demo.html', base64: Buffer.from(html).toString('base64') },
  })
  assert.equal(result.isError, undefined)
  const response = await request(result.content[0].text)
  assert.match(response.headers.get('Content-Security-Policy'), /sandbox allow-scripts/)
  assert.doesNotMatch(response.headers.get('Content-Security-Policy'), /allow-same-origin/)
  assert.equal(await response.text(), html)
})

test('arbitrary active file types download and public paths cannot mutate', async () => {
  const upload = await request('/api/files', {
    method: 'POST', audience: 'api',
    headers: { 'X-File-Name': 'drawing.svg' }, body: '<svg/>',
  })
  const { url } = await upload.json()
  const response = await request(url, { method: 'HEAD' })
  assert.match(response.headers.get('Content-Disposition'), /^attachment;/)
  assert.equal(response.headers.get('Content-Length'), '6')
  assert.equal(await response.text(), '')
  assert.equal((await request(url, { method: 'DELETE' })).status, 405)
})
