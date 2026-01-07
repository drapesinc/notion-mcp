/**
 * MCP Resources for Notion Workflow Presets
 *
 * Resources expose data that LLMs can read to understand workflow configurations,
 * database IDs, and tool documentation.
 */

import { Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js'

/**
 * Tasks database IDs by workspace
 */
export const TASKS_DATABASE_IDS: Record<string, string> = {
  personal: 'REDACTED_DB_ID_PERSONAL',
  fourall: 'REDACTED_DB_ID_FOURALL',
  drapes: 'REDACTED_DB_ID_DRAPES'
}

/**
 * Workflow preset configuration
 */
export interface WorkflowPreset {
  name: string
  description: string
  tool: string
  action: string
  defaultParams: Record<string, any>
  requiredParams: string[]
}

/**
 * Pre-configured workflow presets using unified tools
 */
export const workflowPresets: WorkflowPreset[] = [
  {
    name: 'daily-task-review',
    description: 'Get all tasks due today across workspaces for daily standup or review',
    tool: 'notion-database',
    action: 'get-due-tasks',
    defaultParams: { days_ahead: 0, include_details: true },
    requiredParams: ['workspace']
  },
  {
    name: 'weekly-task-review',
    description: 'Get all tasks due within the next 7 days',
    tool: 'notion-database',
    action: 'get-due-tasks',
    defaultParams: { days_ahead: 7, include_details: true },
    requiredParams: ['workspace']
  },
  {
    name: 'quick-activity-log',
    description: 'Add a quick timestamped note to a page\'s activity log',
    tool: 'notion-blocks',
    action: 'add-activity-log',
    defaultParams: { timezone: 'ET' },
    requiredParams: ['page_id', 'entry']
  },
  {
    name: 'complete-and-log',
    description: 'Mark a checklist item complete and log it with optional notes',
    tool: 'notion-blocks',
    action: 'complete-todo',
    defaultParams: { timezone: 'ET' },
    requiredParams: ['page_id', 'item_text']
  },
  {
    name: 'create-task',
    description: 'Create a new task page with initial content',
    tool: 'notion-page',
    action: 'create',
    defaultParams: {},
    requiredParams: ['database_id', 'title']
  },
  {
    name: 'update-section',
    description: 'Replace a specific section of a page with new content',
    tool: 'notion-blocks',
    action: 'replace-section',
    defaultParams: {},
    requiredParams: ['page_id', 'section_name', 'content']
  },
  {
    name: 'link-to-project',
    description: 'Add a task to a project using relation append mode',
    tool: 'notion-page',
    action: 'update',
    defaultParams: {},
    requiredParams: ['page_id', 'project_id']
  }
]

/**
 * Static resources available via MCP
 */
export function getStaticResources(): Resource[] {
  return [
    {
      uri: 'notion://workflow/presets',
      name: 'Workflow Presets',
      description: 'Pre-configured workflow operations using unified Notion tools',
      mimeType: 'application/json'
    },
    {
      uri: 'notion://workflow/databases',
      name: 'Tasks Database IDs',
      description: 'Database IDs for Tasks databases in each workspace',
      mimeType: 'application/json'
    },
    {
      uri: 'notion://workflow/tools',
      name: 'Unified Tools Reference',
      description: 'Quick reference for the 6 unified Notion tools',
      mimeType: 'text/markdown'
    },
    {
      uri: 'notion://workflow/content-syntax',
      name: 'Structured Content Syntax',
      description: 'Syntax reference for structured content in block operations',
      mimeType: 'text/markdown'
    },
    {
      uri: 'notion://workflow/mention-syntax',
      name: 'Mention Syntax Reference',
      description: 'How to create page, database, and user mentions in content',
      mimeType: 'text/markdown'
    }
  ]
}

/**
 * Resource templates for dynamic resources
 */
export function getResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: 'notion://workflow/preset/{preset_name}',
      name: 'Workflow Preset',
      description: 'Get details for a specific workflow preset',
      mimeType: 'application/json'
    },
    {
      uriTemplate: 'notion://workflow/database/{workspace}',
      name: 'Workspace Database',
      description: 'Get Tasks database ID for a specific workspace',
      mimeType: 'application/json'
    }
  ]
}

/**
 * Read a resource by URI
 */
