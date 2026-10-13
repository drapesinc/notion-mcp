import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto'
import type express from 'express'

// OAuth 2.1 resource-server mode for the HTTP transport.
//
// The server does not issue tokens. An external authorization server (Authentik
// in the Drapes setup) logs the user in and issues a signed JWT access token;
// this module checks that token on every /mcp request and publishes the
// metadata MCP clients (claude.ai custom connectors) use to find the login page:
//   - /.well-known/oauth-protected-resource      (RFC 9728)
//   - /.well-known/oauth-authorization-server    (RFC 8414 mirror of the issuer's
//     metadata, for clients that only look on the MCP server's own origin)
// Access control (who may sign in) is enforced by the authorization server.

export type OAuthConfig = {
  issuer: string
  audience: string
  publicUrl: string
  scopes: string[]
}

type IssuerMetadata = Record<string, unknown> & {
  issuer: string
  jwks_uri: string
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string }

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const SUPPORTED_ALGS: Record<string, { hash: string; dsaEncoding?: 'ieee-p1363' }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
  ES384: { hash: 'sha384', dsaEncoding: 'ieee-p1363' },
  ES512: { hash: 'sha512', dsaEncoding: 'ieee-p1363' },
}

const METADATA_TTL_MS = 60 * 60 * 1000
const CLOCK_SKEW_S = 60

export class TokenError extends Error {}

export function oauthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig | undefined {
  const issuer = env.OAUTH_ISSUER
  if (!issuer) return undefined
  const audience = env.OAUTH_AUDIENCE
  const publicUrl = env.PUBLIC_URL
  if (!audience || !publicUrl) {
    throw new Error('OAUTH_ISSUER is set, so OAUTH_AUDIENCE and PUBLIC_URL are required too')
  }
  const scopes = (env.OAUTH_SCOPES ?? 'openid profile email offline_access').split(/[\s,]+/).filter(Boolean)
  return { issuer, audience, publicUrl: publicUrl.replace(/\/+$/, ''), scopes }
}

function issuerMetadataUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

function base64UrlDecode(part: string): Buffer {
  return Buffer.from(part, 'base64url')
}

export class OAuthResource {
  private metadata?: IssuerMetadata
  private metadataFetchedAt = 0
  private keys = new Map<string, KeyObject>()
  private keysFetchedAt = 0

  constructor(
    readonly config: OAuthConfig,
    private readonly fetchJson: FetchLike = (url) => fetch(url),
    private readonly now: () => number = () => Date.now(),
  ) {}

  get resourceUrl(): string {
    return `${this.config.publicUrl}/mcp`
  }

  get resourceMetadataUrl(): string {
    return `${this.config.publicUrl}/.well-known/oauth-protected-resource`
  }

  protectedResourceMetadata() {
    return {
      resource: this.resourceUrl,
      authorization_servers: [this.config.issuer],
      scopes_supported: this.config.scopes,
      bearer_methods_supported: ['header'],
      resource_name: 'Notion MCP (Drapes fork)',
    }
  }

  async issuerMetadata(): Promise<IssuerMetadata> {
    if (this.metadata && this.now() - this.metadataFetchedAt < METADATA_TTL_MS) {
      return this.metadata
    }
    const res = await this.fetchJson(issuerMetadataUrl(this.config.issuer))
    if (!res.ok) throw new Error(`issuer metadata returned HTTP ${res.status}`)
    const body = (await res.json()) as IssuerMetadata
    if (!body.jwks_uri || !body.issuer) throw new Error('issuer metadata has no jwks_uri or issuer')
    this.metadata = body
    this.metadataFetchedAt = this.now()
    return body
  }

  private async loadKeys(): Promise<void> {
    const { jwks_uri } = await this.issuerMetadata()
    const res = await this.fetchJson(jwks_uri)
    if (!res.ok) throw new Error(`JWKS returned HTTP ${res.status}`)
    const body = (await res.json()) as { keys?: Jwk[] }
    const keys = new Map<string, KeyObject>()
    for (const jwk of body.keys ?? []) {
      if (jwk.use && jwk.use !== 'sig') continue
      try {
        keys.set(jwk.kid ?? '', createPublicKey({ key: jwk, format: 'jwk' }))
      } catch {
        // Skip keys node cannot import (e.g. symmetric keys).
      }
    }
    this.keys = keys
    this.keysFetchedAt = this.now()
  }

