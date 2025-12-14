import { Tool } from '@modelcontextprotocol/sdk/types.js'

export interface CustomToolHandler {
  (params: Record<string, any>, httpClient: any): Promise<any>
}

export interface CustomTool {
  definition: Tool
  handler: CustomToolHandler
}

// Rich text formatting types
interface RichTextAnnotations {
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
  code?: boolean
}

interface RichTextSegment {
  type: 'text'
  text: {
    content: string
    link?: { url: string } | null
  }
  annotations?: RichTextAnnotations
}

/**
 * Parse text with markdown-like formatting into Notion rich_text array
 * Supports: **bold**, *italic*, ~~strikethrough~~, `code`, [link](url)
 */
function textToRichText(content: string): RichTextSegment[] {
  const segments: RichTextSegment[] = []

  // Regex patterns for inline formatting
  // Process in order: links first, then other formatting
  const patterns = [
    // Links: [text](url)
    { pattern: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' },
    // Bold: **text**
    { pattern: /\*\*([^*]+)\*\*/g, type: 'bold' },
    // Italic: *text* (single asterisk, not starting/ending with space)
    { pattern: /(?<!\*)\*([^*]+)\*(?!\*)/g, type: 'italic' },
    // Strikethrough: ~~text~~
    { pattern: /~~([^~]+)~~/g, type: 'strikethrough' },
    // Code: `text`
    { pattern: /`([^`]+)`/g, type: 'code' },
  ]

  // Simple approach: find all formatted spans, then build segments
  interface Span {
    start: number
    end: number
    content: string
    annotations: RichTextAnnotations
    link?: string
  }

  const spans: Span[] = []

  // First pass: extract all formatted spans
  for (const { pattern, type } of patterns) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(content)) !== null) {
      const fullMatch = match[0]
      const innerContent = match[1]
      const start = match.index
      const end = start + fullMatch.length

      const annotations: RichTextAnnotations = {}
      let link: string | undefined

      if (type === 'bold') annotations.bold = true
      if (type === 'italic') annotations.italic = true
      if (type === 'strikethrough') annotations.strikethrough = true
      if (type === 'code') annotations.code = true
      if (type === 'link') link = match[2]

      spans.push({
        start,
        end,
        content: innerContent,
        annotations,
        link
      })
    }
  }

  // Sort spans by start position
  spans.sort((a, b) => a.start - b.start)

  // Remove overlapping spans (keep first one)
  const filteredSpans: Span[] = []
  let lastEnd = 0
  for (const span of spans) {
    if (span.start >= lastEnd) {
      filteredSpans.push(span)
      lastEnd = span.end
    }
  }

  // Build segments from spans and gaps
  let currentPos = 0

  for (const span of filteredSpans) {
    // Add plain text before this span
    if (span.start > currentPos) {
      const plainText = content.substring(currentPos, span.start)
      if (plainText) {
        segments.push({
          type: 'text',
          text: { content: plainText }
        })
      }
    }

    // Add the formatted span
    const segment: RichTextSegment = {
      type: 'text',
      text: { content: span.content }
    }

    if (Object.keys(span.annotations).length > 0) {
      segment.annotations = span.annotations
    }

    if (span.link) {
      segment.text.link = { url: span.link }
    }

    segments.push(segment)
    currentPos = span.end
  }

  // Add any remaining plain text
  if (currentPos < content.length) {
    const remaining = content.substring(currentPos)
    if (remaining) {
      segments.push({
        type: 'text',
        text: { content: remaining }
      })
    }
  }

  // If no segments were created (no formatting), return simple text
  if (segments.length === 0) {
    return [{ type: 'text', text: { content } }]
  }

  return segments
}

/**
 * Simple version for cases where we want plain text only
 */
function plainTextToRichText(content: string): RichTextSegment[] {
  return [{ type: 'text', text: { content } }]
}

/**
 * Create a date mention rich text (for Notion @date links)
 */
function dateMentionRichText(dateStr: string): any[] {
  return [{
    type: 'mention',
    mention: {
      type: 'date',
      date: {
        start: dateStr,
        end: null,
        time_zone: null
      }
    }
  }]
}

// Extract plain text from rich_text array
function richTextToPlain(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return ''
  return richText.map(rt => rt.plain_text || rt.text?.content || '').join('')
}

// Check if a rich_text array contains a date mention matching the given date
function hasDateMention(richText: any[], dateStr: string): boolean {
  if (!richText || !Array.isArray(richText)) return false
  return richText.some(rt =>
    rt.type === 'mention' &&
    rt.mention?.type === 'date' &&
    rt.mention?.date?.start?.startsWith(dateStr)
  )
}

// Section configuration for callout-style sections
interface SectionConfig {
  icon: { type: 'external'; external: { url: string } }
  color: string
  aliases: string[] // Alternative names/variations to match
}

const SECTION_CONFIGS: Record<string, SectionConfig> = {
  'to do': {
    icon: { type: 'external', external: { url: 'https://www.notion.so/icons/checkmark-square_blue.svg' } },
    color: 'blue_background',
    aliases: ['todo', 'to-do', 'to do', 'todos', 'checklist', 'tasks']
  },
  'activity log': {
    icon: { type: 'external', external: { url: 'https://www.notion.so/icons/timeline_gray.svg' } },
    color: 'gray_background',
    aliases: ['activity log', 'activitylog', 'activity-log', 'log', 'history', 'updates']
  }
}

/**
 * Normalize text for matching: lowercase, remove punctuation, collapse whitespace
 */
function normalizeText(text: string): string {
  return text.toLowerCase()
    .replace(/[-_]/g, ' ')  // Replace hyphens/underscores with spaces
    .replace(/[^\w\s]/g, '') // Remove other punctuation
    .replace(/\s+/g, ' ')    // Collapse whitespace
    .trim()
}

/**
 * Check if text matches a section name or any of its aliases
 */
function matchesSectionName(text: string, sectionName: string): boolean {
  const normalizedText = normalizeText(text)
  const normalizedSection = normalizeText(sectionName)

  // Direct match
  if (normalizedText.includes(normalizedSection)) {
    return true
  }

  // Check aliases
  const config = SECTION_CONFIGS[sectionName.toLowerCase()]
  if (config?.aliases) {
    for (const alias of config.aliases) {
      if (normalizedText.includes(normalizeText(alias))) {
        return true
      }
    }
  }

  return false
}

/**
 * Get text content from any block type that might be a section header
 */
function getBlockText(block: any): string | null {
  const type = block.type
  switch (type) {
    case 'callout':
      return richTextToPlain(block.callout?.rich_text || [])
    case 'heading_1':
      return richTextToPlain(block.heading_1?.rich_text || [])
    case 'heading_2':
      return richTextToPlain(block.heading_2?.rich_text || [])
    case 'heading_3':
      return richTextToPlain(block.heading_3?.rich_text || [])
    case 'toggle':
      return richTextToPlain(block.toggle?.rich_text || [])
    case 'paragraph':
      // Check if paragraph has bold formatting (sometimes used as headers)
      const richText = block.paragraph?.rich_text || []
      if (richText.length > 0 && richText[0]?.annotations?.bold) {
        return richTextToPlain(richText)
      }
      return null
    default:
      return null
  }
}

/**
 * Find a section block by name (checks callout, heading, and toggle blocks)
 * Handles variations like "To Do", "ToDo", "To-Do", "Checklist", etc.
 * Returns the block and its index, or null if not found
 */
function findSectionBlock(blocks: any[], sectionName: string): { block: any; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const text = getBlockText(block)

    if (text && matchesSectionName(text, sectionName)) {
      return { block, index: i }
    }
  }

  return null
}

/**
 * Create a callout block for a section header
 */
function createSectionCallout(sectionName: string, children?: any[]): any {
  const config = SECTION_CONFIGS[sectionName.toLowerCase()] || {
    icon: { type: 'external', external: { url: 'https://www.notion.so/icons/document_gray.svg' } },
    color: 'gray_background'
  }

  const callout: any = {
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: sectionName }, annotations: { bold: true } }],
      icon: config.icon,
      color: config.color
    }
  }

  if (children && children.length > 0) {
    callout.callout.children = children
  }

  return callout
}

/**
 * Check if a block is a section header (heading, callout with bold text, or bold paragraph)
 */
function isSectionHeader(block: any): boolean {
  const type = block.type

  // Headings are always section headers
  if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
    return true
  }

  // Callouts with bold text are section headers
  if (type === 'callout') {
    const richText = block.callout?.rich_text || []
    return richText.some((rt: any) => rt.annotations?.bold)
  }

  // Bold paragraphs can be section headers
  if (type === 'paragraph') {
    const richText = block.paragraph?.rich_text || []
    return richText.length > 0 && richText[0]?.annotations?.bold
  }

  return false
}

/**
 * Find blocks belonging to a section (between section header and next section header)
 */
function getSectionBlocks(blocks: any[], sectionIndex: number): any[] {
  const sectionBlocks: any[] = []

  for (let i = sectionIndex + 1; i < blocks.length; i++) {
    const block = blocks[i]
    // Stop at next section header
    if (isSectionHeader(block)) {
      break
    }
    sectionBlocks.push(block)
  }

  return sectionBlocks
}

// Summarize block structure
function summarizeBlocks(blocks: any[]): string[] {
  const summary: string[] = []
  for (const block of blocks) {
    const type = block.type
    let text = ''
    if (block[type]?.rich_text) {
      text = richTextToPlain(block[type].rich_text)
    }
    const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
    summary.push(`${type}${preview ? ': ' + preview : ''}`)
  }
  return summary
}

export const customTools: CustomTool[] = [
  {
    definition: {
      name: 'get-page-full',
      description: 'Get a Notion page with its important properties, block content, and summaries of any linked database views. Returns a comprehensive view of the page for context.',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to retrieve'
          },
          include_blocks: {
            type: 'boolean',
            description: 'Whether to include page block content (default: true)',
            default: true
          },
          block_limit: {
            type: 'number',
            description: 'Maximum number of blocks to retrieve (default: 50)',
            default: 50
          }
        },
        required: ['page_id']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, include_blocks = true, block_limit = 50 } = params

      // 1. Get the page
      const pageResponse = await httpClient.executeOperation(
        { method: 'get', path: '/v1/pages/{page_id}', operationId: 'retrieve-a-page' },
        { page_id }
      )
      const page = pageResponse.data

      // 2. Extract important properties
      const properties: Record<string, any> = {}
      const linkedDatabases: string[] = []

      for (const [name, prop] of Object.entries(page.properties || {})) {
        const p = prop as any
        switch (p.type) {
          case 'title':
            properties[name] = richTextToPlain(p.title)
            break
          case 'rich_text':
            properties[name] = richTextToPlain(p.rich_text)
            break
          case 'select':
            properties[name] = p.select?.name || null
            break
          case 'multi_select':
            properties[name] = p.multi_select?.map((s: any) => s.name) || []
            break
          case 'status':
            properties[name] = p.status?.name || null
            break
          case 'date':
            properties[name] = p.date?.start || null
            break
          case 'checkbox':
            properties[name] = p.checkbox
            break
          case 'number':
            properties[name] = p.number
            break
          case 'url':
            properties[name] = p.url
            break
          case 'email':
            properties[name] = p.email
            break
          case 'phone_number':
            properties[name] = p.phone_number
            break
          case 'relation':
            properties[name] = p.relation?.map((r: any) => r.id) || []
            if (p.relation?.length > 0) {
              linkedDatabases.push(name)
            }
            break
          case 'people':
            properties[name] = p.people?.map((person: any) => person.name || person.id) || []
            break
          default:
            // For complex types, include a simplified version
            properties[name] = `[${p.type}]`
        }
      }

      // 3. Get block children if requested
      let blocks: any[] = []
      let blockSummary: string[] = []

      if (include_blocks) {
        try {
          const blocksResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
            { block_id: page_id, page_size: block_limit }
          )
          blocks = blocksResponse.data.results || []
          blockSummary = summarizeBlocks(blocks)
        } catch (e) {
          blockSummary = ['[Error fetching blocks]']
        }
      }

      // 4. Get database schema summaries for linked databases
      const dbSummaries: Record<string, any> = {}

      // Check if page is in a database and get that schema
      if (page.parent?.type === 'database_id') {
        try {
          const dbResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/databases/{database_id}', operationId: 'retrieve-a-database' },
            { database_id: page.parent.database_id }
          )
          const db = dbResponse.data
          dbSummaries['_parent_database'] = {
            title: richTextToPlain(db.title),
            properties: Object.keys(db.properties || {})
          }
        } catch (e) {
          // Ignore errors fetching parent database
        }
      }

      return {
        id: page.id,
        url: page.url,
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
        parent: page.parent,
        properties,
        linked_relations: linkedDatabases,
        block_summary: blockSummary,
        blocks: blocks.slice(0, 10), // Include first 10 full blocks
        database_context: dbSummaries
      }
    }
  },
  {
    definition: {
      name: 'append-structured-content',
      description: 'Append structured content to a Notion page using simple syntax. Supports headings (h1:, h2:, h3:), bullets (- ), numbered lists (1. ), todos ([] or [x]), quotes (> ), dividers (---), and paragraphs. Also supports inline formatting: **bold**, *italic*, ~~strikethrough~~, `code`, and [links](url).',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to append content to'
          },
          content: {
            type: 'string',
            description: 'Content in simple markup format. Each line becomes a block. Use h1:, h2:, h3: for headings, - for bullets, 1. for numbered, [] for unchecked todo, [x] for checked todo, > for quotes, --- for dividers. Inline formatting: **bold**, *italic*, ~~strikethrough~~, `code`, [link](url).'
          },
          after: {
            type: 'string',
            description: 'Optional block ID to insert content after'
          }
        },
        required: ['page_id', 'content']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, content, after } = params

      const lines = content.split('\n')
      const children: any[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let block: any = null

        if (trimmed === '---') {
          block = { type: 'divider', divider: {} }
        } else if (trimmed.startsWith('h1:')) {
          block = {
            type: 'heading_1',
            heading_1: { rich_text: textToRichText(trimmed.substring(3).trim()) }
          }
        } else if (trimmed.startsWith('h2:')) {
          block = {
            type: 'heading_2',
            heading_2: { rich_text: textToRichText(trimmed.substring(3).trim()) }
          }
        } else if (trimmed.startsWith('h3:')) {
          block = {
            type: 'heading_3',
            heading_3: { rich_text: textToRichText(trimmed.substring(3).trim()) }
          }
        } else if (trimmed.startsWith('- ')) {
          block = {
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: textToRichText(trimmed.substring(2)) }
          }
        } else if (/^\d+\.\s/.test(trimmed)) {
          block = {
            type: 'numbered_list_item',
            numbered_list_item: { rich_text: textToRichText(trimmed.replace(/^\d+\.\s/, '')) }
          }
        } else if (trimmed.startsWith('[x] ') || trimmed.startsWith('[X] ')) {
          block = {
            type: 'to_do',
            to_do: { rich_text: textToRichText(trimmed.substring(4)), checked: true }
          }
        } else if (trimmed.startsWith('[] ')) {
          block = {
            type: 'to_do',
            to_do: { rich_text: textToRichText(trimmed.substring(3)), checked: false }
          }
        } else if (trimmed.startsWith('> ')) {
          block = {
            type: 'quote',
            quote: { rich_text: textToRichText(trimmed.substring(2)) }
          }
        } else {
          block = {
            type: 'paragraph',
            paragraph: { rich_text: textToRichText(trimmed) }
          }
        }

        if (block) children.push(block)
      }

      if (children.length === 0) {
        return { success: false, error: 'No content to append' }
      }

      const requestBody: any = { children }
      if (after) requestBody.after = after

      const response = await httpClient.executeOperation(
        { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
        { block_id: page_id, ...requestBody }
      )

      return {
        success: true,
        blocks_added: children.length,
        results: response.data.results?.map((r: any) => ({ id: r.id, type: r.type }))
      }
    }
  },
  {
    definition: {
      name: 'search-and-summarize',
      description: 'Search Notion and return summarized results with key properties. More useful than raw search for getting context quickly.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query text'
          },
          filter_type: {
            type: 'string',
            enum: ['page', 'database'],
            description: 'Filter to only pages or databases'
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 10)',
            default: 10
          }
        },
        required: ['query']
      }
    },
    handler: async (params, httpClient) => {
      const { query, filter_type, limit = 10 } = params

      const searchBody: any = { query, page_size: limit }
      if (filter_type) {
        searchBody.filter = { property: 'object', value: filter_type }
      }

      const response = await httpClient.executeOperation(
        { method: 'post', path: '/v1/search', operationId: 'post-search' },
        searchBody
      )

      const results = (response.data.results || []).map((item: any) => {
        const summary: any = {
          id: item.id,
          type: item.object,
          url: item.url
        }

        if (item.object === 'page') {
          // Get title from properties
          for (const [name, prop] of Object.entries(item.properties || {})) {
            const p = prop as any
            if (p.type === 'title') {
              summary.title = richTextToPlain(p.title)
              break
            }
          }
          summary.last_edited = item.last_edited_time
          summary.parent_type = item.parent?.type
        } else if (item.object === 'database') {
          summary.title = richTextToPlain(item.title)
          summary.property_count = Object.keys(item.properties || {}).length
          summary.properties = Object.keys(item.properties || {})
        }

        return summary
      })

      return {
        query,
        total_results: results.length,
        results
      }
    }
  },
  {
    definition: {
      name: 'create-task-with-project',
      description: 'Create a new task in a Tasks database and immediately link it to a project. Sets up the task with title, status, and project relation.',
      inputSchema: {
        type: 'object',
        properties: {
          database_id: {
            type: 'string',
            description: 'The ID of the Tasks database to create the task in'
          },
          title: {
            type: 'string',
            description: 'Title of the task'
          },
          project_id: {
            type: 'string',
            description: 'ID of the project to link to (optional)'
          },
          project_property_name: {
            type: 'string',
            description: 'Name of the relation property for Project (default: "Project")',
            default: 'Project'
          },
          status: {
            type: 'string',
            description: 'Initial status for the task (e.g., "To Do", "In Progress")'
          },
          status_property_name: {
            type: 'string',
            description: 'Name of the status property (default: "Status")',
            default: 'Status'
          },
          do_next: {
            type: 'string',
            description: 'The immediate next action to take'
          },
          do_next_property_name: {
            type: 'string',
            description: 'Name of the Do Next property (default: "Do Next")',
            default: 'Do Next'
          },
          area_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of areas to link to'
          },
          area_property_name: {
            type: 'string',
            description: 'Name of the area relation property (default: "Area")',
            default: 'Area'
          },
          initial_checklist: {
            type: 'array',
            items: { type: 'string' },
            description: 'Initial checklist items to add to the task page'
          }
        },
        required: ['database_id', 'title']
      }
    },
    handler: async (params, httpClient) => {
      const {
        database_id,
        title,
        project_id,
        project_property_name = 'Project',
        status,
        status_property_name = 'Status',
        do_next,
        do_next_property_name = 'Do Next',
        area_ids,
        area_property_name = 'Area',
        initial_checklist
      } = params

      // Build properties object
      const properties: any = {
        title: {
          title: textToRichText(title)
        }
      }

      // Add project relation if provided
      if (project_id) {
        properties[project_property_name] = {
          relation: [{ id: project_id }]
        }
      }

      // Add status if provided
      if (status) {
        properties[status_property_name] = {
          status: { name: status }
        }
      }

      // Add do_next if provided
      if (do_next) {
        properties[do_next_property_name] = {
          rich_text: textToRichText(do_next)
        }
      }

      // Add areas if provided
      if (area_ids && area_ids.length > 0) {
        properties[area_property_name] = {
          relation: area_ids.map((id: string) => ({ id }))
        }
      }

      // Create the page
      const createResponse = await httpClient.executeOperation(
        { method: 'post', path: '/v1/pages', operationId: 'post-page' },
        {
          parent: { database_id },
          properties
        }
      )

      const page = createResponse.data

      // Add initial checklist items if provided
      if (initial_checklist && initial_checklist.length > 0) {
        const checklistBlocks = [
          createSectionCallout('To Do'),
          ...initial_checklist.map((item: string) => ({
            type: 'to_do',
            to_do: { rich_text: textToRichText(item), checked: false }
          })),
          createSectionCallout('Activity Log')
        ]

        await httpClient.executeOperation(
          { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
          { block_id: page.id, children: checklistBlocks }
        )
      }

      return {
        success: true,
        task_id: page.id,
        url: page.url,
        title,
        project_linked: !!project_id,
        checklist_added: initial_checklist?.length || 0
      }
    }
  },
  {
    definition: {
      name: 'add-activity-log',
      description: 'Add a timestamped activity log entry to a Notion page. Finds or creates an Activity Log section and appends the entry with timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to add the activity log entry to'
          },
          entry: {
            type: 'string',
            description: 'The activity log entry text (will be prepended with timestamp)'
          },
          timestamp: {
            type: 'string',
            description: 'Optional custom timestamp (default: current time in "YYYY-MM-DD HH:MM ET" format)'
          },
          timezone: {
            type: 'string',
            description: 'Timezone abbreviation for timestamp (default: "ET")',
            default: 'ET'
          }
        },
        required: ['page_id', 'entry']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, entry, timestamp, timezone = 'ET' } = params

      // Generate date and time components
      const now = new Date()
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timezone}`

      // Log entry with just time (date is in the toggle header)
      const logEntry = timestamp ? `${timestamp} — ${entry}` : `${timeStr} — ${entry}`

      // Get existing blocks to find Activity Log section
      const blocksResponse = await httpClient.executeOperation(
        { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
        { block_id: page_id, page_size: 100 }
      )

      const blocks = blocksResponse.data.results || []

      // Find Activity Log section (callout or heading)
      const activityLogSection = findSectionBlock(blocks, 'Activity Log')

      // If no Activity Log section, create one with a date toggle
      if (!activityLogSection) {
        const createSectionResponse = await httpClient.executeOperation(
          { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
          {
            block_id: page_id,
            children: [
              createSectionCallout('Activity Log'),
              {
                type: 'toggle',
                toggle: {
                  rich_text: dateMentionRichText(dateStr),
                  children: [
                    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }
                  ]
                }
              }
            ]
          }
        )

        return {
          success: true,
          entry: logEntry,
          date: dateStr,
          section_created: true,
          toggle_created: true,
          blocks_added: createSectionResponse.data.results?.map((r: any) => r.id)
        }
      }

      // Get blocks in the Activity Log section to find today's date toggle
      const sectionBlocks = getSectionBlocks(blocks, activityLogSection.index)
      let todayToggleId: string | null = null

      for (const block of sectionBlocks) {
        if (block.type === 'toggle') {
          const toggleRichText = block.toggle?.rich_text || []
          // Check for date mention or plain text match
          if (hasDateMention(toggleRichText, dateStr) || richTextToPlain(toggleRichText) === dateStr) {
            todayToggleId = block.id
            break
          }
        }
      }

      // If today's toggle exists, append to it
      if (todayToggleId) {
        const appendResponse = await httpClient.executeOperation(
          { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
          {
            block_id: todayToggleId,
            children: [
              { type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }
            ]
          }
        )

        return {
          success: true,
          entry: logEntry,
          date: dateStr,
          section_created: false,
          toggle_created: false,
          block_id: appendResponse.data.results?.[0]?.id
        }
      }

      // Create a new toggle for today's date after the Activity Log section header
      const createToggleResponse = await httpClient.executeOperation(
        { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
        {
          block_id: page_id,
          after: activityLogSection.block.id,
          children: [
            {
              type: 'toggle',
              toggle: {
                rich_text: dateMentionRichText(dateStr),
                children: [
                  { type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }
                ]
              }
            }
          ]
        }
      )

      return {
        success: true,
        entry: logEntry,
        date: dateStr,
        section_created: false,
        toggle_created: true,
        block_id: createToggleResponse.data.results?.[0]?.id
      }
    }
  },
  {
    definition: {
      name: 'complete-checklist-item',
      description: 'Find a checklist item (to_do block) by text, mark it complete, and move it to the Activity Log with a timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page containing the checklist'
          },
          item_text: {
            type: 'string',
            description: 'Text of the checklist item to complete (partial match supported)'
          },
          completion_note: {
            type: 'string',
            description: 'Optional note to add to the activity log entry'
          },
          timezone: {
            type: 'string',
            description: 'Timezone abbreviation for timestamp (default: "ET")',
            default: 'ET'
          }
        },
        required: ['page_id', 'item_text']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, item_text, completion_note, timezone = 'ET' } = params

      // Get all blocks
      const blocksResponse = await httpClient.executeOperation(
        { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
        { block_id: page_id, page_size: 100 }
      )

      const blocks = blocksResponse.data.results || []

      // Find the to_do block matching the text
      let targetBlock: any = null

      for (const block of blocks) {
        if (block.type === 'to_do') {
          const text = richTextToPlain(block.to_do?.rich_text || [])
          if (text.toLowerCase().includes(item_text.toLowerCase())) {
            targetBlock = block
            break
          }
        }
      }

      // Find Activity Log section (callout or heading)
      const activityLogSection = findSectionBlock(blocks, 'Activity Log')

      if (!targetBlock) {
        return {
          success: false,
          error: `No checklist item found matching "${item_text}"`
        }
      }

      const itemFullText = richTextToPlain(targetBlock.to_do?.rich_text || [])

      // Mark the to_do as checked
      await httpClient.executeOperation(
        { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
        {
          block_id: targetBlock.id,
          to_do: {
            checked: true
          }
        }
      )

      // Generate date and time components
      const now = new Date()
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timezone}`

      const logEntry = completion_note
        ? `${timeStr} — ✓ ${itemFullText} (${completion_note})`
        : `${timeStr} — ✓ ${itemFullText}`

      // Add to activity log with date toggle
      if (activityLogSection) {
        // Get blocks in the Activity Log section to find today's date toggle
        const sectionBlocks = getSectionBlocks(blocks, activityLogSection.index)
        let todayToggleId: string | null = null

        for (const block of sectionBlocks) {
          if (block.type === 'toggle') {
            const toggleRichText = block.toggle?.rich_text || []
            // Check for date mention or plain text match
            if (hasDateMention(toggleRichText, dateStr) || richTextToPlain(toggleRichText) === dateStr) {
              todayToggleId = block.id
              break
            }
          }
        }

        if (todayToggleId) {
          // Append to existing toggle
          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
            {
              block_id: todayToggleId,
              children: [
                { type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }
              ]
            }
          )
        } else {
          // Create new toggle for today after the section header
          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
            {
              block_id: page_id,
              after: activityLogSection.block.id,
              children: [
                {
                  type: 'toggle',
                  toggle: {
                    rich_text: dateMentionRichText(dateStr),
                    children: [
                      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }
                    ]
                  }
                }
              ]
            }
          )
        }
      }

      return {
        success: true,
        completed_item: itemFullText,
        activity_logged: !!activityLogHeadingId,
        date: dateStr,
        log_entry: logEntry
      }
    }
  }
]
