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

## Custom Tools

Beyond the standard Notion API operations:

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

## Building

```bash
npm install
npm run build
```

## Testing

Set environment variables and run:
```bash
export NOTION_TOKEN_PERSONAL="secret_xxx"
node bin/cli.mjs
```

## get-due-tasks Tool

Fetches tasks due today or earlier from the Tasks database for a workspace.

### Parameters
- `workspace` (required): personal, fourall, or drapes
- `days_ahead` (optional): Include tasks due within N days from today (default: 0)
- `include_details` (optional): Fetch checklist and activity log content (default: true)

### Filters Applied
- Due date <= today (or today + days_ahead)
- Status is not: Done, Don't Do, Archived

### Tasks Database IDs
| Workspace | Database ID |
|-----------|-------------|
| Personal | `REDACTED_DB_ID_PERSONAL` |
| Four All | `REDACTED_DB_ID_FOURALL` |
| Drapes | `REDACTED_DB_ID_DRAPES` |

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

## Toolset Configuration

The workflow tools are in the `workflow` toolset. Ensure it's enabled:
```bash
NOTION_TOOLSET_MODE=standard  # Includes workflow by default
# Or explicitly:
NOTION_TOOLSET_MODE=custom
NOTION_TOOLSETS=core,blocks,workflow
```
