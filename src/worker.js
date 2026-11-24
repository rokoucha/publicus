import { authorized } from './auth.js'
import { listFiles, maxFileBytes, publish, readBody, RequestError, serveFile } from './files.js'
import { handleMcp } from './mcp.js'

const idPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const sharePath = new RegExp('^/s/(' + idPattern + ')$')
const deletePath = new RegExp('^/admin/api/files/(' + idPattern + ')$')

function methodNotAllowed(allow) {
  return new Response(null, { status: 405, headers: { Allow: allow } })
}

async function postFile(request, env) {
  const encodedName = request.headers.get('X-File-Name')
  if (!encodedName) throw new RequestError(400, 'Missing X-File-Name header')
  let name
  try {
    name = decodeURIComponent(encodedName)
  } catch {
    throw new RequestError(400, 'Invalid X-File-Name header')
  }
  return Response.json(await publish(env, name, await readBody(request, maxFileBytes)), { status: 201 })
}

async function route(request, env) {
  const url = new URL(request.url)
  const { pathname } = url
  if (url.origin !== env.PUBLIC_ORIGIN) return new Response(null, { status: 404 })

  const shared = sharePath.exec(pathname)
  if (shared) {
    if (!['GET', 'HEAD'].includes(request.method)) return methodNotAllowed('GET, HEAD')
    return serveFile(env, request, shared[1])
  }
  if (pathname === '/mcp') {
    if (!(await authorized(request, env, env.MCP_AUDIENCE))) return new Response(null, { status: 401 })
    return handleMcp(request, env)
  }
  if (pathname === '/api/files') {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    if (!(await authorized(request, env, env.API_AUDIENCE))) return new Response(null, { status: 401 })
    return postFile(request, env)
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!(await authorized(request, env, env.ADMIN_AUDIENCE))) return new Response(null, { status: 401 })
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) {
      return new Response(null, { status: 403 })
    }
    if (pathname === '/admin/api/files') {
      if (request.method === 'GET') return Response.json(await listFiles(env, url.searchParams.get('cursor')))
      if (request.method === 'POST') return postFile(request, env)
      return methodNotAllowed('GET, POST')
    }
    const deleted = deletePath.exec(pathname)
    if (deleted) {
      if (request.method !== 'DELETE') return methodNotAllowed('DELETE')
      await env.FILES.delete(deleted[1])
      return new Response(null, { status: 204 })
    }
    if (pathname === '/admin') return Response.redirect(url.origin + '/admin/', 308)
    if (['/admin/', '/admin/app.js', '/admin/style.css'].includes(pathname)) {
      if (!['GET', 'HEAD'].includes(request.method)) return methodNotAllowed('GET, HEAD')
      return env.ASSETS.fetch(request)
    }
  }
  return new Response(null, { status: 404 })
}

export default {
  async fetch(request, env) {
    try {
      const response = await route(request, env)
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status })
      console.error('Publicus request failed', error.name)
      return Response.json({ error: 'Request failed' }, { status: 500 })
    }
  },
}
