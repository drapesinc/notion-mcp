# Notion MCP Server

Custom fork of the Notion MCP server with multi-workspace support and workflow tools.

## Multi-Workspace Configuration

The server supports multiple Notion workspaces via environment variables:

```bash
# Workspace tokens (dynamically discovered via NOTION_TOKEN_* pattern)
NOTION_TOKEN_PERSONAL=secret_xxx
NOTION_TOKEN_DRAPES=secret_yyy
NOTION_TOKEN_FOURALL=secret_zzz

# Default workspace (optional, uses first found if not set)
NOTION_DEFAULT_WORKSPACE=personal

# Legacy single-workspace mode (fallback)
NOTION_TOKEN=secret_xxx
```

### How It Works
- Server scans for all `NOTION_TOKEN_*` env vars at startup
- Each token creates a workspace named after the suffix (lowercase)
- Tools get optional `workspace` parameter when multiple workspaces configured
- Falls back to default workspace if not specified

### Key Files
- `src/workspace-config.ts` - Workspace discovery and configuration
- `src/openapi-mcp-server/mcp/proxy.ts` - Multi-HttpClient routing
- `src/custom-tools.ts` - Custom workflow tools
- `src/toolset-config.ts` - Tool filtering configuration

## Unified CRUD Tools

6 action-based tools that consolidate all Notion operations:

| Tool | Actions | Description |
|------|---------|-------------|
| `notion-page` | get, create, update, delete | Page CRUD with template support and relation modes |
| `notion-blocks` | get, get-block, append, update, delete, replace-section, add-activity-log, complete-todo, add-table-row, update-table-row, add-table-column | Block operations with structured content syntax, table CRUD, and appending to any container block |
| `notion-database` | get, query, get-due-tasks | Database schema and querying |
| `notion-search` | (query) | Search pages and databases |
| `notion-comments` | get, create | Comments on pages |
| `notion-users` | list, get, me | User information |

### Example Usage

```json
// Get a page with blocks
{ "action": "get", "page_id": "abc123", "include_blocks": true }

// Create a task with content
{ "action": "create", "database_id": "xyz789", "title": "New Task", "initial_content": "h2: Overview\n- First item" }

// Update page relations (append mode)
{ "action": "update", "page_id": "abc123", "relations": { "Project": { "ids": ["project-id"], "mode": "append" } } }

// Get due tasks
{ "action": "get-due-tasks", "workspace": "personal", "days_ahead": 0 }

// Append to any container block (toggle, callout, bullet, etc.)
{ "action": "append", "block_id": "toggle-block-id", "content": "- Nested item 1\n- Nested item 2" }

// Get specific block with context from URL
{ "action": "get-block", "url": "https://www.notion.so/page-2b0b4417f9cb8060b10fca928cc67725#2e0b4417f9cb80388cafd3d440c75a4b", "context_before": 2, "context_after": 2 }
```

### Fuzzy Matching for Select Properties

When creating or updating pages, multi-select, select, and status properties automatically use fuzzy matching to find the closest option if an exact match isn't found.

**How it works:**
- Fetches database schema to get valid options
- Tries exact match first
- Falls back to fuzzy matching (prefix, contains, bigram similarity)
- Returns warnings showing what was matched

**Example:**
```json
// Input with typo
{ "action": "update", "page_id": "abc123", "properties": { "Status": { "status": { "name": "in progres" } } } }

// Response includes fuzzy_matches
{ "success": true, "fuzzy_matches": ["Status: \"in progres\" → \"In Progress\" (80% match)"] }
```

**Supported property types:**
- `status` - Status properties
- `select` - Single select
- `multi_select` - Multi-select (each value matched individually)

## Legacy Custom Tools

Still available for backward compatibility:

