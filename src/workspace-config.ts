/**
 * Multi-workspace configuration for Notion MCP Server
 * Supports multiple Notion API tokens for different workspaces
 *
 * Dynamically discovers workspaces from NOTION_TOKEN_* environment variables
 */

export interface WorkspaceConfig {
  name: string
  token: string
  envVar: string
}

export interface MultiWorkspaceConfig {
  workspaces: Map<string, WorkspaceConfig>
  defaultWorkspace: string | null
}

/**
 * Load workspace configuration from environment variables
 *
 * Dynamically scans for NOTION_TOKEN_* env vars:
 * - NOTION_TOKEN_<NAME> → workspace "<name>" (lowercase)
 *
 * Also supports:
 * - NOTION_TOKEN (fallback for single-workspace mode, creates "default" workspace)
 * - NOTION_DEFAULT_WORKSPACE (sets the default, otherwise uses first found)
 */
export function loadWorkspaceConfig(): MultiWorkspaceConfig {
  const workspaces = new Map<string, WorkspaceConfig>()
  const tokenPrefix = 'NOTION_TOKEN_'

  // Scan all environment variables for NOTION_TOKEN_* pattern
  for (const [envVar, value] of Object.entries(process.env)) {
    if (envVar.startsWith(tokenPrefix) && value) {
      // Extract workspace name from env var (e.g., NOTION_TOKEN_WORK → work)
      const workspaceName = envVar.substring(tokenPrefix.length).toLowerCase()

      // Skip empty workspace names
      if (workspaceName) {
        workspaces.set(workspaceName, {
          name: workspaceName,
          token: value,
          envVar
        })
      }
    }
  }

  // Fallback: if no workspace-specific tokens, use NOTION_TOKEN as 'default'
  if (workspaces.size === 0) {
    const fallbackToken = process.env.NOTION_TOKEN
    if (fallbackToken) {
      workspaces.set('default', {
        name: 'default',
        token: fallbackToken,
        envVar: 'NOTION_TOKEN'
      })
    }
  }

  // Determine default workspace
  let defaultWorkspace: string | null = null
  const envDefault = process.env.NOTION_DEFAULT_WORKSPACE?.toLowerCase()

  if (envDefault && workspaces.has(envDefault)) {
    defaultWorkspace = envDefault
  } else if (workspaces.size > 0) {
    // Use first available workspace as default
    defaultWorkspace = workspaces.keys().next().value ?? null
  }

  return { workspaces, defaultWorkspace }
}

/**
 * Get a workspace configuration by name
 * Returns null if workspace not found
 */
export function getWorkspace(config: MultiWorkspaceConfig, name?: string): WorkspaceConfig | null {
  const workspaceName = name?.toLowerCase() || config.defaultWorkspace
  if (!workspaceName) return null
  return config.workspaces.get(workspaceName) || null
}

/**
 * Check if multi-workspace mode is enabled (more than one workspace configured)
 */
export function isMultiWorkspaceMode(config: MultiWorkspaceConfig): boolean {
  return config.workspaces.size > 1
}

/**
 * Get list of available workspace names
 */
export function getAvailableWorkspaces(config: MultiWorkspaceConfig): string[] {
  return Array.from(config.workspaces.keys())
}

/**
 * Generate headers for a workspace
 */
export function getWorkspaceHeaders(workspace: WorkspaceConfig): Record<string, string> {
  return {
    'Authorization': `Bearer ${workspace.token}`,
    'Notion-Version': '2022-06-28'
  }
}

/**
 * Describe the current workspace configuration (for logging)
 */
export function describeWorkspaceConfig(config: MultiWorkspaceConfig): string {
  const workspaceList = Array.from(config.workspaces.keys())

  if (workspaceList.length === 0) {
    return 'Workspace config: No workspaces configured (missing NOTION_TOKEN or NOTION_TOKEN_* env vars)'
  }

  if (workspaceList.length === 1 && workspaceList[0] === 'default') {
    return 'Workspace config: Single workspace mode (using NOTION_TOKEN)'
  }

  return `Workspace config: Multi-workspace mode\n` +
    `  Available: ${workspaceList.join(', ')}\n` +
    `  Default: ${config.defaultWorkspace || 'none'}`
}
