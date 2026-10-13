import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { OAuthResource, TokenError, oauthConfigFromEnv } from './oauth-resource'

const issuer = 'https://auth.example.com/application/o/notion-mcp/'
const audience = 'claude-notion'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }

const fixedNow = 1_800_000_000_000
const nowS = Math.floor(fixedNow / 1000)

function fakeFetch(url: string) {
  const body =
    url === `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
      ? { issuer, jwks_uri: 'https://auth.example.com/jwks', authorization_endpoint: 'https://auth.example.com/authorize' }
      : url === 'https://auth.example.com/jwks'
        ? { keys: [jwk] }
        : undefined
  return Promise.resolve({ ok: Boolean(body), status: body ? 200 : 404, json: () => Promise.resolve(body) })
}

function makeToken(claims: Record<string, unknown>, kid = 'k1', alg = 'RS256') {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg, kid, typ: 'JWT' })
  const body = enc(claims)
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')
  return `${head}.${body}.${sig}`
}

const resource = () =>
  new OAuthResource({ issuer, audience, publicUrl: 'https://notion.example.com', scopes: ['openid'] }, fakeFetch, () => fixedNow)

const good = { iss: issuer, aud: audience, exp: nowS + 600, sub: 'u1', preferred_username: 'yaw' }

describe('OAuth resource server', () => {
  it('accepts a valid token', async () => {
    await expect(resource().verify(makeToken(good))).resolves.toMatchObject({ sub: 'u1' })
  })

  it('rejects expired, wrong-audience and wrong-issuer tokens', async () => {
    const r = resource()
    await expect(r.verify(makeToken({ ...good, exp: nowS - 3600 }))).rejects.toThrow('expired')
    await expect(r.verify(makeToken({ ...good, aud: 'other' }))).rejects.toThrow('audience')
    await expect(r.verify(makeToken({ ...good, iss: 'https://evil/' }))).rejects.toThrow('issuer')
  })

  it('rejects a tampered token and HS256 tokens', async () => {
    const r = resource()
    const [h, , s] = makeToken(good).split('.')
    const forged = Buffer.from(JSON.stringify({ ...good, sub: 'admin' })).toString('base64url')
    await expect(r.verify(`${h}.${forged}.${s}`)).rejects.toThrow('signature')
    await expect(r.verify(makeToken(good, 'k1', 'HS256'))).rejects.toBeInstanceOf(TokenError)
  })

  it('rejects an unknown signing key', async () => {
    await expect(resource().verify(makeToken(good, 'rotated'))).rejects.toThrow('unknown key')
  })

  it('publishes protected resource metadata pointing at the issuer', () => {
    expect(resource().protectedResourceMetadata()).toMatchObject({
      resource: 'https://notion.example.com/mcp',
      authorization_servers: [issuer],
    })
  })

  it('reads its config from env and requires audience and public URL', () => {
    expect(oauthConfigFromEnv({})).toBeUndefined()
    expect(() => oauthConfigFromEnv({ OAUTH_ISSUER: issuer })).toThrow()
    expect(
      oauthConfigFromEnv({ OAUTH_ISSUER: issuer, OAUTH_AUDIENCE: audience, PUBLIC_URL: 'https://n.example.com/' }),
    ).toMatchObject({ publicUrl: 'https://n.example.com', scopes: ['openid', 'profile', 'email', 'offline_access'] })
  })
})
