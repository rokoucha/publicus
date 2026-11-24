import { createRemoteJWKSet, jwtVerify } from 'jose'

const keySets = new Map()

export async function authorized(request, env, audience) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token || !audience || !env.ACCESS_ISSUER) return false

  const issuer = env.ACCESS_ISSUER.replace(/\/$/, '')
  if (!keySets.has(issuer)) {
    keySets.set(issuer, createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer)))
  }
  try {
    await jwtVerify(token, keySets.get(issuer), {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp'],
    })
    return true
  } catch {
    return false
  }
}
