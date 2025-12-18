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

// Notion mention rich text types
interface PageMention {
  type: 'mention'
  mention: {
    type: 'page'
    page: { id: string }
  }
}

interface DatabaseMention {
  type: 'mention'
  mention: {
    type: 'database'
    database: { id: string }
  }
}

interface UserMention {
  type: 'mention'
  mention: {
    type: 'user'
    user: { id: string }
  }
}

type RichTextItem = RichTextSegment | PageMention | DatabaseMention | UserMention

/**
 * Parse text with markdown-like formatting into Notion rich_text array
 * Supports:
 * - **bold**, *italic*, ~~strikethrough~~, `code`, [link](url)
 * - @page[Title](page_id) - page mention
 * - @page[Title](page_id#block_id) - page link with block anchor
 * - @db[Title](database_id) - database mention
 * - @user[Name](user_id) - user mention
 */
function textToRichText(content: string): any[] {
  const segments: any[] = []

  // Regex patterns for inline formatting
  // Process mentions first, then links, then other formatting
  const patterns = [
    // Page mention with block anchor: @page[Title](page_id#block_id) - creates a link
    { pattern: /@page\[([^\]]+)\]\(([^)#]+)#([^)]+)\)/g, type: 'page_anchor' },
    // Page mention: @page[Title](page_id)
    { pattern: /@page\[([^\]]+)\]\(([^)]+)\)/g, type: 'page' },
    // Database mention: @db[Title](database_id)
    { pattern: /@db\[([^\]]+)\]\(([^)]+)\)/g, type: 'database' },
    // User mention: @user[Name](user_id)
    { pattern: /@user\[([^\]]+)\]\(([^)]+)\)/g, type: 'user' },
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
    mentionType?: 'page' | 'database' | 'user'
    mentionId?: string
    blockAnchor?: string
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
      let mentionType: 'page' | 'database' | 'user' | undefined
      let mentionId: string | undefined
      let blockAnchor: string | undefined

      switch (type) {
        case 'bold': annotations.bold = true; break
        case 'italic': annotations.italic = true; break
        case 'strikethrough': annotations.strikethrough = true; break
        case 'code': annotations.code = true; break
        case 'link': link = match[2]; break
        case 'page':
          mentionType = 'page'
          mentionId = match[2]
          break
        case 'page_anchor':
          // Page with block anchor - use Notion URL format as link
          mentionType = 'page'
          mentionId = match[2]
          blockAnchor = match[3]
          break
        case 'database':
          mentionType = 'database'
          mentionId = match[2]
          break
        case 'user':
          mentionType = 'user'
          mentionId = match[2]
          break
      }

      spans.push({
        start,
        end,
        content: innerContent,
        annotations,
        link,
        mentionType,
        mentionId,
        blockAnchor
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

    // Add the formatted span - either mention or text
    if (span.mentionType && span.mentionId) {
      // Handle mentions
      if (span.blockAnchor) {
        // Page with block anchor - create a link to the page#block
        const notionUrl = `https://www.notion.so/${span.mentionId.replace(/-/g, '')}#${span.blockAnchor.replace(/-/g, '')}`
        segments.push({
          type: 'text',
          text: { content: span.content, link: { url: notionUrl } }
        })
      } else if (span.mentionType === 'page') {
        segments.push({
          type: 'mention',
          mention: { type: 'page', page: { id: span.mentionId } }
        })
      } else if (span.mentionType === 'database') {
        segments.push({
          type: 'mention',
          mention: { type: 'database', database: { id: span.mentionId } }
        })
      } else if (span.mentionType === 'user') {
        segments.push({
          type: 'mention',
          mention: { type: 'user', user: { id: span.mentionId } }
        })
      }
    } else {
      // Regular text segment
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
    }
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

// Summarize block structure with nested children
function summarizeBlocks(blocks: any[], indent: number = 0): string[] {
  const summary: string[] = []
  const prefix = '  '.repeat(indent)
  for (const block of blocks) {
    const type = block.type
    let text = ''
    if (block[type]?.rich_text) {
      text = richTextToPlain(block[type].rich_text)
    }
    const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
    const childIndicator = block.children?.length ? ` [${block.children.length} children]` : ''
    summary.push(`${prefix}${type}${preview ? ': ' + preview : ''}${childIndicator}`)

    // Recursively summarize children
    if (block.children?.length) {
      summary.push(...summarizeBlocks(block.children, indent + 1))
    }
  }
  return summary
}

// Recursively fetch children for blocks that have has_children: true
async function fetchBlockChildren(
  blocks: any[],
  httpClient: any,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<any[]> {
  if (currentDepth >= maxDepth) return blocks

  for (const block of blocks) {
    if (block.has_children) {
      try {
        const childrenResponse = await httpClient.executeOperation(
          { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
          { block_id: block.id, page_size: 100 }
        )
        const children = childrenResponse.data.results || []
        // Recursively fetch children of children
        block.children = await fetchBlockChildren(children, httpClient, maxDepth, currentDepth + 1)
      } catch (e) {
        // If we can't fetch children, just continue
        block.children = []
      }
    }
  }
  return blocks
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
          },
          expand_toggles: {
            type: 'boolean',
            description: 'Whether to recursively fetch children of toggle/callout blocks (default: false)',
            default: false
          },
          max_depth: {
            type: 'number',
            description: 'Maximum depth for nested block expansion when expand_toggles is true (default: 3)',
            default: 3
          }
        },
        required: ['page_id']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, include_blocks = true, block_limit = 50, expand_toggles = false, max_depth = 3 } = params

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

          // Optionally expand nested toggle/callout content
          if (expand_toggles) {
            blocks = await fetchBlockChildren(blocks, httpClient, max_depth, 0)
          }

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
      description: 'Append structured content to a Notion page using simple syntax. Supports headings (h1:, h2:, h3:), bullets (- ), numbered lists (1. ), todos ([] or [x]), quotes (> ), dividers (---), and paragraphs. Also supports inline formatting: **bold**, *italic*, ~~strikethrough~~, `code`, [links](url). Notion mentions: @page[Title](page_id), @page[Title](page_id#block_id) for block anchors, @db[Title](database_id), @user[Name](user_id).',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to append content to'
          },
          content: {
            type: 'string',
            description: 'Content in simple markup format. Each line becomes a block. Use h1:, h2:, h3: for headings, - for bullets, 1. for numbered, [] for unchecked todo, [x] for checked todo, > for quotes, --- for dividers. Inline formatting: **bold**, *italic*, ~~strikethrough~~, `code`, [link](url). Mentions: @page[Title](id), @page[Title](id#block), @db[Title](id), @user[Name](id).'
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
      description: 'Create or update a task in a Tasks database. Supports relation append/remove without replacing entire array. Use page_id to update existing task.',
      inputSchema: {
        type: 'object',
        properties: {
          database_id: {
            type: 'string',
            description: 'The ID of the Tasks database (required for new tasks, optional for updates)'
          },
          page_id: {
            type: 'string',
            description: 'ID of existing task to update. If omitted, creates new task.'
          },
          title: {
            type: 'string',
            description: 'Title of the task (required for new tasks)'
          },
          project_id: {
            type: 'string',
            description: 'ID of the project to link to'
          },
          project_property_name: {
            type: 'string',
            description: 'Name of the relation property for Project (default: "Project")',
            default: 'Project'
          },
          relation_mode: {
            type: 'string',
            enum: ['replace', 'append', 'remove'],
            description: 'How to handle relations: replace (default), append (add to existing), remove (remove from existing)',
            default: 'replace'
          },
          status: {
            type: 'string',
            description: 'Status for the task (e.g., "To Do", "In Progress")'
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
            description: 'Initial checklist items to add to the task page (only for new tasks)'
          }
        },
        required: []
      }
    },
    handler: async (params, httpClient) => {
      const {
        database_id,
        page_id,
        title,
        project_id,
        project_property_name = 'Project',
        relation_mode = 'replace',
        status,
        status_property_name = 'Status',
        do_next,
        do_next_property_name = 'Do Next',
        area_ids,
        area_property_name = 'Area',
        initial_checklist
      } = params

      const isUpdate = !!page_id

      // For updates with append/remove mode, fetch existing relations first
      let existingProjectIds: string[] = []
      let existingAreaIds: string[] = []

      if (isUpdate && relation_mode !== 'replace') {
        const pageResponse = await httpClient.executeOperation(
          { method: 'get', path: '/v1/pages/{page_id}', operationId: 'retrieve-a-page' },
          { page_id }
        )
        const pageData = pageResponse.data

        // Extract existing relation IDs
        const projectProp = pageData.properties?.[project_property_name]
        if (projectProp?.relation) {
          existingProjectIds = projectProp.relation.map((r: any) => r.id)
        }

        const areaProp = pageData.properties?.[area_property_name]
        if (areaProp?.relation) {
          existingAreaIds = areaProp.relation.map((r: any) => r.id)
        }
      }

      // Build properties object
      const properties: any = {}

      // Add title (required for new, optional for update)
      if (title) {
        properties.title = {
          title: textToRichText(title)
        }
      } else if (!isUpdate) {
        return { success: false, error: 'Title is required for new tasks' }
      }

      // Handle project relation with append/remove support
      if (project_id) {
        let finalProjectIds: string[]

        if (relation_mode === 'append') {
          finalProjectIds = [...new Set([...existingProjectIds, project_id])]
        } else if (relation_mode === 'remove') {
          finalProjectIds = existingProjectIds.filter(id => id !== project_id)
        } else {
          finalProjectIds = [project_id]
        }

        properties[project_property_name] = {
          relation: finalProjectIds.map(id => ({ id }))
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

      // Handle areas with append/remove support
      if (area_ids && area_ids.length > 0) {
        let finalAreaIds: string[]

        if (relation_mode === 'append') {
          finalAreaIds = [...new Set([...existingAreaIds, ...area_ids])]
        } else if (relation_mode === 'remove') {
          finalAreaIds = existingAreaIds.filter(id => !area_ids.includes(id))
        } else {
          finalAreaIds = area_ids
        }

        properties[area_property_name] = {
          relation: finalAreaIds.map((id: string) => ({ id }))
        }
      }

      let page: any

      if (isUpdate) {
        // Update existing page
        const updateResponse = await httpClient.executeOperation(
          { method: 'patch', path: '/v1/pages/{page_id}', operationId: 'patch-page' },
          { page_id, properties }
        )
        page = updateResponse.data
      } else {
        // Create new page
        if (!database_id) {
          return { success: false, error: 'database_id is required for new tasks' }
        }

        const createResponse = await httpClient.executeOperation(
          { method: 'post', path: '/v1/pages', operationId: 'post-page' },
          {
            parent: { database_id },
            properties
          }
        )
        page = createResponse.data

        // Add initial checklist items if provided (only for new tasks)
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
      }

      return {
        success: true,
        mode: isUpdate ? 'updated' : 'created',
        relation_mode: relation_mode,
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
        activity_logged: !!activityLogSection,
        date: dateStr,
        log_entry: logEntry
      }
    }
  },
  {
    definition: {
      name: 'get-due-tasks',
      description: 'Get tasks due on or before today from a Tasks database. Returns tasks with their checklist items and recent activity log entries. Use the workspace parameter to select which workspace to query.',
      inputSchema: {
        type: 'object',
        properties: {
          include_details: {
            type: 'boolean',
            description: 'Whether to fetch page content (checklist + activity log) for each task (default: true)',
            default: true
          },
          days_ahead: {
            type: 'number',
            description: 'Include tasks due within N days from today (default: 0 = today and overdue only)',
            default: 0
          }
        }
      }
    },
    handler: async (params, httpClient) => {
      const { include_details = true, days_ahead = 0 } = params

      // Hardcoded database IDs for each workspace's Tasks database
      // The workspace is determined by the MCP proxy based on the workspace param
      const TASKS_DATABASES: Record<string, string> = {
        personal: 'REDACTED_DB_ID_PERSONAL',
        fourall: 'REDACTED_DB_ID_FOURALL',
        drapes: 'REDACTED_DB_ID_DRAPES'
      }

      // Calculate the due date cutoff
      const today = new Date()
      today.setDate(today.getDate() + days_ahead)
      const dueDateCutoff = today.toISOString().split('T')[0]

      const allTasks: any[] = []
      let workspaceName = 'unknown'

      // Try each database ID to find which one works with this httpClient
      // (The httpClient is already configured for a specific workspace by the MCP proxy)
      for (const [ws, dbId] of Object.entries(TASKS_DATABASES)) {
        try {
          // Query the Tasks database with filters
          const queryResponse = await httpClient.executeOperation(
            { method: 'post', path: '/v1/databases/{database_id}/query', operationId: 'post-database-query' },
            {
              database_id: dbId,
              filter: {
                and: [
                  {
                    property: 'Due',
                    date: { on_or_before: dueDateCutoff }
                  },
                  {
                    property: 'Status',
                    status: { does_not_equal: 'Done' }
                  },
                  {
                    property: 'Status',
                    status: { does_not_equal: "Don't Do" }
                  },
                  {
                    property: 'Status',
                    status: { does_not_equal: 'Archived' }
                  }
                ]
              },
              sorts: [
                { property: 'Due', direction: 'ascending' }
              ],
              page_size: 50
            }
          )

          // Successfully queried this workspace
          workspaceName = ws
          const tasks = queryResponse.data.results || []

          for (const task of tasks) {
            // Extract properties
            const properties: Record<string, any> = {}
            let title = ''

            for (const [name, prop] of Object.entries(task.properties || {})) {
              const p = prop as any
              switch (p.type) {
                case 'title':
                  title = richTextToPlain(p.title)
                  properties[name] = title
                  break
                case 'status':
                  properties[name] = p.status?.name || null
                  break
                case 'date':
                  properties[name] = p.date?.start || null
                  break
                case 'select':
                  properties[name] = p.select?.name || null
                  break
                case 'people':
                  properties[name] = p.people?.map((person: any) => person.name || person.id) || []
                  break
                case 'relation':
                  properties[name] = p.relation?.length || 0
                  break
                case 'rich_text':
                  properties[name] = richTextToPlain(p.rich_text)
                  break
                case 'checkbox':
                  properties[name] = p.checkbox
                  break
              }
            }

            const taskData: any = {
              id: task.id,
              workspace: ws,
              title,
              url: task.url,
              status: properties['Status'],
              due: properties['Due'],
              priority: properties['Priority'],
              assignee: properties['Assignee'],
              do_next: properties['Do Next'] || properties['Smart List'],
              project_count: properties['Project']
            }

            // Fetch page content if requested
            if (include_details) {
              try {
                const blocksResponse = await httpClient.executeOperation(
                  { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
                  { block_id: task.id, page_size: 50 }
                )

                const blocks = blocksResponse.data.results || []
                const checklist: any[] = []
                const activityLog: any[] = []
                let inActivityLog = false

                for (const block of blocks) {
                  // Detect Activity Log section
                  const blockText = getBlockText(block)
                  if (blockText && matchesSectionName(blockText, 'Activity Log')) {
                    inActivityLog = true
                    continue
                  }

                  // Collect to_do items (checklist)
                  if (block.type === 'to_do') {
                    const text = richTextToPlain(block.to_do?.rich_text || [])
                    checklist.push({
                      text,
                      checked: block.to_do?.checked || false
                    })
                  }

                  // Collect activity log entries (toggles with dates)
                  if (inActivityLog && block.type === 'toggle') {
                    const toggleText = richTextToPlain(block.toggle?.rich_text || [])
                    activityLog.push(toggleText)
                    // Only get last 3 activity entries
                    if (activityLog.length >= 3) break
                  }
                }

                taskData.checklist = checklist
                taskData.activity_log = activityLog
                taskData.checklist_progress = `${checklist.filter(c => c.checked).length}/${checklist.length}`

              } catch (blockError: any) {
                taskData.checklist = []
                taskData.activity_log = []
                taskData.details_error = blockError.message || 'Failed to fetch blocks'
              }
            }

            allTasks.push(taskData)
          }

          // Found the right workspace, stop trying others
          break
        } catch {
          // This database ID doesn't work with this token, try next
          continue
        }
      }

      // Calculate summary
      const todayStr = new Date().toISOString().split('T')[0]
      const overdue = allTasks.filter(t => t.due && t.due < todayStr).length
      const dueToday = allTasks.filter(t => t.due === todayStr).length
      const upcoming = allTasks.filter(t => t.due && t.due > todayStr).length

      return {
        workspace: workspaceName,
        date_queried: todayStr,
        days_ahead,
        total_tasks: allTasks.length,
        summary: {
          overdue,
          due_today: dueToday,
          upcoming
        },
        tasks: allTasks
      }
    }
  },
  {
    definition: {
      name: 'delete-blocks',
      description: 'Delete blocks from a Notion page. Can delete by block IDs, by section name (deletes section and its content), or clear all content.',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to delete blocks from'
          },
          block_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific block IDs to delete'
          },
          section_name: {
            type: 'string',
            description: 'Delete a section by name (e.g., "Management Team"). Deletes the section header and all content until the next section.'
          },
          clear_all: {
            type: 'boolean',
            description: 'Delete ALL blocks from the page (use with caution)',
            default: false
          }
        },
        required: ['page_id']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, block_ids, section_name, clear_all = false } = params

      // Get all blocks from the page
      const blocksResponse = await httpClient.executeOperation(
        { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
        { block_id: page_id, page_size: 100 }
      )

      const blocks = blocksResponse.data.results || []
      let blocksToDelete: string[] = []

      if (clear_all) {
        // Delete all blocks
        blocksToDelete = blocks.map((b: any) => b.id)
      } else if (block_ids && block_ids.length > 0) {
        // Delete specific blocks
        blocksToDelete = block_ids
      } else if (section_name) {
        // Find section and delete it plus content until next section
        let inSection = false
        let sectionFound = false

        for (const block of blocks) {
          const text = getBlockText(block)

          // Check if this is the section we're looking for
          if (text && matchesSectionName(text, section_name)) {
            inSection = true
            sectionFound = true
            blocksToDelete.push(block.id)
            continue
          }

          // Check if we've hit the next section
          if (inSection && isSectionHeader(block)) {
            break // Stop at next section
          }

          // Add blocks within the section
          if (inSection) {
            blocksToDelete.push(block.id)
          }
        }

        if (!sectionFound) {
          return {
            success: false,
            error: `Section "${section_name}" not found on page`
          }
        }
      } else {
        return {
          success: false,
          error: 'Must specify block_ids, section_name, or clear_all=true'
        }
      }

      // Delete the blocks
      const deleted: string[] = []
      const errors: string[] = []

      for (const blockId of blocksToDelete) {
        try {
          await httpClient.executeOperation(
            { method: 'delete', path: '/v1/blocks/{block_id}', operationId: 'delete-a-block' },
            { block_id: blockId }
          )
          deleted.push(blockId)
        } catch (e: any) {
          errors.push(`${blockId}: ${e.message || 'Failed to delete'}`)
        }
      }

      return {
        success: errors.length === 0,
        deleted_count: deleted.length,
        deleted_block_ids: deleted,
        errors: errors.length > 0 ? errors : undefined
      }
    }
  },
  {
    definition: {
      name: 'update-block',
      description: 'Update the content of a single block. Supports text blocks (paragraph, headings, lists, todos, quotes).',
      inputSchema: {
        type: 'object',
        properties: {
          block_id: {
            type: 'string',
            description: 'The ID of the block to update'
          },
          content: {
            type: 'string',
            description: 'New text content for the block. Supports inline formatting: **bold**, *italic*, ~~strikethrough~~, `code`, [link](url). Mentions: @page[Title](id), @db[Title](id), @user[Name](id).'
          },
          checked: {
            type: 'boolean',
            description: 'For to_do blocks: whether the item is checked'
          }
        },
        required: ['block_id', 'content']
      }
    },
    handler: async (params, httpClient) => {
      const { block_id, content, checked } = params

      // First, get the block to determine its type
      const blockResponse = await httpClient.executeOperation(
        { method: 'get', path: '/v1/blocks/{block_id}', operationId: 'retrieve-a-block' },
        { block_id }
      )

      const block = blockResponse.data
      const blockType = block.type

      // Build update payload based on block type
      const updatePayload: any = { block_id }
      const richText = textToRichText(content)

      switch (blockType) {
        case 'paragraph':
          updatePayload.paragraph = { rich_text: richText }
          break
        case 'heading_1':
          updatePayload.heading_1 = { rich_text: richText }
          break
        case 'heading_2':
          updatePayload.heading_2 = { rich_text: richText }
          break
        case 'heading_3':
          updatePayload.heading_3 = { rich_text: richText }
          break
        case 'bulleted_list_item':
          updatePayload.bulleted_list_item = { rich_text: richText }
          break
        case 'numbered_list_item':
          updatePayload.numbered_list_item = { rich_text: richText }
          break
        case 'to_do':
          updatePayload.to_do = { rich_text: richText }
          if (typeof checked === 'boolean') {
            updatePayload.to_do.checked = checked
          }
          break
        case 'quote':
          updatePayload.quote = { rich_text: richText }
          break
        case 'callout':
          updatePayload.callout = { rich_text: richText }
          break
        case 'toggle':
          updatePayload.toggle = { rich_text: richText }
          break
        default:
          return {
            success: false,
            error: `Block type "${blockType}" is not supported for content updates`
          }
      }

      // Update the block
      const response = await httpClient.executeOperation(
        { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
        updatePayload
      )

      return {
        success: true,
        block_id: response.data.id,
        block_type: blockType,
        updated_content: content
      }
    }
  },
  {
    definition: {
      name: 'replace-page-section',
      description: 'Replace a section of a Notion page with new content. Finds the section by name, deletes it and its content, then inserts new structured content in its place.',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to modify'
          },
          section_name: {
            type: 'string',
            description: 'Name of the section to replace (e.g., "Management Team")'
          },
          new_content: {
            type: 'string',
            description: 'New content in simple markup format. Use h1:, h2:, h3: for headings, - for bullets, 1. for numbered, [] for todos, > for quotes, --- for dividers. Inline formatting: **bold**, *italic*, [link](url).'
          },
          insert_after_block_id: {
            type: 'string',
            description: 'Optional: Insert after this specific block ID instead of finding by section name'
          }
        },
        required: ['page_id', 'new_content']
      }
    },
    handler: async (params, httpClient) => {
      const { page_id, section_name, new_content, insert_after_block_id } = params

      // Get all blocks from the page
      const blocksResponse = await httpClient.executeOperation(
        { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
        { block_id: page_id, page_size: 100 }
      )

      const blocks = blocksResponse.data.results || []
      let insertAfterId: string | null = insert_after_block_id || null
      const blocksToDelete: string[] = []

      if (section_name && !insert_after_block_id) {
        // Find the section
        let inSection = false
        let sectionFound = false
        let previousBlockId: string | null = null

        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i]
          const text = getBlockText(block)

          // Check if this is the section we're looking for
          if (text && matchesSectionName(text, section_name)) {
            inSection = true
            sectionFound = true
            insertAfterId = previousBlockId // Insert after the block BEFORE this section
            blocksToDelete.push(block.id)
            continue
          }

          // Check if we've hit the next section
          if (inSection && isSectionHeader(block)) {
            break // Stop at next section
          }

          // Add blocks within the section to delete
          if (inSection) {
            blocksToDelete.push(block.id)
          }

          previousBlockId = block.id
        }

        if (!sectionFound) {
          return {
            success: false,
            error: `Section "${section_name}" not found on page`
          }
        }
      }

      // Delete the old section blocks
      const deleted: string[] = []
      for (const blockId of blocksToDelete) {
        try {
          await httpClient.executeOperation(
            { method: 'delete', path: '/v1/blocks/{block_id}', operationId: 'delete-a-block' },
            { block_id: blockId }
          )
          deleted.push(blockId)
        } catch (e) {
          // Continue even if some deletions fail
        }
      }

      // Parse and insert new content
      const lines = new_content.split('\n')
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
        return {
          success: false,
          error: 'No content to insert',
          deleted_count: deleted.length
        }
      }

      // Insert new content
      const insertPayload: any = { block_id: page_id, children }
      if (insertAfterId) {
        insertPayload.after = insertAfterId
      }

      const response = await httpClient.executeOperation(
        { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
        insertPayload
      )

      return {
        success: true,
        deleted_count: deleted.length,
        inserted_count: children.length,
        inserted_block_ids: response.data.results?.map((r: any) => r.id)
      }
    }
  },
  {
    definition: {
      name: 'get-toolset-info',
      description: 'Get information about available Notion MCP toolsets and how to enable them. Shows current configuration and lists tools that could be enabled with different settings.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    handler: async () => {
      // Import toolset config dynamically to get current state
      const toolsetDefinitions = {
        core: {
          description: 'Basic CRUD operations - pages, databases, search, reading blocks',
          tools: ['get-page-full', 'search-and-summarize', 'get-toolset-info', 'post-search', 'retrieve-a-page', 'patch-page', 'post-page', 'retrieve-a-database', 'post-database-query', 'get-block-children']
        },
        blocks: {
          description: 'Block writing - append all types of content blocks',
          tools: ['append-structured-content', 'patch-block-children']
        },
        workflow: {
          description: 'Workflow automation - task creation, activity logging, checklists, due tasks, page editing',
          tools: ['create-task-with-project', 'add-activity-log', 'complete-checklist-item', 'get-due-tasks', 'delete-blocks', 'update-block', 'replace-page-section']
        },
        media: {
          description: 'Media operations - images, videos, files, embeds, bookmarks',
          tools: ['add-media-block', 'add-bookmark', 'add-embed']
        },
        advanced: {
          description: 'Advanced blocks - tables, columns, equations, table of contents',
          tools: ['create-table', 'add-equation', 'add-columns']
        },
        comments: {
          description: 'Comments API - read and create comments',
          tools: ['retrieve-a-comment', 'create-a-comment']
        },
        users: {
          description: 'Users API - list and retrieve users',
          tools: ['get-users', 'get-user', 'get-self']
        }
      }

      const modes = {
        full: ['core', 'blocks', 'workflow', 'media', 'advanced', 'comments', 'users'],
        standard: ['core', 'blocks', 'workflow'],
        minimal: ['core'],
        custom: 'Set NOTION_TOOLSETS env var with comma-separated toolset names'
      }

      const currentMode = process.env.NOTION_TOOLSET_MODE || 'standard'
      const currentToolsets = currentMode === 'custom'
        ? (process.env.NOTION_TOOLSETS || 'core').split(',').map(s => s.trim())
        : modes[currentMode as keyof typeof modes] || modes.standard

      return {
        current_mode: currentMode,
        current_toolsets: currentToolsets,
        available_modes: Object.keys(modes),
        toolset_definitions: toolsetDefinitions,
        configuration_help: {
          description: 'To change toolset configuration, update the MCP server environment variables',
          env_vars: {
            NOTION_TOOLSET_MODE: 'Set to "full", "standard", "minimal", or "custom"',
            NOTION_TOOLSETS: 'When mode is "custom", comma-separated list of toolsets to enable (e.g., "core,blocks,workflow,media")'
          },
          examples: {
            full_mode: { NOTION_TOOLSET_MODE: 'full' },
            custom_mode: { NOTION_TOOLSET_MODE: 'custom', NOTION_TOOLSETS: 'core,blocks,workflow,comments' }
          }
        }
      }
    }
  }
]