export function readResource(uri: string): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  // Static resources
  if (uri === 'notion://workflow/presets') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          description: 'Pre-configured workflow operations using unified Notion tools',
          presets: workflowPresets.map(p => ({
            name: p.name,
            description: p.description,
            tool: p.tool,
            action: p.action,
            defaultParams: p.defaultParams,
            requiredParams: p.requiredParams
          }))
        }, null, 2)
      }]
    }
  }

  if (uri === 'notion://workflow/databases') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          description: 'Tasks database IDs for each workspace',
          databases: TASKS_DATABASE_IDS,
          usage: 'Use these database_id values with notion-database action="get-due-tasks" or notion-page action="create"'
        }, null, 2)
      }]
    }
  }

  if (uri === 'notion://workflow/tools') {
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: `# Unified Notion Tools Reference

## 6 Unified Tools

| Tool | Actions | Description |
|------|---------|-------------|
| **notion-page** | get, create, update, delete | Page CRUD with template support and relation modes |
| **notion-blocks** | get, append, update, delete, replace-section, add-activity-log, complete-todo | Block operations with structured content syntax |
| **notion-database** | get, query, get-due-tasks | Database schema and querying |
| **notion-search** | (query only) | Search pages and databases |
| **notion-comments** | get, create | Comments on pages |
| **notion-users** | list, get, me | User information |

## Quick Examples

### Get a page with blocks
\`\`\`json
{ "action": "get", "page_id": "abc123", "include_blocks": true }
\`\`\`

### Create a page with content
\`\`\`json
{
  "action": "create",
  "database_id": "xyz789",
  "title": "New Task",
  "initial_content": "h2: Overview\\n- First item\\n[] Todo item"
}
\`\`\`

### Update page relations (append mode)
\`\`\`json
{
  "action": "update",
  "page_id": "abc123",
  "relations": {
    "Project": { "ids": ["project-id"], "mode": "append" }
  }
}
\`\`\`

### Add activity log entry
\`\`\`json
{ "action": "add-activity-log", "page_id": "abc123", "entry": "Completed review" }
\`\`\`

### Get due tasks
\`\`\`json
{ "action": "get-due-tasks", "days_ahead": 0, "include_details": true }
\`\`\`
`
      }]
    }
  }

  if (uri === 'notion://workflow/content-syntax') {
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: `# Structured Content Syntax

Use this syntax with notion-blocks actions: append, replace-section, and notion-page initial_content.

## Block Types

| Prefix | Block Type | Example |
|--------|-----------|---------|
| \`h1:\` | Heading 1 | \`h1: Main Title\` |
| \`h2:\` | Heading 2 | \`h2: Subsection\` |
| \`h3:\` | Heading 3 | \`h3: Details\` |
| \`-\` | Bullet list | \`- Item one\` |
| \`1.\` | Numbered list | \`1. First step\` |
| \`[]\` | Unchecked todo | \`[] Do this thing\` |
| \`[x]\` | Checked todo | \`[x] Already done\` |
| \`>\` | Quote | \`> Important note\` |
| \`---\` | Divider | \`---\` |
| (none) | Paragraph | \`Plain text paragraph\` |

## Inline Formatting

| Syntax | Result |
|--------|--------|
| \`**text**\` | **bold** |
| \`*text*\` | *italic* |
| \`~~text~~\` | ~~strikethrough~~ |
| \`\\\`code\\\`\` | \`code\` |
| \`[text](url)\` | [link](url) |

## Mentions

| Syntax | Creates |
|--------|---------|
| \`@page[Title](page_id)\` | Page mention |
| \`@page[Title](page_id#block_id)\` | Link to block |
| \`@db[Title](database_id)\` | Database mention |
| \`@user[Name](user_id)\` | User mention |

## Example

\`\`\`
h2: Project Status
- Current phase: **Implementation**
- Owner: @user[John](user-id-123)

[] Review @page[Design Doc](abc123)
[x] Initial setup complete

> See @db[Task Board](def456) for full list
\`\`\`
`
      }]
    }
  }

  if (uri === 'notion://workflow/mention-syntax') {
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: `# Notion Mention Syntax

Create Notion-style mentions in your content using these patterns.

## Page Mentions

Link to another Notion page:
\`\`\`
@page[Page Title](page-id-here)
\`\`\`

## Block Anchors

Link to a specific block within a page:
\`\`\`
@page[Page Title](page-id#block-id)
\`\`\`

## Database Mentions

Link to a database:
\`\`\`
@db[Database Name](database-id)
\`\`\`

## User Mentions

Mention a workspace member:
\`\`\`
@user[Display Name](user-id)
\`\`\`

## Finding IDs

- **Page/Database IDs**: Copy from Notion URL or use notion-search
- **Block IDs**: Use notion-blocks action="get" to list blocks
- **User IDs**: Use notion-users action="list" to list workspace members
`
      }]
    }
  }

  // Dynamic preset resource
  const presetMatch = uri.match(/^notion:\/\/workflow\/preset\/(.+)$/)
  if (presetMatch) {
    const presetName = presetMatch[1]
    const preset = workflowPresets.find(p => p.name === presetName)

    if (preset) {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            name: preset.name,
            description: preset.description,
            tool: preset.tool,
            action: preset.action,
            defaultParams: preset.defaultParams,
            requiredParams: preset.requiredParams,
            usage: `Use the ${preset.tool} tool with action="${preset.action}". Required: ${preset.requiredParams.join(', ')}`
          }, null, 2)
        }]
      }
    }

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Preset not found', available: workflowPresets.map(p => p.name) })
      }]
    }
  }

  // Dynamic database resource
  const dbMatch = uri.match(/^notion:\/\/workflow\/database\/(.+)$/)
  if (dbMatch) {
    const workspace = dbMatch[1]
    const databaseId = TASKS_DATABASE_IDS[workspace]

    if (databaseId) {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            workspace,
            database_id: databaseId,
            usage: `Use this database_id with notion-database action="get-due-tasks" or notion-page action="create" for the ${workspace} workspace`
          }, null, 2)
        }]
      }
    }

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Workspace not found', available: Object.keys(TASKS_DATABASE_IDS) })
      }]
    }
  }

  // Unknown resource
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: 'Resource not found', availableResources: getStaticResources().map(r => r.uri) })
    }]
  }
}
