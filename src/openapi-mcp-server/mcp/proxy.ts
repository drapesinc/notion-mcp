import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  JSONRPCResponse,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js'
import { JSONSchema7 as IJsonSchema } from 'json-schema'
import { OpenAPIToMCPConverter } from '../openapi/parser'
import { HttpClient, HttpClientError } from '../client/http-client'
import { OpenAPIV3 } from 'openapi-types'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { loadToolsetConfig, isApiOperationEnabled, isCustomToolEnabled, describeConfig } from '../../toolset-config'
import {
  loadWorkspaceConfig,
  getWorkspace,
  getWorkspaceHeaders,
  isMultiWorkspaceMode,
  getAvailableWorkspaces,
  describeWorkspaceConfig,
  type MultiWorkspaceConfig,
  type WorkspaceConfig
} from '../../workspace-config'
import { getPromptsList, getPromptByName } from '../../workflow-prompts'
import { getStaticResources, getResourceTemplates, readResource } from '../../workflow-resources'

type PathItemObject = OpenAPIV3.PathItemObject & {
  get?: OpenAPIV3.OperationObject
  put?: OpenAPIV3.OperationObject
  post?: OpenAPIV3.OperationObject
  delete?: OpenAPIV3.OperationObject
  patch?: OpenAPIV3.OperationObject
}

type NewToolDefinition = {
  methods: Array<{
    name: string
    description: string
    inputSchema: IJsonSchema & { type: 'object' }
    returnSchema?: IJsonSchema
  }>
}

// Custom tool interface
export interface CustomToolHandler {
  (params: Record<string, any>, httpClient: HttpClient): Promise<any>
}

export interface CustomTool {
  definition: Tool
  handler: CustomToolHandler
}

/**
 * Recursively deserialize stringified JSON values in parameters.
 * This handles the case where MCP clients (like Cursor, Claude Code) double-serialize
 * nested object parameters, sending them as JSON strings instead of objects.
 *
 * @see https://github.com/makenotion/notion-mcp-server/issues/176
 */
function deserializeParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      // Check if the string looks like a JSON object or array
      const trimmed = value.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(value)
          // Only use parsed value if it's an object or array
          if (typeof parsed === 'object' && parsed !== null) {
            // Recursively deserialize nested objects
            result[key] = Array.isArray(parsed)
              ? parsed
              : deserializeParams(parsed as Record<string, unknown>)
            continue
          }
        } catch {
          // If parsing fails, keep the original string value
        }
      }
    }
    result[key] = value
  }

  return result
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClients: Map<string, HttpClient> = new Map()
  private workspaceConfig: MultiWorkspaceConfig
  private tools: Record<string, NewToolDefinition>
  private openApiLookup: Record<string, OpenAPIV3.OperationObject & { method: string; path: string }>
  private customTools: Map<string, CustomTool> = new Map()
  private toolsetConfig: ReturnType<typeof loadToolsetConfig>
  private openApiSpec: OpenAPIV3.Document

  constructor(name: string, openApiSpec: OpenAPIV3.Document) {
    this.server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {}, prompts: {}, resources: {} } })
    this.openApiSpec = openApiSpec

    const baseUrl = openApiSpec.servers?.[0].url
    if (!baseUrl) {
      throw new Error('No base URL found in OpenAPI spec')
    }

    // Load workspace configuration
    this.workspaceConfig = loadWorkspaceConfig()
    console.error(describeWorkspaceConfig(this.workspaceConfig))

    // Create HttpClient for each workspace
    for (const [workspaceName, workspace] of this.workspaceConfig.workspaces) {
      const client = new HttpClient(
        {
          baseUrl,
          headers: getWorkspaceHeaders(workspace),
        },
        openApiSpec,
      )
      this.httpClients.set(workspaceName, client)
    }

    // Fallback: if no workspaces configured, try legacy env vars
    if (this.httpClients.size === 0) {
      const legacyHeaders = this.parseHeadersFromEnv()
      if (Object.keys(legacyHeaders).length > 0) {
        const client = new HttpClient({ baseUrl, headers: legacyHeaders }, openApiSpec)
        this.httpClients.set('default', client)
        this.workspaceConfig.defaultWorkspace = 'default'
        this.workspaceConfig.workspaces.set('default', {
          name: 'default',
          token: '',
          envVar: 'OPENAPI_MCP_HEADERS'
        })
      }
    }

    if (this.httpClients.size === 0) {
      console.error('Warning: No Notion tokens configured. Set NOTION_TOKEN or NOTION_TOKEN_* env vars.')
    }

    // Load toolset configuration
    this.toolsetConfig = loadToolsetConfig()
    console.error(describeConfig(this.toolsetConfig))

    // Convert OpenAPI spec to MCP tools
    const converter = new OpenAPIToMCPConverter(openApiSpec)
    const { tools, openApiLookup } = converter.convertToMCPTools()
    this.tools = tools
    this.openApiLookup = openApiLookup

    this.setupHandlers()
  }

  /**
   * Get HttpClient for a workspace
   * Falls back to default workspace if not specified
   */
  private getHttpClient(workspaceName?: string): HttpClient | null {
    const workspace = getWorkspace(this.workspaceConfig, workspaceName)
    if (!workspace) return null
    return this.httpClients.get(workspace.name) || null
  }

  // Register custom tools
  registerCustomTools(tools: CustomTool[]) {
    for (const tool of tools) {
      this.customTools.set(tool.definition.name, tool)
    }
  }

  /**
   * Add workspace parameter to a tool's input schema when in multi-workspace mode
   */
  private addWorkspaceParam(inputSchema: Tool['inputSchema']): Tool['inputSchema'] {
    if (!isMultiWorkspaceMode(this.workspaceConfig)) {
      return inputSchema
    }

    const workspaces = getAvailableWorkspaces(this.workspaceConfig)
    const defaultWs = this.workspaceConfig.defaultWorkspace

    return {
      ...inputSchema,
      properties: {
        workspace: {
          type: 'string',
          description: `Workspace to use. Available: ${workspaces.join(', ')}${defaultWs ? `. Default: ${defaultWs}` : ''}`,
          enum: workspaces,
        },
        ...(inputSchema.properties || {}),
      },
    }
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = []

      // Add methods as separate tools to match the MCP format
      // Filter based on toolset configuration
      Object.entries(this.tools).forEach(([toolName, def]) => {
        def.methods.forEach(method => {
          // Check if this API operation is enabled
          // The method.name is the operationId from OpenAPI spec
          if (!isApiOperationEnabled(method.name, this.toolsetConfig)) {
            return // Skip disabled operations
          }

          const toolNameWithMethod = `${toolName}-${method.name}`;
          const truncatedToolName = this.truncateToolName(toolNameWithMethod);

          // Look up the HTTP method to determine annotations
          const operation = this.openApiLookup[toolNameWithMethod];
          const httpMethod = operation?.method?.toLowerCase();
          const isReadOnly = httpMethod === 'get';

          tools.push({
            name: truncatedToolName,
            description: method.description,
            inputSchema: this.addWorkspaceParam(method.inputSchema as Tool['inputSchema']),
            annotations: {
              title: this.operationIdToTitle(method.name),
              ...(isReadOnly
                ? { readOnlyHint: true }
                : { destructiveHint: true }),
            },
          })
        })
      })

      // Add custom tools (filtered by config)
      for (const [toolName, customTool] of this.customTools) {
        if (isCustomToolEnabled(toolName, this.toolsetConfig)) {
          tools.push({
            ...customTool.definition,
            inputSchema: this.addWorkspaceParam(customTool.definition.inputSchema),
          })
        }
      }

      return { tools }
    })

    // Handle tool calling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawParams } = request.params

      // Deserialize any stringified JSON parameters (fixes double-serialization bug)
      // See: https://github.com/makenotion/notion-mcp-server/issues/176
      const deserializedRawParams = rawParams ? deserializeParams(rawParams as Record<string, unknown>) : {}

      // Extract workspace from params and get the correct HttpClient
      const { workspace, ...params } = deserializedRawParams as { workspace?: string; [key: string]: unknown }
      const httpClient = this.getHttpClient(workspace)

      if (!httpClient) {
        const available = getAvailableWorkspaces(this.workspaceConfig)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: workspace
                  ? `Workspace '${workspace}' not found. Available: ${available.join(', ')}`
                  : `No workspace configured. Set NOTION_TOKEN or NOTION_TOKEN_* env vars. Available: ${available.join(', ') || 'none'}`,
              }),
            },
          ],
        }
      }

      // Check if it's a custom tool first
      const customTool = this.customTools.get(name)
      if (customTool) {
        // Verify the custom tool is enabled
        if (!isCustomToolEnabled(name, this.toolsetConfig)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  message: `Tool '${name}' is not enabled in the current toolset configuration (mode: ${this.toolsetConfig.mode})`,
                }),
              },
            ],
          }
        }

        try {
          const result = await customTool.handler(params || {}, httpClient)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          }
        } catch (error: any) {
          console.error('Error in custom tool call', error)
          const errorResponse: any = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          }
          // Include detailed error data from Notion API if available
          if (error.data) {
            errorResponse.details = error.data
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(errorResponse),
              },
            ],
          }
        }
      }

      // Find the operation in OpenAPI spec
      const operation = this.findOperation(name)
      if (!operation) {
        throw new Error(`Method ${name} not found`)
      }

      // Verify the API operation is enabled
      const operationId = operation.operationId || name
      if (!isApiOperationEnabled(operationId, this.toolsetConfig)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: `API operation '${operationId}' is not enabled in the current toolset configuration (mode: ${this.toolsetConfig.mode})`,
              }),
            },
          ],
        }
      }

      try {
        // Execute the operation using the workspace-specific client
        const response = await httpClient.executeOperation(operation, params)

        // Convert response to MCP format
        return {
          content: [
            {
              type: 'text', // currently this is the only type that seems to be used by mcp server
              text: JSON.stringify(response.data), // TODO: pass through the http status code text?
            },
          ],
        }
      } catch (error) {
        console.error('Error in tool call', error)
        if (error instanceof HttpClientError) {
          console.error('HttpClientError encountered, returning structured error', error)
          const data = error.data?.response?.data ?? error.data ?? {}
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error', // TODO: get this from http status code?
                  ...(typeof data === 'object' ? data : { data: data }),
                }),
              },
            ],
          }
        }
        throw error
      }
    })

    // Handle prompts listing
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return { prompts: getPromptsList() }
    })

    // Handle getting a specific prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const workflowPrompt = getPromptByName(name)

      if (!workflowPrompt) {
        throw new Error(`Prompt '${name}' not found`)
      }

      return {
        description: workflowPrompt.prompt.description,
        messages: workflowPrompt.getMessages(args || {})
      }
    })

    // Handle resources listing
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return { resources: getStaticResources() }
    })

    // Handle resource templates listing
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return { resourceTemplates: getResourceTemplates() }
    })

    // Handle reading a resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params
      return readResource(uri)
    })
  }

  private findOperation(operationId: string): (OpenAPIV3.OperationObject & { method: string; path: string }) | null {
    return this.openApiLookup[operationId] ?? null
  }

  private parseHeadersFromEnv(): Record<string, string> {
    // First try OPENAPI_MCP_HEADERS (existing behavior)
    const headersJson = process.env.OPENAPI_MCP_HEADERS
    if (headersJson) {
      try {
        const headers = JSON.parse(headersJson)
        if (typeof headers !== 'object' || headers === null) {
          console.warn('OPENAPI_MCP_HEADERS environment variable must be a JSON object, got:', typeof headers)
        } else if (Object.keys(headers).length > 0) {
          // Only use OPENAPI_MCP_HEADERS if it contains actual headers
          return headers
        }
        // If OPENAPI_MCP_HEADERS is empty object, fall through to try NOTION_TOKEN
      } catch (error) {
        console.warn('Failed to parse OPENAPI_MCP_HEADERS environment variable:', error)
        // Fall through to try NOTION_TOKEN
      }
    }

    // Alternative: try NOTION_TOKEN
    const notionToken = process.env.NOTION_TOKEN
    if (notionToken) {
      return {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2025-09-03'
      }
    }

    return {}
  }

  private getContentType(headers: Headers): 'text' | 'image' | 'binary' {
    const contentType = headers.get('content-type')
    if (!contentType) return 'binary'

    if (contentType.includes('text') || contentType.includes('json')) {
      return 'text'
    } else if (contentType.includes('image')) {
      return 'image'
    }
    return 'binary'
  }

  private truncateToolName(name: string): string {
    if (name.length <= 64) {
      return name;
    }
    return name.slice(0, 64);
  }

  /**
   * Convert an operationId like "createDatabase" to a human-readable title like "Create Database"
   */
  private operationIdToTitle(operationId: string): string {
    // Split on camelCase boundaries and capitalize each word
    return operationId
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  async connect(transport: Transport) {
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
