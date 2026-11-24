import MarkdownIt from 'markdown-it'

export const maxFileBytes = 20 * 1024 * 1024
const maxMarkdownBytes = 1024 * 1024
const markdown = new MarkdownIt({ html: false })
const types = new Map(Object.entries({
  html: 'text/html', htm: 'text/html',
  md: 'text/markdown', markdown: 'text/markdown',
  txt: 'text/plain', diff: 'text/plain', log: 'text/plain', json: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
}))

export class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function readBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) {
    throw new RequestError(413, 'File is too large')
  }
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new RequestError(413, 'File is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function fileType(name) {
  return types.get(name.split('.').at(-1).toLowerCase()) ?? 'application/octet-stream'
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || !name.isWellFormed() ||
      new TextEncoder().encode(name).length > 255 || /[\p{Cc}/\\]/u.test(name)) {
    throw new RequestError(400, 'Invalid file name')
  }
  return name
}

function describe(env, object) {
  return {
    id: object.key,
    name: object.customMetadata.name,
    size: object.size,
    createdAt: object.uploaded.toISOString(),
    url: new URL('/s/' + object.key, env.PUBLIC_ORIGIN).href,
  }
}

export async function publish(env, name, bytes) {
  name = validateName(name)
  const type = fileType(name)
  const limit = type === 'text/markdown' ? maxMarkdownBytes : maxFileBytes
  if (bytes.byteLength > limit) throw new RequestError(413, 'File is too large')
  const id = crypto.randomUUID()
  const object = await env.FILES.put(id, bytes, { customMetadata: { name } })
  return describe(env, object)
}

export async function listFiles(env, cursor) {
  const page = await env.FILES.list({
    limit: 50, cursor: cursor || undefined, include: ['customMetadata'],
  })
  return {
    files: page.objects.map(object => describe(env, object)),
    cursor: page.truncated ? page.cursor : null,
  }
}

export async function serveFile(env, request, id) {
  const head = request.method === 'HEAD'
  const object = head ? await env.FILES.head(id) : await env.FILES.get(id)
  if (!object) return new Response(null, { status: 404 })
  const name = object.customMetadata.name
  const type = fileType(name)
  const headers = new Headers({
    'Content-Type': type.startsWith('text/') ? type + '; charset=utf-8' : type,
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'",
  })
  if (type === 'application/octet-stream') {
    const filename = encodeURIComponent(name).replace(/['()*]/g, char =>
      '%' + char.charCodeAt(0).toString(16).toUpperCase())
    headers.set('Content-Disposition', "attachment; filename*=UTF-8''" + filename)
  }
  if (type === 'text/html') {
    headers.set('Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'")
  }
  if (type === 'text/markdown') {
    headers.set('Content-Type', 'text/html; charset=utf-8')
    headers.set('Content-Security-Policy',
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'")
    const body = head ? null : '<!doctype html><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{font:16px/1.65 system-ui;margin:3rem auto;padding:0 1.25rem;max-width:48rem}pre{overflow:auto;background:#eee;padding:1rem}img{max-width:100%}</style>' +
      markdown.render(await object.text())
    return new Response(body, { headers })
  }
  headers.set('Content-Length', String(object.size))
  return new Response(head ? null : object.body, { headers })
}