| Tool | Description |
|------|-------------|
| `get-page-full` | Get page with properties, blocks, and linked database summaries. Use `expand_toggles: true` to fetch nested toggle/callout content. |
| `search-and-summarize` | Search Notion with summarized results |
| `append-structured-content` | Add content using markdown-like syntax |
| `create-task-with-project` | Create task linked to project with initial checklist |
| `add-activity-log` | Add timestamped entry to Activity Log section |
| `complete-checklist-item` | Check off item and move to Activity Log |
| `get-due-tasks` | Fetch tasks due today or earlier from Tasks database |
| `delete-blocks` | Delete blocks by ID, section name, or clear all |
| `update-block` | Update a single block's text content |
| `update-page` | Update any page properties with relation append/remove support |
| `replace-page-section` | Replace a section with new structured content |

## Section Handling

Tools detect sections by checking multiple block types:
- Callout blocks (preferred, with icons)
- Heading blocks (h1, h2, h3)
- Toggle blocks
- Bold paragraphs

### Section Aliases
- **To Do**: todo, to-do, checklist, tasks
- **Activity Log**: activitylog, activity-log, log, history, updates

### Section Styling
When creating sections, callout blocks are used with:
- **To Do**: Blue checkmark icon, blue background
- **Activity Log**: Timeline icon, gray background

## Activity Log Format

Activity logs use date toggles with @date mentions:
```
> @2025-12-15 (toggle)
  - 10:30 ET — Entry text here
  - 14:15 ET — Another entry
```

New entries append to existing date toggle or create new one.

## Table Support

### Creating Tables (Structured Content)

Use markdown table syntax in `initial_content` or `content` parameters:

```
| Product | Price | Stock |
|---------|-------|-------|
| Apple   | $1.50 | 100   |
| Banana  | $0.75 | 250   |
```

The separator row (`|---|---|`) marks the first row as a column header.

### Table CRUD Operations

**Add a row:**
```json
{ "action": "add-table-row", "table_id": "block-id", "row_cells": ["Orange", "$2.00", "75"] }
```

**Update a row:**
```json
{ "action": "update-table-row", "row_id": "row-block-id", "row_cells": ["Apple", "$1.75", "150"] }
```

**Add a column:**
```json
{ "action": "add-table-column", "table_id": "block-id", "column_name": "Category", "column_default": "Fruit" }
```

### Parameters
- `table_id`: The table block ID (for add-table-row, add-table-column)
- `row_id`: The table_row block ID (for update-table-row)
- `row_cells`: Array of cell values
- `column_name`: Header text for new column
- `column_default`: Default value for existing rows (optional)

## Block Operations

### Append to Container Blocks

The `append` action now supports appending children to **any block that supports children**, not just pages. This includes:
- Toggle blocks
- Callout blocks
- Bulleted/numbered list items
- Quote blocks
- Column blocks
- Synced blocks

**Example - Add children to a toggle:**
```json
{
  "action": "append",
  "block_id": "toggle-block-id",
  "content": "- First nested bullet\n- Second nested bullet\n[] A todo inside the toggle"
}
```

**Parameters:**
- `block_id`: ID of the container block to append to (use this for non-page containers)
- `page_id`: ID of the page to append to (use this for page-level appends)
- `content`: Structured content to append
- `after`: Optional block ID to insert after

If both `block_id` and `page_id` are provided, `block_id` takes precedence.

### Get Block with Context (get-block)

Fetch a specific block with its children and surrounding sibling context. Supports Notion URLs with block hash fragments.

**Parameters:**
- `block_id`: Direct block ID
- `url`: Notion URL (parses page_id from path, block_id from hash fragment)
- `context_before`: Number of sibling blocks to fetch before target (default: 0)
- `context_after`: Number of sibling blocks to fetch after target (default: 0)
- `include_children`: Fetch nested children (default: true)
- `max_depth`: Max depth for nested children (default: 2)

**URL Formats Supported:**
```
# Full URL with block hash
https://www.notion.so/workspace/Page-Title-2b0b4417f9cb8060b10fca928cc67725#2e0b4417f9cb80388cafd3d440c75a4b

# URL with query params
https://www.notion.so/workspace/Page-Title-2b0b4417f9cb8060b10fca928cc67725?source=copy_link#2e0b4417f9cb80388cafd3d440c75a4b

# Short format
page_id#block_id

# Just block ID
2e0b4417f9cb80388cafd3d440c75a4b
```

