import { OpenAPIV3 } from 'openapi-types'
import { HttpClient } from '../../client/http-client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

// Mock the dependencies
vi.mock('../../client/http-client')
vi.mock('@modelcontextprotocol/sdk/server/index.js')

// Use vi.hoisted to ensure mock functions are available during module loading
const {
  mockLoadWorkspaceConfig,
  mockGetWorkspace,
  mockGetWorkspaceHeaders,
  mockIsMultiWorkspaceMode,
  mockGetAvailableWorkspaces,
  mockDescribeWorkspaceConfig,
  mockLoadToolsetConfig,
  mockIsApiOperationEnabled,
  mockIsCustomToolEnabled,
  mockDescribeConfig,
} = vi.hoisted(() => ({
  mockLoadWorkspaceConfig: vi.fn(),
  mockGetWorkspace: vi.fn(),
  mockGetWorkspaceHeaders: vi.fn(),
  mockIsMultiWorkspaceMode: vi.fn(),
  mockGetAvailableWorkspaces: vi.fn(),
  mockDescribeWorkspaceConfig: vi.fn(),
  mockLoadToolsetConfig: vi.fn(),
  mockIsApiOperationEnabled: vi.fn(),
  mockIsCustomToolEnabled: vi.fn(),
  mockDescribeConfig: vi.fn(),
}))

// Mock paths resolved relative to this test file
// From __tests__/proxy.test.ts -> ../../ goes to openapi-mcp-server, then ../../../ goes to src
vi.mock('../../../workspace-config', () => ({
  loadWorkspaceConfig: mockLoadWorkspaceConfig,
  getWorkspace: mockGetWorkspace,
  getWorkspaceHeaders: mockGetWorkspaceHeaders,
  isMultiWorkspaceMode: mockIsMultiWorkspaceMode,
  getAvailableWorkspaces: mockGetAvailableWorkspaces,
  describeWorkspaceConfig: mockDescribeWorkspaceConfig,
}))

vi.mock('../../../toolset-config', () => ({
  loadToolsetConfig: mockLoadToolsetConfig,
  isApiOperationEnabled: mockIsApiOperationEnabled,
  isCustomToolEnabled: mockIsCustomToolEnabled,
  describeConfig: mockDescribeConfig,
}))

import { MCPProxy } from '../proxy'