  private async keyFor(kid: string): Promise<KeyObject> {
    let key = this.keys.get(kid)
    // Refetch on an unknown kid (key rotation), at most once every 30s.
    if (!key && this.now() - this.keysFetchedAt > 30_000) {
      await this.loadKeys()
      key = this.keys.get(kid)
    }
    if (!key && this.keys.size === 1 && !kid) key = [...this.keys.values()][0]
    if (!key) throw new TokenError('token signed with an unknown key')
    return key
  }

  /** Verifies signature, issuer, audience and expiry. Returns the claims. */
  async verify(token: string): Promise<Record<string, unknown>> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new TokenError('token is not a JWT')
    let header: { alg?: string; kid?: string }
    let claims: Record<string, unknown>
    try {
      header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'))
      claims = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'))
    } catch {
      throw new TokenError('token is not a valid JWT')
    }
    const alg = SUPPORTED_ALGS[header.alg ?? '']
    if (!alg) {
      throw new TokenError(`unsupported signing algorithm ${header.alg} (set an RSA or EC signing key on the provider)`)
    }
    const key = await this.keyFor(header.kid ?? '')
    const ok = verifySignature(
      alg.hash,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      alg.dsaEncoding ? { key, dsaEncoding: alg.dsaEncoding } : key,
      base64UrlDecode(parts[2]),
    )
    if (!ok) throw new TokenError('bad token signature')

    const { issuer } = await this.issuerMetadata()
    if (claims.iss !== issuer) throw new TokenError('token from the wrong issuer')
    const aud = claims.aud
    const audiences = Array.isArray(aud) ? aud : [aud]
    if (!audiences.includes(this.config.audience)) throw new TokenError('token for the wrong audience')
    const nowS = Math.floor(this.now() / 1000)
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) throw new TokenError('token expired')
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) throw new TokenError('token not yet valid')
    return claims
  }

  /** Mounts the well-known metadata routes on the app. */
  mountMetadata(app: express.Express): void {
    const prm = (_req: express.Request, res: express.Response) => {
      res.json(this.protectedResourceMetadata())
    }
    app.get('/.well-known/oauth-protected-resource', prm)
    app.get('/.well-known/oauth-protected-resource/mcp', prm)

    const asMetadata = async (_req: express.Request, res: express.Response) => {
      try {
        res.json(await this.issuerMetadata())
      } catch (error) {
        console.error('OAuth: could not load issuer metadata:', (error as Error).message)
        res.status(502).json({ error: 'issuer metadata unavailable' })
      }
    }
    app.get('/.well-known/oauth-authorization-server', asMetadata)
    app.get('/.well-known/openid-configuration', asMetadata)
  }

  /** Express middleware that requires a valid access token. */
  middleware(): express.RequestHandler {
    const challenge = (error?: string, description?: string) => {
      const parts = [`Bearer resource_metadata="${this.resourceMetadataUrl}"`]
      if (error) parts.push(`error="${error}"`)
      if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`)
      return parts.join(', ')
    }
    return async (req, res, next) => {
      const header = req.headers['authorization']
      const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
      if (!token) {
        res.set('WWW-Authenticate', challenge())
        res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: sign in required' }, id: null })
        return
      }
      try {
        const claims = await this.verify(token)
        res.locals.oauthSubject = claims.preferred_username ?? claims.email ?? claims.sub
        next()
      } catch (error) {
        if (error instanceof TokenError) {
          res.set('WWW-Authenticate', challenge('invalid_token', error.message))
          res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: `Unauthorized: ${error.message}` }, id: null })
          return
        }
        console.error('OAuth: token check failed:', (error as Error).message)
        res.status(503).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Sign-in server unavailable' }, id: null })
      }
    }
  }
}