**Example - Get block with surrounding context:**
```json
{
  "action": "get-block",
  "url": "https://www.notion.so/page-2b0b4417f9cb8060b10fca928cc67725#2e0b4417f9cb80388cafd3d440c75a4b",
  "context_before": 3,
  "context_after": 3,
  "include_children": true,
  "max_depth": 2
}
```

**Response includes:**
```json
{
  "success": true,
  "block": { /* full block object */ },
  "block_id": "2e0b4417-f9cb-8038-8caf-d3d440c75a4b",
  "type": "toggle",
  "text": "Toggle title text",
  "has_children": true,
  "parent": { "type": "page_id", "page_id": "..." },
  "children": [ /* nested blocks up to max_depth */ ],
  "children_count": 5,
  "siblings_before": [ /* 3 blocks before */ ],
  "siblings_after": [ /* 3 blocks after */ ],
  "position_in_parent": 7,
  "total_siblings": 15
}
```

## Building

```bash
npm install
npm run build
```

## Testing

Set environment variables and run:
```bash
source scripts/notion-ids.local.sh  # Your database IDs
export NOTION_TOKEN_PERSONAL="secret_xxx"
node bin/cli.mjs
```

## Database ID Configuration

Database and data source IDs are configured via environment variables. This allows each user to plug in their own Notion databases.

### Setup

1. Copy the template: `cp scripts/notion-ids.sh scripts/notion-ids.local.sh`
2. Edit `scripts/notion-ids.local.sh` with your IDs
3. Source before running: `source scripts/notion-ids.local.sh`

### Finding Your IDs

1. Search for your database: `notion-search query="Tasks"`
2. Look for results with `type="data_source"` - use that ID for `NOTION_DS_*`
3. The URL contains the database ID for `NOTION_DB_*`

### Environment Variable Patterns

```bash
# Data Source IDs (preferred, 2025-09-03 API)
NOTION_DS_{TYPE}_{WORKSPACE}="data-source-uuid"

# Database IDs (fallback)
NOTION_DB_{TYPE}_{WORKSPACE}="database-uuid"
```

**Examples:**
```bash
export NOTION_DS_TASKS_PERSONAL="135b4417-f9cb-81a3-857b-000b9fb27289"
export NOTION_DS_PROJECTS_WORK="abcd1234-5678-90ab-cdef-1234567890ab"
export NOTION_DB_TASKS_PERSONAL="REDACTED_DB_ID_PERSONAL"
```

The server dynamically discovers all `NOTION_DS_*` and `NOTION_DB_*` env vars at startup.

## get-due-tasks Tool

Fetches tasks due today or earlier from the Tasks database for a workspace.

### Parameters
- `workspace` (optional): Workspace name matching your `NOTION_DS_TASKS_{WORKSPACE}` env vars
- `days_ahead` (optional): Include tasks due within N days from today (default: 0)
- `include_details` (optional): Fetch checklist and activity log content (default: true)

### Filters Applied
- Due date <= today (or today + days_ahead)
- Status is not: Done, Don't Do, Archived

