/**
 * MCP Prompts for Notion Workflow Operations
 *
 * Prompts are templates that guide LLMs on how to accomplish workflow tasks
 * using the unified Notion tools.
 */

import { Prompt } from '@modelcontextprotocol/sdk/types.js'

export interface WorkflowPrompt {
  prompt: Prompt
  getMessages: (args: Record<string, string>) => Array<{
    role: 'user' | 'assistant'
    content: { type: 'text'; text: string }
  }>
}

/**
 * All workflow prompts available via MCP
 */
export const workflowPrompts: WorkflowPrompt[] = [
  // Activity Log Prompt
  {
    prompt: {
      name: 'add-activity-log',
      description: 'Add a timestamped entry to a page\'s Activity Log section. Creates the section if it doesn\'t exist.',
      arguments: [
        { name: 'page_id', description: 'The Notion page ID to add the activity log to', required: true },
        { name: 'entry', description: 'The activity log entry text (timestamp will be added automatically)', required: true },
        { name: 'workspace', description: 'Which workspace to use (personal, fourall, drapes)', required: false }
      ]
    },
    getMessages: (args) => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Add an activity log entry to a Notion page.

Use the **notion-blocks** tool with these parameters:
- action: "add-activity-log"
- page_id: ${args.page_id}
- entry: "${args.entry}"
${args.workspace ? `- workspace: ${args.workspace}` : ''}

This will:
1. Find or create an "Activity Log" section on the page
2. Find or create a date toggle for today's date
3. Add a timestamped entry under that date toggle`
      }
    }]
  },

  // Complete Checklist Item Prompt
  {
    prompt: {
      name: 'complete-checklist-item',
      description: 'Check off a to-do item and move it to the Activity Log with a completion timestamp.',
      arguments: [
        { name: 'page_id', description: 'The Notion page ID containing the checklist', required: true },
        { name: 'item_text', description: 'Text of the checklist item to complete (partial match supported)', required: true },
        { name: 'completion_note', description: 'Optional note to add to the activity log entry', required: false },
        { name: 'workspace', description: 'Which workspace to use', required: false }
      ]
    },
    getMessages: (args) => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Complete a checklist item and log it.

Use the **notion-blocks** tool with these parameters:
- action: "complete-todo"
- page_id: ${args.page_id}
- item_text: "${args.item_text}"
${args.completion_note ? `- completion_note: "${args.completion_note}"` : ''}
${args.workspace ? `- workspace: ${args.workspace}` : ''}

This will:
1. Find the to-do item matching the text
2. Mark it as checked
3. Add a completion entry to the Activity Log section`
      }
    }]
  },

  // Get Due Tasks Prompt
  {
    prompt: {
      name: 'get-due-tasks',
      description: 'Fetch tasks that are due today or earlier from the Tasks database.',
      arguments: [
        { name: 'workspace', description: 'Which workspace to query (personal, fourall, drapes)', required: true },
        { name: 'days_ahead', description: 'Include tasks due within N days from today (default: 0 = today and overdue only)', required: false },
        { name: 'include_details', description: 'Whether to fetch page content like checklists and activity logs (default: true)', required: false }
      ]
    },
    getMessages: (args) => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Get tasks that are due.

Use the **notion-database** tool with these parameters:
- action: "get-due-tasks"
- workspace: ${args.workspace}
${args.days_ahead ? `- days_ahead: ${args.days_ahead}` : ''}
${args.include_details !== undefined ? `- include_details: ${args.include_details}` : ''}

This will:
1. Query the Tasks database for the workspace
2. Filter to tasks with Due date <= today (or today + days_ahead)
3. Exclude tasks with status: Done, Don't Do, Archived
4. Optionally fetch checklist and activity log content for each task`
      }
    }]
  },

  // Create Page with Template Prompt
  {
    prompt: {
      name: 'create-page',
      description: 'Create a new page in a database, optionally using a template.',
      arguments: [
        { name: 'database_id', description: 'The database ID to create the page in', required: true },
        { name: 'title', description: 'Page title', required: true },
        { name: 'template_id', description: 'Template ID to use ("default", "none", or specific ID)', required: false },
        { name: 'initial_content', description: 'Initial structured content (h1:, -, [], etc.)', required: false },
        { name: 'workspace', description: 'Which workspace to use', required: false }
      ]
    },
    getMessages: (args) => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Create a new page in a Notion database.

Use the **notion-page** tool with these parameters:
- action: "create"
- database_id: ${args.database_id}
- title: "${args.title}"
${args.template_id ? `- template_id: "${args.template_id}"` : ''}
${args.initial_content ? `- initial_content: """
${args.initial_content}
"""` : ''}
${args.workspace ? `- workspace: ${args.workspace}` : ''}

This will:
1. Create a new page in the specified database
2. Apply template if specified (requires Notion API 2025-09-03+)
3. Add initial content if provided (and no template used)`
      }
    }]
  },

  // Replace Page Section Prompt
  {
    prompt: {
      name: 'replace-section',
      description: 'Find a section by name, delete it, and replace with new structured content.',
      arguments: [
        { name: 'page_id', description: 'The Notion page ID', required: true },
        { name: 'section_name', description: 'Name of the section to replace (e.g., "Management Team")', required: true },
        { name: 'new_content', description: 'New content in structured format (h1:, h2:, -, 1., [], > etc)', required: true },
        { name: 'workspace', description: 'Which workspace to use', required: false }
      ]
    },
    getMessages: (args) => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Replace a section on a Notion page.

Use the **notion-blocks** tool with these parameters:
- action: "replace-section"
- page_id: ${args.page_id}
- section_name: "${args.section_name}"
- content: """
${args.new_content}
"""
${args.workspace ? `- workspace: ${args.workspace}` : ''}

Content format supports:
- h1: h2: h3: for headings
- - for bullet lists
- 1. for numbered lists
- [] or [x] for todos
- > for quotes
- --- for dividers
- **bold**, *italic*, \`code\`, [link](url) for inline formatting`
      }
    }]
  },

  // Update Page Relations Prompt
  {
    prompt: {
      name: 'update-relations',
      description: 'Update relation properties on a page with append/remove/replace modes.',
      arguments: [
        { name: 'page_id', description: 'The page ID to update', required: true },
        { name: 'relation_name', description: 'Name of the relation property to update', required: true },
        { name: 'relation_ids', description: 'Comma-separated list of page IDs to add/remove/set', required: true },
        { name: 'mode', description: 'How to handle relations: append, remove, or replace (default)', required: false },
        { name: 'workspace', description: 'Which workspace to use', required: false }
      ]
    },
    getMessages: (args) => {
      const ids = args.relation_ids.split(',').map(s => s.trim())
      const mode = args.mode || 'replace'

      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Update relations on a Notion page.

Use the **notion-page** tool with these parameters:
- action: "update"
- page_id: ${args.page_id}
- relations: {
    "${args.relation_name}": {
      "ids": ${JSON.stringify(ids)},
      "mode": "${mode}"
    }
  }
${args.workspace ? `- workspace: ${args.workspace}` : ''}

Relation modes:
- append: Add these IDs to existing relations
- remove: Remove these IDs from existing relations
- replace: Replace entire relation array with these IDs`
        }
      }]
    }
  },

  // Daily Task Review Prompt
  {
    prompt: {
      name: 'daily-review',
      description: 'Get all due tasks and create a summary for daily standup or review.',
      arguments: [
        { name: 'workspace', description: 'Which workspace to query', required: true }
      ]
    },
    getMessages: (args) => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Perform a daily task review.

1. Use **notion-database** with action="get-due-tasks", workspace="${args.workspace}", days_ahead=0, include_details=true

2. Summarize the results:
   - List overdue tasks (with how many days overdue)
   - List tasks due today
   - Show checklist progress for each task
   - Highlight any tasks with no checklist items

3. Suggest priorities based on:
   - Overdue items first
   - Items with "Do Next" field populated
   - Items with low checklist completion`
      }
    }]
  }
]

/**
 * Get all prompts for MCP registration
 */
export function getPromptsList(): Prompt[] {
  return workflowPrompts.map(wp => wp.prompt)
}

/**
 * Get a specific prompt by name
 */
export function getPromptByName(name: string): WorkflowPrompt | undefined {
  return workflowPrompts.find(wp => wp.prompt.name === name)
}
