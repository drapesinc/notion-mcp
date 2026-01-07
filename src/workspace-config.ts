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
    'Notion-Version': '2025-09-03'
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

// ============================================================================
// Database ID Configuration
// ============================================================================

// Database and data_source IDs are configured via environment variables
// No hardcoded defaults - use scripts/notion-ids.sh to set them

/**
 * Get data_source ID from environment variable
 *
 * Environment variable pattern: NOTION_DS_{TYPE}_{WORKSPACE}
 * Examples:
 *   NOTION_DS_TASKS_PERSONAL=abc-123-def
 *   NOTION_DS_PROJECTS_FOURALL=ghi-456-jkl
 *
 * @param dbType - The type of database (e.g., 'tasks', 'projects')
 * @param workspace - The workspace name (e.g., 'personal', 'fourall')
 * @returns The data_source ID from env var, or null if not found
 */
export function getDataSourceId(dbType: string, workspace: string): string | null {
  const envVar = `NOTION_DS_${dbType.toUpperCase()}_${workspace.toUpperCase()}`
  return process.env[envVar] || null
}

/**
 * Get database ID from environment variable
 *
 * Environment variable pattern: NOTION_DB_{TYPE}_{WORKSPACE}
 * Examples:
 *   NOTION_DB_TASKS_PERSONAL=abc123
 *   NOTION_DB_TASKS_FOURALL=def456
 *   NOTION_DB_PROJECTS_PERSONAL=ghi789
 *
 * @param dbType - The type of database (e.g., 'tasks', 'projects')
 * @param workspace - The workspace name (e.g., 'personal', 'fourall')
 * @returns The database ID from env var, or null if not found
 */
export function getDatabaseId(dbType: string, workspace: string): string | null {
  const envVar = `NOTION_DB_${dbType.toUpperCase()}_${workspace.toUpperCase()}`
  return process.env[envVar] || null
}

/**
 * Get data_source ID with database ID fallback
 * Preferred method for 2025-09-03 API - tries data_source first, then database
 *
 * @param dbType - The type of database (e.g., 'tasks', 'projects')
 * @param workspace - The workspace name (e.g., 'personal', 'fourall')
 * @returns Object with dataSourceId (preferred) and databaseId (fallback)
 */
export function getDataSourceOrDatabaseId(dbType: string, workspace: string): {
  dataSourceId: string | null
  databaseId: string | null
  preferred: string | null
  type: 'data_source' | 'database' | null
} {
  const dataSourceId = getDataSourceId(dbType, workspace)
  const databaseId = getDatabaseId(dbType, workspace)

  if (dataSourceId) {
    return { dataSourceId, databaseId, preferred: dataSourceId, type: 'data_source' }
  }
  if (databaseId) {
    return { dataSourceId, databaseId, preferred: databaseId, type: 'database' }
  }
  return { dataSourceId: null, databaseId: null, preferred: null, type: null }
}

/**
 * Get all data_source IDs for a type across all workspaces
 * Scans environment variables matching NOTION_DS_{TYPE}_*
 * @param dbType - The type of database (e.g., 'tasks')
 * @returns Record of workspace -> data_source ID
 */
export function getAllDataSourceIds(dbType: string): Record<string, string> {
  const result: Record<string, string> = {}
  const prefix = `NOTION_DS_${dbType.toUpperCase()}_`

  for (const [envVar, value] of Object.entries(process.env)) {
    if (envVar.startsWith(prefix) && value) {
      const workspace = envVar.substring(prefix.length).toLowerCase()
      result[workspace] = value
    }
  }

  return result
}

/**
 * Get all database IDs for a type across all workspaces
 * Scans environment variables matching NOTION_DB_{TYPE}_*
 * @param dbType - The type of database (e.g., 'tasks')
 * @returns Record of workspace -> database ID
 */
export function getAllDatabaseIds(dbType: string): Record<string, string> {
  const result: Record<string, string> = {}
  const prefix = `NOTION_DB_${dbType.toUpperCase()}_`

  for (const [envVar, value] of Object.entries(process.env)) {
    if (envVar.startsWith(prefix) && value) {
      const workspace = envVar.substring(prefix.length).toLowerCase()
      result[workspace] = value
    }
  }

  return result
}
