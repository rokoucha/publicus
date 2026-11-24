import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { publish, readBody, RequestError } from './files.js'

const maxMessageBytes = 3 * 1024 * 1024

export async function handleMcp(request, env) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== env.PUBLIC_ORIGIN) return new Response(null, { status: 403 })

  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  }

  const server = new McpServer({ name: 'publicus', version: '0.1.0' })
  server.registerTool('publish', {
    description: 'Upload a file and return its shareable URL. Provide text or base64, up to 2 MiB after decoding.',
    inputSchema: {
      name: z.string().min(1).max(255),
      text: z.string().optional(),
      base64: z.string().optional(),
    },
  }, async ({ name, text, base64 }) => {
    try {
      if ((text === undefined) === (base64 === undefined)) {
        throw new RequestError(400, 'Provide exactly one of text or base64')
      }
      const bytes = text === undefined
        ? Uint8Array.from(atob(base64), character => character.charCodeAt(0))
        : new TextEncoder().encode(text)
      if (bytes.length > 2 * 1024 * 1024) throw new RequestError(413, 'File is too large')
      const file = await publish(env, name, bytes)
      return { content: [{ type: 'text', text: file.url }] }
    } catch (error) {
      const message = error instanceof RequestError ? error.message
        : error.name === 'InvalidCharacterError' ? 'Invalid base64' : 'Upload failed'
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  })

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  })
  const bytes = await readBody(request, maxMessageBytes)
  const boundedRequest = new Request(request, { body: bytes })
  await server.connect(transport)
  try {
    return await transport.handleRequest(boundedRequest)
  } finally {
    await server.close()
  }
}