### Expected Properties
The Tasks database must have:
- `Due` - Date property
- `Status` - Status property (with Done, Don't Do, Archived options)

## Page Section Tools

### delete-blocks
Delete blocks from a Notion page:
- By specific block IDs
- By section name (deletes header and content until next section)
- Clear all content (`clear_all: true`)

### update-block
Update a single block's text content. Supports inline formatting:
`**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` ``, `[link](url)`

### update-page
Update any database page properties with relation append/remove support. Solves the Notion API limitation where relations must be replaced entirely.

**Parameters:**
- `page_id` (required): The page to update
- `relations` (optional): Relation updates with mode support
- `properties` (optional): Standard property updates
- `workspace` (optional): Target workspace

**Relation Modes:**
| Mode | Behavior |
|------|----------|
| `append` | Add to existing relations (default keeps existing) |
| `remove` | Remove specified IDs from existing relations |
| `replace` | Replace entire relation array (default) |

**Example:**
```json
{
  "page_id": "abc123",
  "relations": {
    "Projects": {"ids": ["project-id-1"], "mode": "append"},
    "Areas": {"ids": ["area-id-1", "area-id-2"], "mode": "replace"}
  },
  "properties": {
    "Status": {"status": {"name": "In Progress"}}
  }
}
```

**How it works:**
1. Fetches current page to get existing relation values
2. Applies the specified mode (append/remove/replace)
3. Sends single PATCH request with computed relation array

## Notion Mentions

Create Notion-style mentions in content using these syntaxes:

| Syntax | Creates |
|--------|---------|
| `@page[Title](page_id)` | Page mention (@Page Title) |
| `@page[Title](page_id#block_id)` | Link to specific block |
| `@db[Title](database_id)` | Database mention |
| `@user[Name](user_id)` | User mention |

Example:
```
See @page[Project Plan](abc123) for details
Check @page[Meeting Notes](def456#ghi789) section 3
```

## get-toolset-info Tool

Returns information about available toolsets and how to enable them. Call this tool to see:
- Current toolset mode and enabled toolsets
- Available toolsets and their tools
- Configuration instructions

### replace-page-section
Find a section by name, delete it, and insert new content. Uses the same structured content syntax as `append-structured-content`:
```
h1: Heading
h2: Subheading
- Bullet
1. Numbered
[] Todo unchecked
[x] Todo checked
> Quote
--- Divider
```

## Database Templates

Create pages using database templates. Requires Notion API version `2025-09-03` or later.

### API-list-templates
List available templates for a database (raw API tool).

**Parameters:**
- `data_source_id` (required): The database ID
- `name` (optional): Filter templates by name
- `page_size` (optional): Number of results (1-100)

### Using Templates with create-task-with-project

The `create-task-with-project` tool supports a `template_id` parameter:

```json
{
  "database_id": "REDACTED_DB_ID_FOURALL",
  "title": "New Task from Template",
  "template_id": "default"
}
```

**Template ID values:**
- `"default"` - Use the database's default template
- `"none"` - Create without template
- `"<template-uuid>"` - Specific template ID from `API-list-templates`

**Note:** When using templates, `initial_checklist` is ignored. Template content is applied asynchronously.

## Toolset Configuration

The unified tools are in the `unified` toolset. Ensure they're enabled:
```bash
NOTION_TOOLSET_MODE=standard  # Includes unified, workflow by default
# Or explicitly:
NOTION_TOOLSET_MODE=custom
NOTION_TOOLSETS=core,unified,blocks,workflow
```

## MCP Prompts

Workflow prompts guide LLMs on accomplishing tasks. Access via `listPrompts()` and `getPrompt()`:

| Prompt | Description |
|--------|-------------|
| `add-activity-log` | Add timestamped entry to a page's Activity Log section |
| `complete-checklist-item` | Check off a to-do and log completion |
| `get-due-tasks` | Fetch tasks due today or earlier |
| `create-page` | Create a new page with optional template |
| `replace-section` | Replace a section with new content |
| `update-relations` | Update page relations with append/remove modes |
| `daily-review` | Get due tasks and create daily summary |

## MCP Resources

Resources expose data for LLMs to read. Access via `listResources()` and `readResource()`:

| URI | Description |
|-----|-------------|
| `notion://workflow/presets` | Pre-configured workflow operations |
| `notion://workflow/databases` | Tasks database IDs by workspace |
| `notion://workflow/tools` | Unified tools quick reference |
| `notion://workflow/content-syntax` | Structured content syntax guide |
| `notion://workflow/mention-syntax` | Mention syntax reference |

Dynamic resources:
- `notion://workflow/preset/{name}` - Details for a specific preset
- `notion://workflow/database/{workspace}` - Database ID for a workspace