describe('MCPProxy', () => {
  let proxy: MCPProxy
  let mockOpenApiSpec: OpenAPIV3.Document
  const originalEnv = process.env

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Set up default mock implementations - empty workspace (no tokens)
    mockLoadWorkspaceConfig.mockReturnValue({
      workspaces: new Map(),
      defaultWorkspace: null,
    })
    mockGetWorkspace.mockReturnValue(null)
    mockGetWorkspaceHeaders.mockReturnValue({})
    mockIsMultiWorkspaceMode.mockReturnValue(false)
    mockGetAvailableWorkspaces.mockReturnValue([])
    mockDescribeWorkspaceConfig.mockReturnValue('Workspace config: none')

    mockLoadToolsetConfig.mockReturnValue({
      enabled: true,
      mode: 'standard',
      apiOperations: { enabled: true, allowlist: [], blocklist: [] },
      customTools: { enabled: true, allowlist: [], blocklist: [] },
    })
    mockIsApiOperationEnabled.mockReturnValue(true)
    mockIsCustomToolEnabled.mockReturnValue(true)
    mockDescribeConfig.mockReturnValue('Toolset config: all enabled')

    // Reset env - create clean env without any Notion-related vars
    const cleanEnv: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(originalEnv)) {
      if (!key.startsWith('NOTION_') && !key.startsWith('OPENAPI_MCP')) {
        cleanEnv[key] = value
      }
    }
    process.env = cleanEnv

    // Setup minimal OpenAPI spec for testing
    mockOpenApiSpec = {
      openapi: '3.0.0',
      servers: [{ url: 'http://localhost:3000' }],
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create proxy without throwing when no tokens configured', () => {
      expect(() => new MCPProxy('test-proxy', mockOpenApiSpec)).not.toThrow()
    })

    it('should throw when no base URL in OpenAPI spec', () => {
      const noServerSpec = { ...mockOpenApiSpec, servers: undefined }
      expect(() => new MCPProxy('test-proxy', noServerSpec)).toThrow('No base URL found in OpenAPI spec')
    })
  })

  describe('listTools handler', () => {
    it('should return converted tools from OpenAPI spec', async () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      const server = (proxy as any).server
      const listToolsHandler = server.setRequestHandler.mock.calls[0].filter((x: unknown) => typeof x === 'function')[0]
      const result = await listToolsHandler()

      expect(result).toHaveProperty('tools')
      expect(Array.isArray(result.tools)).toBe(true)
    })

    it('should truncate tool names exceeding 64 characters', async () => {
      mockOpenApiSpec.paths = {
        '/test': {
          get: {
            operationId: 'a'.repeat(65),
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      }
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      const server = (proxy as any).server
      const listToolsHandler = server.setRequestHandler.mock.calls[0].filter((x: unknown) => typeof x === 'function')[0]
      const result = await listToolsHandler()

      // When tools are generated, names should be truncated
      if (result.tools && result.tools.length > 0) {
        expect(result.tools[0].name.length).toBeLessThanOrEqual(64)
      }
    })
  })

  describe('callTool handler', () => {
    beforeEach(() => {
      // Set up a workspace for callTool tests
      const testWorkspace = { name: 'default', token: 'test-token', envVar: 'NOTION_TOKEN' }
      mockLoadWorkspaceConfig.mockReturnValue({
        workspaces: new Map([['default', testWorkspace]]),
        defaultWorkspace: 'default',
      })
      mockGetWorkspace.mockReturnValue(testWorkspace)
      mockGetWorkspaceHeaders.mockReturnValue({
        'Authorization': 'Bearer test-token',
        'Notion-Version': '2025-09-03'
      })
    })

    it('should execute operation and return formatted response', async () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      const mockResponse = {
        data: { message: 'success' },
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
      }
      ;(HttpClient.prototype.executeOperation as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      ;(proxy as any).openApiLookup = {
        'API-getTest': {
          operationId: 'getTest',
          responses: { '200': { description: 'Success' } },
          method: 'get',
          path: '/test',
        },
      }

      const server = (proxy as any).server
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function')
      const callToolHandler = handlers[1]

      const result = await callToolHandler({
        params: {
          name: 'API-getTest',
          arguments: {},
        },
      })

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'success' }),
          },
        ],
      })
    })

    it('should throw error for non-existent operation', async () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      const server = (proxy as any).server
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function')
      const callToolHandler = handlers[1]

      // Non-existent method throws an error
      await expect(callToolHandler({
        params: {
          name: 'nonExistentMethod',
          arguments: {},
        },
      })).rejects.toThrow('Method nonExistentMethod not found')
    })

    it('should handle tool names exceeding 64 characters', async () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      const mockResponse = {
        data: { message: 'success' },
        status: 200,
        headers: new Headers({
          'content-type': 'application/json'
        })
      };
      (HttpClient.prototype.executeOperation as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const longToolName = 'a'.repeat(65)
      const truncatedToolName = longToolName.slice(0, 64)
      ;(proxy as any).openApiLookup = {
        [truncatedToolName]: {
          operationId: longToolName,
          responses: { '200': { description: 'Success' } },
          method: 'get',
          path: '/test'
        }
      }

      const server = (proxy as any).server
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function')
      const callToolHandler = handlers[1]

      const result = await callToolHandler({
        params: {
          name: truncatedToolName,
          arguments: {}
        }
      })

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'success' })
          }
        ]
      })
    })
  })

  describe('getContentType', () => {
    it('should return correct content type for different headers', () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      const getContentType = (proxy as any).getContentType.bind(proxy)

      expect(getContentType(new Headers({ 'content-type': 'text/plain' }))).toBe('text')
      expect(getContentType(new Headers({ 'content-type': 'application/json' }))).toBe('text')
      expect(getContentType(new Headers({ 'content-type': 'image/jpeg' }))).toBe('image')
      expect(getContentType(new Headers({ 'content-type': 'application/octet-stream' }))).toBe('binary')
      expect(getContentType(new Headers())).toBe('binary')
    })
  })

  describe('parseHeadersFromEnv (legacy fallback)', () => {
    it('should parse valid JSON headers from OPENAPI_MCP_HEADERS', () => {
      process.env.OPENAPI_MCP_HEADERS = JSON.stringify({
        Authorization: 'Bearer token123',
        'X-Custom-Header': 'test',
      })

      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer token123',
            'X-Custom-Header': 'test',
          },
        }),
        expect.anything(),
      )
    })

    it('should not create HttpClient when no env vars are set', () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).not.toHaveBeenCalled()
    })

    it('should warn on invalid JSON in OPENAPI_MCP_HEADERS', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.OPENAPI_MCP_HEADERS = 'invalid json'

      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      expect(consoleSpy).toHaveBeenCalledWith('Failed to parse OPENAPI_MCP_HEADERS environment variable:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it('should warn on non-object JSON in OPENAPI_MCP_HEADERS', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.OPENAPI_MCP_HEADERS = '"string"'

      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      expect(consoleSpy).toHaveBeenCalledWith('OPENAPI_MCP_HEADERS environment variable must be a JSON object, got:', 'string')
      consoleSpy.mockRestore()
    })

    it('should use NOTION_TOKEN when OPENAPI_MCP_HEADERS is not set', () => {
      process.env.NOTION_TOKEN = 'ntn_test_token_123'

      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer ntn_test_token_123',
            'Notion-Version': '2025-09-03'
          },
        }),
        expect.anything(),
      )
    })

    it('should use NOTION_TOKEN when OPENAPI_MCP_HEADERS is empty object', () => {
      process.env.OPENAPI_MCP_HEADERS = '{}'
      process.env.NOTION_TOKEN = 'ntn_test_token_123'

      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer ntn_test_token_123',
            'Notion-Version': '2025-09-03'
          },
        }),
        expect.anything(),
      )
    })

    // Note: When NOTION_TOKEN is set, workspace config uses it directly,
    // OPENAPI_MCP_HEADERS is only a fallback when no workspace tokens exist
    it('should use OPENAPI_MCP_HEADERS only when NOTION_TOKEN is not set', () => {
      process.env.OPENAPI_MCP_HEADERS = JSON.stringify({
        Authorization: 'Bearer custom_token',
        'Custom-Header': 'custom_value',
      })
      // No NOTION_TOKEN set

      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)

      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer custom_token',
            'Custom-Header': 'custom_value',
          },
        }),
        expect.anything(),
      )
    })
  })

  describe('connect', () => {
    it('should connect to transport', async () => {
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      const mockTransport = {} as Transport
      await proxy.connect(mockTransport)

      const server = (proxy as any).server
      expect(server.connect).toHaveBeenCalledWith(mockTransport)
    })
  })
})
