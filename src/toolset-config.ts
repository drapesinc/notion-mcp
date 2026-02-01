/**
 * Toolset Configuration System
 *
 * Controls which tools are available based on environment configuration.
 *
 * Environment Variables:
 * - NOTION_TOOLSET_MODE: 'full' | 'standard' | 'minimal' | 'custom'
 * - NOTION_TOOLSETS: Comma-separated list of toolset names (when mode is 'custom')
 *
 * Example configurations in .claude.json:
 *
 * Full mode (all tools):
 * {
 *   "env": {
 *     "NOTION_TOKEN": "...",
 *     "NOTION_TOOLSET_MODE": "full"
 *   }
 * }
 *
 * Minimal mode (just core CRUD):
 * {
 *   "env": {
 *     "NOTION_TOKEN": "...",
 *     "NOTION_TOOLSET_MODE": "minimal"
 *   }
 * }
 *
 * Custom toolsets:
 * {
 *   "env": {
 *     "NOTION_TOKEN": "...",
 *     "NOTION_TOOLSET_MODE": "custom",
 *     "NOTION_TOOLSETS": "core,workflow,blocks"
 *   }
 * }
 */

export type ToolsetName =
  | 'core'      // Basic CRUD: pages, databases, search, blocks read
  | 'unified'   // 6 unified CRUD tools: notion-page, notion-blocks, notion-database, etc.
  | 'blocks'    // Block writing: all block types for appending content
  | 'workflow'  // Custom workflow tools: create-task, activity-log, etc.
  | 'templates' // Template operations: list and create pages from templates
  | 'media'     // Media blocks: image, video, file, pdf, embed, bookmark
  | 'advanced'  // Advanced blocks: tables, columns, equations, TOC
  | 'comments'  // Comments API
  | 'users'     // Users API

export type ToolsetMode = 'full' | 'standard' | 'minimal' | 'custom'

// Define which API operations belong to each toolset
export const TOOLSET_DEFINITIONS: Record<ToolsetName, {
  description: string
  apiOperations: string[]  // OpenAPI operation IDs
  customTools: string[]    // Custom tool names
}> = {
  core: {
    description: 'Basic CRUD operations - pages, databases, search, reading blocks',
    apiOperations: [
      'post-search',
      'retrieve-a-page',
      'patch-page',
      'post-page',
      'retrieve-a-data-source',  // v2.0.0: renamed from retrieve-a-database
      'query-data-source',       // v2.0.0: renamed from post-database-query
      'get-block-children',
      'retrieve-a-block',
      'delete-a-block',
      'update-a-block',
      'retrieve-a-page-property',
    ],
    customTools: [
      'get-toolset-info',
    ]
  },
  unified: {
    description: '6 unified CRUD tools - consolidated action-based tools for pages, blocks, databases, search, comments, users',
    apiOperations: [],
    customTools: [
      'notion-page',
      'notion-blocks',
      'notion-database',
      'notion-search',
      'notion-comments',
      'notion-users',
    ]
  },
  blocks: {
    description: 'Block writing - raw API for appending blocks (use unified tools instead)',
    apiOperations: [
      'patch-block-children',
    ],
    customTools: []
  },
  workflow: {
    description: 'Legacy workflow tools (deprecated - use unified tools instead)',
    apiOperations: [],
    customTools: []
  },
  templates: {
    description: 'Template operations - list database templates (requires Notion API 2025-09-03+)',
    apiOperations: [
      'list-data-source-templates',  // v2.0.0: renamed from list-templates
    ],
    customTools: []
  },
  media: {
    description: 'Media operations - images, videos, files, embeds, bookmarks',
    apiOperations: [],
    customTools: [
      'add-media-block',
      'add-bookmark',
      'add-embed',
    ]
  },
  advanced: {
    description: 'Advanced blocks - tables, columns, equations, table of contents',
    apiOperations: [],
    customTools: [
      'create-table',
      'add-equation',
      'add-columns',
    ]
  },
  comments: {
    description: 'Comments API - read and create comments',
    apiOperations: [
      'retrieve-a-comment',
      'create-a-comment',
    ],
    customTools: []
  },
  users: {
    description: 'Users API - list and retrieve users',
    apiOperations: [
      'get-users',
      'get-user',
      'get-self',
    ],
    customTools: []
  }
}

// Predefined mode configurations
export const MODE_TOOLSETS: Record<ToolsetMode, ToolsetName[]> = {
  full: ['core', 'unified', 'blocks', 'workflow', 'templates', 'media', 'advanced', 'comments', 'users'],
  standard: ['unified'],
  minimal: ['unified'],
  custom: [] // Determined by NOTION_TOOLSETS env var
}

/**
 * Load toolset configuration from environment
 */
export function loadToolsetConfig(): {
  mode: ToolsetMode
  enabledToolsets: ToolsetName[]
  enabledApiOperations: Set<string>
  enabledCustomTools: Set<string>
} {
  const mode = (process.env.NOTION_TOOLSET_MODE as ToolsetMode) || 'standard'

  let enabledToolsets: ToolsetName[]

  if (mode === 'custom') {
    const toolsetsEnv = process.env.NOTION_TOOLSETS || ''
    enabledToolsets = toolsetsEnv
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s in TOOLSET_DEFINITIONS) as ToolsetName[]

    // Always include core
    if (!enabledToolsets.includes('core')) {
      enabledToolsets.unshift('core')
    }
  } else {
    enabledToolsets = MODE_TOOLSETS[mode] || MODE_TOOLSETS.standard
  }

  // Collect all enabled operations and tools
  const enabledApiOperations = new Set<string>()
  const enabledCustomTools = new Set<string>()

  for (const toolsetName of enabledToolsets) {
    const toolset = TOOLSET_DEFINITIONS[toolsetName]
    if (toolset) {
      toolset.apiOperations.forEach(op => enabledApiOperations.add(op))
      toolset.customTools.forEach(tool => enabledCustomTools.add(tool))
    }
  }

  return {
    mode,
    enabledToolsets,
    enabledApiOperations,
    enabledCustomTools
  }
}

/**
 * Check if an API operation is enabled
 */
export function isApiOperationEnabled(operationId: string, config: ReturnType<typeof loadToolsetConfig>): boolean {
  return config.enabledApiOperations.has(operationId)
}

/**
 * Check if a custom tool is enabled
 */
export function isCustomToolEnabled(toolName: string, config: ReturnType<typeof loadToolsetConfig>): boolean {
  return config.enabledCustomTools.has(toolName)
}

/**
 * Get a description of the current configuration for logging
 */
export function describeConfig(config: ReturnType<typeof loadToolsetConfig>): string {
  return `Notion MCP Toolset Mode: ${config.mode}\n` +
    `Enabled Toolsets: ${config.enabledToolsets.join(', ')}\n` +
    `API Operations: ${config.enabledApiOperations.size}\n` +
    `Custom Tools: ${config.enabledCustomTools.size}`
}
