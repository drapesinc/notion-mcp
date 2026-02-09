/**
 * Unified Notion CRUD Tools
 *
 * Consolidates all Notion operations into 6 unified tools:
 * 1. notion-page - get/create/update/delete page operations
 * 2. notion-blocks - get/append/update/delete/replace block operations
 * 3. notion-database - get/query database operations
 * 4. notion-search - search operations
 * 5. notion-comments - get/create comment operations
 * 6. notion-users - list/get user operations
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getAllDataSourceIds, getDatabaseId, getDataSourceId } from './workspace-config.js'

// ============================================================================
// Icon Parsing Utility
// ============================================================================

const NOTION_ICON_COLORS = ['lightgray', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const

/**
 * Parse icon input and return Notion API icon object
 * Formats:
 * - Emoji: "🎯" -> { type: 'emoji', emoji: '🎯' }
 * - Notion icon: "notion:rocket" or "notion:rocket_blue" -> { type: 'external', external: { url: '...' } }
 * - External URL: "https://..." -> { type: 'external', external: { url: '...' } }
 */
async function parseIcon(iconInput: string): Promise<{ icon: any; validated: boolean; error?: string }> {
  if (!iconInput) return { icon: null, validated: false }

  // Check for emoji (single character or emoji sequence)
  const emojiRegex = /^[\p{Emoji}\p{Emoji_Component}]+$/u
  if (emojiRegex.test(iconInput) && iconInput.length <= 8) {
    return { icon: { type: 'emoji', emoji: iconInput }, validated: true }
  }

  // Check for Notion icon format: notion:name or notion:name_color
  if (iconInput.startsWith('notion:')) {
    const iconSpec = iconInput.slice(7) // Remove 'notion:'
    let iconName: string
    let color: string = 'gray' // Default color

    // Check if color is specified
    const lastUnderscore = iconSpec.lastIndexOf('_')
    if (lastUnderscore > 0) {
      const possibleColor = iconSpec.slice(lastUnderscore + 1)
      if (NOTION_ICON_COLORS.includes(possibleColor as any)) {
        iconName = iconSpec.slice(0, lastUnderscore)
        color = possibleColor
      } else {
        iconName = iconSpec
      }
    } else {
      iconName = iconSpec
    }

    const url = `https://www.notion.so/icons/${iconName}_${color}.svg`

    // Validate the URL exists (with timeout)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(url, { method: 'HEAD', signal: controller.signal })
      clearTimeout(timeoutId)

      if (response.ok) {
        return { icon: { type: 'external', external: { url } }, validated: true }
      } else {
        return { icon: null, validated: false, error: `Icon not found: ${iconName}_${color}` }
      }
    } catch (e) {
      // If validation fails, still try to use it
      return { icon: { type: 'external', external: { url } }, validated: false, error: 'Could not validate icon URL' }
    }
  }

  // Check for external URL
  if (iconInput.startsWith('http://') || iconInput.startsWith('https://')) {
    return { icon: { type: 'external', external: { url: iconInput } }, validated: true }
  }

  return { icon: null, validated: false, error: `Invalid icon format: ${iconInput}` }
}

export interface CustomToolHandler {
  (params: Record<string, any>, httpClient: any): Promise<any>
}

export interface CustomTool {
  definition: Tool
  handler: CustomToolHandler
}

// ============================================================================
// Utility Functions (shared with custom-tools.ts)
// ============================================================================

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
 */
function textToRichText(content: string): any[] {
  const segments: any[] = []

  const patterns = [
    { pattern: /@page\[([^\]]+)\]\(([^)#]+)#([^)]+)\)/g, type: 'page_anchor' },
    { pattern: /@page\[([^\]]+)\]\(([^)]+)\)/g, type: 'page' },
    { pattern: /@db\[([^\]]+)\]\(([^)]+)\)/g, type: 'database' },
    { pattern: /@user\[([^\]]+)\]\(([^)]+)\)/g, type: 'user' },
    { pattern: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' },
    { pattern: /\*\*([^*]+)\*\*/g, type: 'bold' },
    { pattern: /(?<!\*)\*([^*]+)\*(?!\*)/g, type: 'italic' },
    { pattern: /~~([^~]+)~~/g, type: 'strikethrough' },
    { pattern: /`([^`]+)`/g, type: 'code' },
  ]

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

  for (const { pattern, type } of patterns) {
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

      spans.push({ start, end, content: innerContent, annotations, link, mentionType, mentionId, blockAnchor })
    }
  }

  spans.sort((a, b) => a.start - b.start)

  const filteredSpans: Span[] = []
  let lastEnd = 0
  for (const span of spans) {
    if (span.start >= lastEnd) {
      filteredSpans.push(span)
      lastEnd = span.end
    }
  }

  let currentPos = 0
  for (const span of filteredSpans) {
    if (span.start > currentPos) {
      const plainText = content.substring(currentPos, span.start)
      if (plainText) {
        segments.push({ type: 'text', text: { content: plainText } })
      }
    }

    if (span.mentionType && span.mentionId) {
      if (span.blockAnchor) {
        const notionUrl = `https://www.notion.so/${span.mentionId.replace(/-/g, '')}#${span.blockAnchor.replace(/-/g, '')}`
        segments.push({ type: 'text', text: { content: span.content, link: { url: notionUrl } } })
      } else if (span.mentionType === 'page') {
        segments.push({ type: 'mention', mention: { type: 'page', page: { id: span.mentionId } } })
      } else if (span.mentionType === 'database') {
        segments.push({ type: 'mention', mention: { type: 'database', database: { id: span.mentionId } } })
      } else if (span.mentionType === 'user') {
        segments.push({ type: 'mention', mention: { type: 'user', user: { id: span.mentionId } } })
      }
    } else {
      const segment: RichTextSegment = { type: 'text', text: { content: span.content } }
      if (Object.keys(span.annotations).length > 0) segment.annotations = span.annotations
      if (span.link) segment.text.link = { url: span.link }
      segments.push(segment)
    }
    currentPos = span.end
  }

  if (currentPos < content.length) {
    const remaining = content.substring(currentPos)
    if (remaining) {
      segments.push({ type: 'text', text: { content: remaining } })
    }
  }

  if (segments.length === 0) {
    return [{ type: 'text', text: { content } }]
  }

  return segments
}

function richTextToPlain(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return ''
  return richText.map(rt => rt.plain_text || rt.text?.content || '').join('')
}

// ============================================================================
// Notion URL Parsing
// ============================================================================

interface ParsedNotionUrl {
  page_id: string | null
  block_id: string | null
  is_valid: boolean
  error?: string
}

/**
 * Parse a Notion URL or ID to extract page_id and optional block_id
 * Supports formats:
 * - UUID: 2b0b4417f9cb8060b10fca928cc67725 or 2b0b4417-f9cb-8060-b10f-ca928cc67725
 * - Page URL: https://www.notion.so/workspace/Page-Title-2b0b4417f9cb8060b10fca928cc67725
 * - Block link: https://www.notion.so/workspace/Page-Title-2b0b4417f9cb8060b10fca928cc67725?source=copy_link#2e0b4417f9cb80388cafd3d440c75a4b
 * - Short ID: page_id#block_id
 */
function parseNotionUrl(input: string): ParsedNotionUrl {
  if (!input) return { page_id: null, block_id: null, is_valid: false, error: 'Empty input' }

  const normalizeId = (id: string): string => {
    // Remove dashes and ensure lowercase
    const clean = id.replace(/-/g, '').toLowerCase()
    // Verify it's a valid 32-char hex string
    if (/^[a-f0-9]{32}$/.test(clean)) {
      // Convert to UUID format with dashes
      return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`
    }
    return id // Return as-is if not a valid UUID
  }

  // Check for short format: page_id#block_id or just block_id
  if (input.includes('#') && !input.startsWith('http')) {
    const [pageIdPart, blockIdPart] = input.split('#')
    const pageId = pageIdPart ? normalizeId(pageIdPart) : null
    const blockId = blockIdPart ? normalizeId(blockIdPart) : null
    return { page_id: pageId, block_id: blockId, is_valid: !!pageId || !!blockId }
  }

  // Check if it's a plain UUID (with or without dashes)
  const uuidPattern = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i
  if (uuidPattern.test(input)) {
    return { page_id: normalizeId(input), block_id: null, is_valid: true }
  }

  // Parse Notion URL
  try {
    const url = new URL(input)
    if (!url.hostname.includes('notion.so')) {
      return { page_id: null, block_id: null, is_valid: false, error: 'Not a Notion URL' }
    }

    // Extract page ID from path
    // Format: /workspace/Page-Title-{page_id} or /{page_id}
    const pathParts = url.pathname.split('/')
    let pageId: string | null = null

    for (const part of pathParts.reverse()) {
      if (!part) continue
      // Look for 32-char hex at end of path segment
      const match = part.match(/([a-f0-9]{32})$/i)
      if (match) {
        pageId = normalizeId(match[1])
        break
      }
      // Also check for UUID with dashes
      const uuidMatch = part.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i)
      if (uuidMatch) {
        pageId = normalizeId(uuidMatch[1])
        break
      }
    }

    // Extract block ID from hash fragment
    let blockId: string | null = null
    if (url.hash) {
      const hashValue = url.hash.slice(1) // Remove leading #
      if (/^[a-f0-9]{32}$/i.test(hashValue) || uuidPattern.test(hashValue)) {
        blockId = normalizeId(hashValue)
      }
    }

    if (!pageId && !blockId) {
      return { page_id: null, block_id: null, is_valid: false, error: 'Could not extract page or block ID from URL' }
    }

    return { page_id: pageId, block_id: blockId, is_valid: true }
  } catch (e) {
    // Not a valid URL, try to extract IDs from the string
    const hexMatch = input.match(/([a-f0-9]{32})/gi)
    if (hexMatch && hexMatch.length > 0) {
      const pageId = normalizeId(hexMatch[0])
      const blockId = hexMatch.length > 1 ? normalizeId(hexMatch[1]) : null
      return { page_id: pageId, block_id: blockId, is_valid: true }
    }
    return { page_id: null, block_id: null, is_valid: false, error: 'Invalid input format' }
  }
}

function dateMentionRichText(dateStr: string): any[] {
  return [{
    type: 'mention',
    mention: { type: 'date', date: { start: dateStr, end: null, time_zone: null } }
  }]
}

function hasDateMention(richText: any[], dateStr: string): boolean {
  if (!richText || !Array.isArray(richText)) return false
  return richText.some(rt =>
    rt.type === 'mention' && rt.mention?.type === 'date' && rt.mention?.date?.start?.startsWith(dateStr)
  )
}

// Section configuration
interface SectionConfig {
  icon: { type: 'external'; external: { url: string } }
  color: string
  aliases: string[]
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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, ' ').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

function matchesSectionName(text: string, sectionName: string): boolean {
  const normalizedText = normalizeText(text)
  const normalizedSection = normalizeText(sectionName)
  if (normalizedText.includes(normalizedSection)) return true
  const config = SECTION_CONFIGS[sectionName.toLowerCase()]
  if (config?.aliases) {
    for (const alias of config.aliases) {
      if (normalizedText.includes(normalizeText(alias))) return true
    }
  }
  return false
}

function getBlockText(block: any): string | null {
  const type = block.type
  switch (type) {
    case 'callout': return richTextToPlain(block.callout?.rich_text || [])
    case 'heading_1': return richTextToPlain(block.heading_1?.rich_text || [])
    case 'heading_2': return richTextToPlain(block.heading_2?.rich_text || [])
    case 'heading_3': return richTextToPlain(block.heading_3?.rich_text || [])
    case 'toggle': return richTextToPlain(block.toggle?.rich_text || [])
    case 'paragraph':
      const richText = block.paragraph?.rich_text || []
      if (richText.length > 0 && richText[0]?.annotations?.bold) return richTextToPlain(richText)
      return null
    default: return null
  }
}

function isSectionHeader(block: any): boolean {
  const type = block.type
  if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') return true
  if (type === 'callout') {
    const richText = block.callout?.rich_text || []
    return richText.some((rt: any) => rt.annotations?.bold)
  }
  if (type === 'paragraph') {
    const richText = block.paragraph?.rich_text || []
    return richText.length > 0 && richText[0]?.annotations?.bold
  }
  return false
}

function findSectionBlock(blocks: any[], sectionName: string): { block: any; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const text = getBlockText(block)
    if (text && matchesSectionName(text, sectionName)) return { block, index: i }
  }
  return null
}

function getSectionBlocks(blocks: any[], sectionIndex: number): any[] {
  const sectionBlocks: any[] = []
  for (let i = sectionIndex + 1; i < blocks.length; i++) {
    const block = blocks[i]
    if (isSectionHeader(block)) break
    sectionBlocks.push(block)
  }
  return sectionBlocks
}

/**
 * Find the last button block at the end of a page's blocks.
 * Returns the block ID to insert after (the last button), or null if no buttons at end.
 */
function findLastButtonBlock(blocks: any[]): string | null {
  // Scan from the end to find consecutive button blocks
  let lastButtonId: string | null = null
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'button') {
      lastButtonId = blocks[i].id
    } else {
      // Stop as soon as we hit a non-button block
      break
    }
  }
  return lastButtonId
}

/**
 * Find the block ID after which to insert activity log entries.
 * This accounts for button blocks that should remain at the end of a section.
 * Returns the ID of the last button block after the section header, or the section header ID if no buttons.
 */
function findActivityLogInsertAfter(blocks: any[], sectionIndex: number): string {
  const sectionBlock = blocks[sectionIndex]
  const sectionBlocks = getSectionBlocks(blocks, sectionIndex)

  // Look for button blocks at the end of the section
  let lastButtonId: string | null = null
  for (let i = sectionBlocks.length - 1; i >= 0; i--) {
    if (sectionBlocks[i].type === 'button') {
      lastButtonId = sectionBlocks[i].id
    } else {
      // Stop as soon as we hit a non-button block
      break
    }
  }

  // If there are buttons at the end, insert after the last one
  // Otherwise, insert after the section header
  return lastButtonId || sectionBlock.id
}

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
  if (children && children.length > 0) callout.callout.children = children
  return callout
}

function parseTableRow(line: string): string[] {
  // Parse a markdown table row: | cell1 | cell2 | cell3 |
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []

  // Split by | and filter out empty first/last elements
  const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim())
  return cells
}

function isTableSeparator(line: string): boolean {
  // Detect markdown table separator: |---|---|---|
  const trimmed = line.trim()
  return /^\|[\s\-:]+\|/.test(trimmed) && trimmed.split('|').every(part => /^[\s\-:]*$/.test(part))
}

function parseStructuredContent(content: string): any[] {
  const lines = content.split('\n')
  const children: any[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    let block: any = null

    // Skip "table:" prefix line (optional prefix before markdown tables)
    if (trimmed.toLowerCase() === 'table:' || trimmed.toLowerCase() === 'table') {
      // Check if next line is a table row
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        i++
        continue
      }
    }

    // Check for table (starts with |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableRows: string[][] = []
      let hasColumnHeader = false
      let isFirstRow = true

      // Collect all consecutive table rows
      while (i < lines.length) {
        const currentLine = lines[i].trim()
        if (!currentLine.startsWith('|')) break

        // Skip separator row (|---|---|) but mark headers
        if (isTableSeparator(currentLine)) {
          if (isFirstRow || tableRows.length === 1) {
            hasColumnHeader = true
          }
          i++
          continue
        }

        const cells = parseTableRow(currentLine)
        if (cells.length > 0) {
          tableRows.push(cells)
          isFirstRow = false
        }
        i++
      }

      if (tableRows.length > 0) {
        const tableWidth = Math.max(...tableRows.map(row => row.length))

        // Create table block with children
        block = {
          type: 'table',
          table: {
            table_width: tableWidth,
            has_column_header: hasColumnHeader,
            has_row_header: false,
            children: tableRows.map(row => ({
              type: 'table_row',
              table_row: {
                cells: row.map(cell => textToRichText(cell))
              }
            }))
          }
        }
      }

      if (block) children.push(block)
      continue
    }

    if (trimmed === '---') {
      block = { type: 'divider', divider: {} }
    } else if (trimmed.startsWith('h1:')) {
      block = { type: 'heading_1', heading_1: { rich_text: textToRichText(trimmed.substring(3).trim()) } }
    } else if (trimmed.startsWith('h2:')) {
      block = { type: 'heading_2', heading_2: { rich_text: textToRichText(trimmed.substring(3).trim()) } }
    } else if (trimmed.startsWith('h3:')) {
      block = { type: 'heading_3', heading_3: { rich_text: textToRichText(trimmed.substring(3).trim()) } }
    } else if (trimmed.startsWith('- ')) {
      block = { type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(trimmed.substring(2)) } }
    } else if (/^\d+\.\s/.test(trimmed)) {
      block = { type: 'numbered_list_item', numbered_list_item: { rich_text: textToRichText(trimmed.replace(/^\d+\.\s/, '')) } }
    } else if (trimmed.startsWith('[x] ') || trimmed.startsWith('[X] ')) {
      block = { type: 'to_do', to_do: { rich_text: textToRichText(trimmed.substring(4)), checked: true } }
    } else if (trimmed.startsWith('[] ')) {
      block = { type: 'to_do', to_do: { rich_text: textToRichText(trimmed.substring(3)), checked: false } }
    } else if (trimmed.startsWith('> ')) {
      block = { type: 'quote', quote: { rich_text: textToRichText(trimmed.substring(2)) } }
    } else if (trimmed.startsWith('!> ') || trimmed.startsWith('callout:') || trimmed.startsWith('callout[')) {
      // Callout: !> text, callout: text, or callout[icon,color]: text
      let text = ''
      let icon = '💡'
      let color = 'gray_background'

      // Check for callout[icon,color]: syntax first
      const calloutMatch = trimmed.match(/^callout\[([^,\]]+)(?:,([^\]]+))?\]:\s*(.*)$/)
      if (calloutMatch) {
        icon = calloutMatch[1].trim()
        if (calloutMatch[2]) color = calloutMatch[2].trim() + '_background'
        text = calloutMatch[3].trim()
      } else if (trimmed.startsWith('!> ')) {
        text = trimmed.substring(3)
      } else if (trimmed.startsWith('callout: ')) {
        text = trimmed.substring(9)
      } else if (trimmed.startsWith('callout:')) {
        text = trimmed.substring(8)
      }

      block = {
        type: 'callout',
        callout: {
          rich_text: textToRichText(text),
          icon: icon.startsWith('http')
            ? { type: 'external', external: { url: icon } }
            : { type: 'emoji', emoji: icon },
          color
        }
      }
    } else {
      block = { type: 'paragraph', paragraph: { rich_text: textToRichText(trimmed) } }
    }

    if (block) children.push(block)
    i++
  }

  return children
}

async function fetchBlockChildren(blocks: any[], httpClient: any, maxDepth: number = 3, currentDepth: number = 0): Promise<any[]> {
  if (currentDepth >= maxDepth) return blocks
  for (const block of blocks) {
    if (block.has_children) {
      try {
        const childrenResponse = await httpClient.executeOperation(
          { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
          { block_id: block.id, page_size: 100 }
        )
        const children = childrenResponse.data.results || []
        block.children = await fetchBlockChildren(children, httpClient, maxDepth, currentDepth + 1)
      } catch (e) {
        block.children = []
      }
    }
  }
  return blocks
}

function summarizeBlocks(blocks: any[], indent: number = 0): string[] {
  const summary: string[] = []
  const prefix = '  '.repeat(indent)
  for (const block of blocks) {
    const type = block.type
    let text = ''
    if (block[type]?.rich_text) text = richTextToPlain(block[type].rich_text)
    const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
    const childIndicator = block.children?.length ? ` [${block.children.length} children]` : ''
    summary.push(`${prefix}${type}${preview ? ': ' + preview : ''}${childIndicator}`)
    if (block.children?.length) summary.push(...summarizeBlocks(block.children, indent + 1))
  }
  return summary
}

// ============================================================================
// Fuzzy Matching for Multi-Select and Status Properties
// ============================================================================

/**
 * Calculate similarity score between two strings (0-1)
 * Uses a combination of exact match, prefix match, contains, and character overlap
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()

  // Exact match
  if (s1 === s2) return 1.0

  // One is prefix of the other
  if (s1.startsWith(s2) || s2.startsWith(s1)) return 0.9

  // One contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.8

  // Character-based similarity (Sørensen-Dice coefficient on bigrams)
  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2))
    }
    return bigrams
  }

  const bigrams1 = getBigrams(s1)
  const bigrams2 = getBigrams(s2)

  if (bigrams1.size === 0 || bigrams2.size === 0) return 0

  let intersection = 0
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++
  }

  return (2 * intersection) / (bigrams1.size + bigrams2.size)
}

/**
 * Find the best matching option from a list
 * Returns the best match if similarity >= threshold, otherwise null
 */
function findBestMatch(input: string, options: string[], threshold: number = 0.5): { match: string; score: number } | null {
  let bestMatch: string | null = null
  let bestScore = 0

  for (const option of options) {
    const score = stringSimilarity(input, option)
    if (score > bestScore) {
      bestScore = score
      bestMatch = option
    }
  }

  return bestMatch && bestScore >= threshold ? { match: bestMatch, score: bestScore } : null
}

/**
 * Resolve property values against database schema using fuzzy matching
 * For multi_select and status properties, finds the closest matching option
 */
async function resolvePropertiesWithFuzzyMatch(
  properties: Record<string, any>,
  databaseId: string,
  httpClient: any
): Promise<{ resolved: Record<string, any>; warnings: string[] }> {
  const warnings: string[] = []
  const resolved = { ...properties }

  // Fetch data source schema
  let schema: Record<string, any>
  try {
    const dbResponse = await httpClient.executeOperation(
      { method: 'get', path: '/v1/data_sources/{data_source_id}', operationId: 'retrieve-a-data-source' },
      { data_source_id: databaseId }
    )
    schema = dbResponse.data.properties || {}
  } catch (error: any) {
    // If we can't fetch schema, return properties as-is with detailed error
    const errMsg = error?.data?.message || error?.message || 'Unknown error'
    return { resolved, warnings: [`Could not fetch database schema for fuzzy matching: ${errMsg}`] }
  }

  for (const [propName, propValue] of Object.entries(resolved)) {
    const schemaProp = schema[propName]
    if (!schemaProp) continue

    // Handle multi_select
    if (schemaProp.type === 'multi_select' && propValue?.multi_select) {
      const options = schemaProp.multi_select?.options?.map((o: any) => o.name) || []
      if (options.length === 0) continue

      const resolvedSelects: { name: string }[] = []
      for (const item of propValue.multi_select) {
        const inputName = item.name
        // Check for exact match first
        if (options.includes(inputName)) {
          resolvedSelects.push({ name: inputName })
        } else {
          // Try fuzzy match
          const match = findBestMatch(inputName, options)
          if (match) {
            resolvedSelects.push({ name: match.match })
            warnings.push(`Multi-select "${propName}": "${inputName}" → "${match.match}" (${Math.round(match.score * 100)}% match)`)
          } else {
            // No match found, keep original (Notion will create it or error)
            resolvedSelects.push({ name: inputName })
            warnings.push(`Multi-select "${propName}": "${inputName}" - no close match found`)
          }
        }
      }
      resolved[propName] = { multi_select: resolvedSelects }
    }

    // Handle select
    if (schemaProp.type === 'select' && propValue?.select?.name) {
      const options = schemaProp.select?.options?.map((o: any) => o.name) || []
      if (options.length === 0) continue

      const inputName = propValue.select.name
      if (!options.includes(inputName)) {
        const match = findBestMatch(inputName, options)
        if (match) {
          resolved[propName] = { select: { name: match.match } }
          warnings.push(`Select "${propName}": "${inputName}" → "${match.match}" (${Math.round(match.score * 100)}% match)`)
        } else {
          warnings.push(`Select "${propName}": "${inputName}" - no close match found`)
        }
      }
    }

    // Handle status
    if (schemaProp.type === 'status' && propValue?.status?.name) {
      const groups = schemaProp.status?.groups || []
      const options: string[] = []
      for (const group of groups) {
        for (const opt of group.option_ids || []) {
          const option = schemaProp.status?.options?.find((o: any) => o.id === opt)
          if (option) options.push(option.name)
        }
      }
      // Also add options directly if groups are empty
      if (options.length === 0) {
        options.push(...(schemaProp.status?.options?.map((o: any) => o.name) || []))
      }

      if (options.length === 0) continue

      const inputName = propValue.status.name
      if (!options.includes(inputName)) {
        const match = findBestMatch(inputName, options)
        if (match) {
          resolved[propName] = { status: { name: match.match } }
          warnings.push(`Status "${propName}": "${inputName}" → "${match.match}" (${Math.round(match.score * 100)}% match)`)
        } else {
          warnings.push(`Status "${propName}": "${inputName}" - no close match found`)
        }
      }
    }
  }

  return { resolved, warnings }
}

// ============================================================================
// Unified Tools
// ============================================================================

export const unifiedTools: CustomTool[] = [
  // ============================================================================
  // 1. notion-page - Page Operations
  // ============================================================================
  {
    definition: {
      name: 'notion-page',
      description: 'Unified page operations: get, create, update, or delete Notion pages. Supports full page retrieval with blocks, database page creation with templates, property updates with relation append/remove, and page archiving.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'create', 'update', 'delete'],
            description: 'The operation to perform'
          },
          page_id: {
            type: 'string',
            description: 'Page ID (required for get, update, delete)'
          },
          include_blocks: { type: 'boolean', description: 'Include page block content (default: true)', default: true },
          block_limit: { type: 'number', description: 'Max blocks to retrieve (default: 50)', default: 50 },
          expand_toggles: { type: 'boolean', description: 'Recursively fetch toggle/callout children', default: false },
          max_depth: { type: 'number', description: 'Max depth for nested expansion', default: 3 },
          data_source_id: { type: 'string', description: 'Data source ID for new page (what Notion UI calls "database")' },
          parent_page_id: { type: 'string', description: 'Parent page ID (alternative to data_source_id)' },
          title: { type: 'string', description: 'Page title' },
          template_id: { type: 'string', description: 'Template ID ("default", "none", or specific ID)' },
          icon: { type: 'string', description: 'Page icon: emoji (🎯), notion:name_color (notion:rocket_blue), or external URL' },
          initial_content: { type: 'string', description: 'Initial structured content (h1:, -, [], etc.)' },
          properties: { type: 'object', description: 'Properties to set (Notion API format)', additionalProperties: true },
          relations: {
            type: 'object',
            description: 'Relation updates with mode support',
            additionalProperties: {
              type: 'object',
              properties: {
                ids: { type: 'array', items: { type: 'string' } },
                mode: { type: 'string', enum: ['append', 'remove', 'replace'] }
              }
            }
          },
          archive: { type: 'boolean', description: 'Archive instead of permanent delete', default: true }
        },
        required: ['action']
      }
    },
    handler: async (params, httpClient) => {
      const { action, page_id, include_blocks = true, block_limit = 50, expand_toggles = false, max_depth = 3,
              data_source_id, parent_page_id, title, template_id, icon, initial_content, properties = {}, relations, archive = true } = params

      switch (action) {
        case 'get': {
          if (!page_id) return { success: false, error: 'page_id required for get' }

          const pageResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/pages/{page_id}', operationId: 'retrieve-a-page' },
            { page_id }
          )
          const page = pageResponse.data

          const extractedProps: Record<string, any> = {}
          const linkedDatabases: string[] = []

          for (const [name, prop] of Object.entries(page.properties || {})) {
            const p = prop as any
            switch (p.type) {
              case 'title': extractedProps[name] = richTextToPlain(p.title); break
              case 'rich_text': extractedProps[name] = richTextToPlain(p.rich_text); break
              case 'select': extractedProps[name] = p.select?.name || null; break
              case 'multi_select': extractedProps[name] = p.multi_select?.map((s: any) => s.name) || []; break
              case 'status': extractedProps[name] = p.status?.name || null; break
              case 'date': extractedProps[name] = p.date?.start || null; break
              case 'checkbox': extractedProps[name] = p.checkbox; break
              case 'number': extractedProps[name] = p.number; break
              case 'url': extractedProps[name] = p.url; break
              case 'relation':
                extractedProps[name] = p.relation?.map((r: any) => r.id) || []
                if (p.relation?.length > 0) linkedDatabases.push(name)
                break
              case 'people': extractedProps[name] = p.people?.map((person: any) => person.name || person.id) || []; break
              default: extractedProps[name] = `[${p.type}]`
            }
          }

          let blocks: any[] = []
          let blockSummary: string[] = []

          if (include_blocks) {
            try {
              const blocksResponse = await httpClient.executeOperation(
                { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
                { block_id: page_id, page_size: block_limit }
              )
              blocks = blocksResponse.data.results || []
              if (expand_toggles) blocks = await fetchBlockChildren(blocks, httpClient, max_depth, 0)
              blockSummary = summarizeBlocks(blocks)
            } catch (e) {
              blockSummary = ['[Error fetching blocks]']
            }
          }

          return {
            success: true,
            id: page.id,
            url: page.url,
            created_time: page.created_time,
            last_edited_time: page.last_edited_time,
            parent: page.parent,
            properties: extractedProps,
            linked_relations: linkedDatabases,
            block_summary: blockSummary,
            blocks: blocks.slice(0, 10)
          }
        }

        case 'create': {
          if (!data_source_id && !parent_page_id) return { success: false, error: 'data_source_id or parent_page_id required' }
          if (!title) return { success: false, error: 'title required for create' }

          let resolvedProperties = properties || {}
          let fuzzyWarnings: string[] = []

          // Apply fuzzy matching for multi-select/status/select properties
          if (data_source_id && Object.keys(resolvedProperties).length > 0) {
            const fuzzyResult = await resolvePropertiesWithFuzzyMatch(resolvedProperties, data_source_id, httpClient)
            resolvedProperties = fuzzyResult.resolved
            fuzzyWarnings = fuzzyResult.warnings
          }

          // Parse icon if provided
          let parsedIcon: any = null
          let iconWarning: string | undefined
          if (icon) {
            const iconResult = await parseIcon(icon)
            parsedIcon = iconResult.icon
            if (iconResult.error) iconWarning = iconResult.error
          }

          const createProps: any = {
            title: { title: textToRichText(title) },
            ...resolvedProperties
          }

          let page: any

          // Build parent object - use new format for data sources, legacy for page parents
          const parentObj = data_source_id
            ? { type: 'data_source_id', data_source_id }
            : { page_id: parent_page_id }

          if (template_id && data_source_id) {
            try {
              const templateBody: any = {
                parent: parentObj,
                properties: createProps
              }
              if (parsedIcon) templateBody.icon = parsedIcon
              if (template_id === 'default') templateBody.template = { type: 'default' }
              else if (template_id === 'none') templateBody.template = { type: 'none' }
              else templateBody.template = { type: 'template_id', template_id }

              const createResponse = await httpClient.rawRequest('post', '/v1/pages', templateBody)
              page = createResponse.data
            } catch (error: any) {
              if (error.status === 400 || error.status === 404) {
                // Fallback: try without template
                const fallbackBody: any = { parent: parentObj, properties: createProps }
                if (parsedIcon) fallbackBody.icon = parsedIcon
                const createResponse = await httpClient.executeOperation(
                  { method: 'post', path: '/v1/pages', operationId: 'post-page' },
                  fallbackBody
                )
                page = createResponse.data
              } else throw error
            }
          } else {
            const createBody: any = { parent: parentObj, properties: createProps }
            if (parsedIcon) createBody.icon = parsedIcon
            const createResponse = await httpClient.executeOperation(
              { method: 'post', path: '/v1/pages', operationId: 'post-page' },
              createBody
            )
            page = createResponse.data
          }

          if (initial_content && !template_id) {
            const children = parseStructuredContent(initial_content)
            if (children.length > 0) {
              await httpClient.executeOperation(
                { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
                { block_id: page.id, children }
              )
            }
          }

          const result: any = { success: true, action: 'created', page_id: page.id, url: page.url, title }
          if (fuzzyWarnings.length > 0) result.fuzzy_matches = fuzzyWarnings
          if (iconWarning) result.icon_warning = iconWarning
          return result
        }

        case 'update': {
          if (!page_id) return { success: false, error: 'page_id required for update' }

          let finalProperties: any = { ...properties }
          let fuzzyWarnings: string[] = []

          // Fetch page to get parent data_source_id (for fuzzy matching) and existing relations
          // Note: Notion response still uses parent.database_id even though it's the data_source_id
          let pageData: any = null
          const needsPageData = (relations && Object.keys(relations).length > 0) || Object.keys(finalProperties).length > 0
          if (needsPageData) {
            const pageResponse = await httpClient.executeOperation(
              { method: 'get', path: '/v1/pages/{page_id}', operationId: 'retrieve-a-page' },
              { page_id }
            )
            pageData = pageResponse.data
          }

          // Apply fuzzy matching for multi-select/status/select properties
          const parentDbId = pageData?.parent?.database_id
          if (Object.keys(finalProperties).length > 0) {
            if (parentDbId) {
              const fuzzyResult = await resolvePropertiesWithFuzzyMatch(finalProperties, parentDbId, httpClient)
              finalProperties = fuzzyResult.resolved
              fuzzyWarnings = fuzzyResult.warnings
            } else if (pageData?.parent) {
              // Page is not in a database (e.g., standalone page)
              fuzzyWarnings.push(`Fuzzy matching skipped: page parent is ${pageData.parent.type || 'unknown'}, not a database`)
            }
          }

          if (relations && Object.keys(relations).length > 0 && pageData) {
            for (const [propName, config] of Object.entries(relations) as [string, { ids: string[], mode?: string }][]) {
              const mode = config.mode || 'replace'
              const newIds = config.ids || []
              const existingProp = pageData.properties?.[propName]
              const existingIds: string[] = existingProp?.relation?.map((r: any) => r.id) || []

              let finalIds: string[]
              if (mode === 'append') finalIds = [...new Set([...existingIds, ...newIds])]
              else if (mode === 'remove') finalIds = existingIds.filter(id => !newIds.includes(id))
              else finalIds = newIds

              finalProperties[propName] = { relation: finalIds.map(id => ({ id })) }
            }
          }

          // Parse icon if provided
          let parsedIcon: any = null
          let iconWarning: string | undefined
          if (icon) {
            const iconResult = await parseIcon(icon)
            parsedIcon = iconResult.icon
            if (iconResult.error) iconWarning = iconResult.error
          }

          const updateBody: any = { page_id, properties: finalProperties }
          if (parsedIcon) updateBody.icon = parsedIcon

          const updateResponse = await httpClient.executeOperation(
            { method: 'patch', path: '/v1/pages/{page_id}', operationId: 'patch-page' },
            updateBody
          )

          const updateResult: any = { success: true, action: 'updated', page_id: updateResponse.data.id, url: updateResponse.data.url, updated_properties: Object.keys(finalProperties) }
          if (fuzzyWarnings.length > 0) updateResult.fuzzy_matches = fuzzyWarnings
          if (iconWarning) updateResult.icon_warning = iconWarning
          return updateResult
        }

        case 'delete': {
          if (!page_id) return { success: false, error: 'page_id required for delete' }

          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/pages/{page_id}', operationId: 'patch-page' },
            { page_id, archived: archive }
          )

          return { success: true, action: archive ? 'archived' : 'deleted', page_id }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  },

  // ============================================================================
  // 2. notion-blocks - Block Operations
  // ============================================================================
  {
    definition: {
      name: 'notion-blocks',
      description: 'Unified block operations: get, get-block, append, update, delete, replace, or table CRUD. Supports structured content syntax, section operations, inline formatting, table row/column operations, and appending to any container block (not just pages).',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'get-block', 'append', 'update', 'delete', 'replace-section', 'add-activity-log', 'complete-todo', 'add-table-row', 'update-table-row', 'add-table-column'],
            description: 'The operation to perform'
          },
          page_id: { type: 'string', description: 'Page ID (for get, append, delete, replace-section, add-activity-log, complete-todo)' },
          block_id: { type: 'string', description: 'Block ID (for get children, get-block, append to container, update single block)' },
          url: { type: 'string', description: 'Notion URL or block link (for get-block). Extracts page_id and block_id from URL hash.' },
          context_before: { type: 'number', description: 'Number of sibling blocks to fetch before target (for get-block)', default: 0 },
          context_after: { type: 'number', description: 'Number of sibling blocks to fetch after target (for get-block)', default: 0 },
          include_children: { type: 'boolean', description: 'Fetch nested children of target block (for get-block)', default: true },
          max_depth: { type: 'number', description: 'Max depth for nested children (for get-block)', default: 2 },
          table_id: { type: 'string', description: 'Table block ID (for table operations)' },
          row_id: { type: 'string', description: 'Table row block ID (for update-table-row)' },
          row_cells: { type: 'array', items: { type: 'string' }, description: 'Cell values for table row (add-table-row, update-table-row)' },
          column_name: { type: 'string', description: 'Column header name (for add-table-column)' },
          column_default: { type: 'string', description: 'Default value for new column cells', default: '' },
          limit: { type: 'number', description: 'Max blocks to retrieve', default: 100 },
          content: { type: 'string', description: 'Structured content (h1:, -, [], > etc.)' },
          after: { type: 'string', description: 'Block ID to insert after' },
          section_name: { type: 'string', description: 'Section name to find and replace' },
          block_ids: { type: 'array', items: { type: 'string' }, description: 'Block IDs to delete' },
          clear_all: { type: 'boolean', description: 'Delete all blocks from page', default: false },
          checked: { type: 'boolean', description: 'For to_do blocks: checked state' },
          entry: { type: 'string', description: 'Activity log entry text' },
          timezone: { type: 'string', description: 'Timezone abbreviation', default: 'ET' },
          item_text: { type: 'string', description: 'Text of todo item to complete (partial match)' },
          completion_note: { type: 'string', description: 'Note to add to activity log' }
        },
        required: ['action']
      }
    },
    handler: async (params, httpClient) => {
      const { action, page_id, block_id, url, context_before = 0, context_after = 0, include_children = true, max_depth = 2,
              limit = 100, content, after, section_name, block_ids, clear_all = false,
              checked, entry, timezone = 'ET', item_text, completion_note,
              table_id, row_id, row_cells, column_name, column_default = '' } = params

      switch (action) {
        case 'get': {
          const targetId = block_id || page_id
          if (!targetId) return { success: false, error: 'page_id or block_id required' }

          const response = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
            { block_id: targetId, page_size: limit }
          )

          return { success: true, blocks: response.data.results, has_more: response.data.has_more }
        }

        case 'get-block': {
          // Parse URL if provided to extract page_id and block_id
          let targetBlockId = block_id
          let parentPageId = page_id

          if (url) {
            const parsed = parseNotionUrl(url)
            if (!parsed.is_valid) {
              return { success: false, error: parsed.error || 'Could not parse URL' }
            }
            if (parsed.block_id) targetBlockId = parsed.block_id
            if (parsed.page_id) parentPageId = parsed.page_id
          }

          if (!targetBlockId) {
            return { success: false, error: 'block_id or url with block hash required' }
          }

          // Fetch the target block
          let targetBlock: any
          try {
            const blockResponse = await httpClient.executeOperation(
              { method: 'get', path: '/v1/blocks/{block_id}', operationId: 'retrieve-a-block' },
              { block_id: targetBlockId }
            )
            targetBlock = blockResponse.data
          } catch (error: any) {
            return { success: false, error: `Block not found: ${error?.message || error}` }
          }

          const result: any = {
            success: true,
            block: targetBlock,
            block_id: targetBlock.id,
            type: targetBlock.type,
            has_children: targetBlock.has_children,
            parent: targetBlock.parent
          }

          // Extract text content for convenience
          const blockType = targetBlock.type
          if (targetBlock[blockType]?.rich_text) {
            result.text = richTextToPlain(targetBlock[blockType].rich_text)
          }

          // Fetch children if block has them and include_children is true
          if (include_children && targetBlock.has_children) {
            try {
              const childrenResponse = await httpClient.executeOperation(
                { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
                { block_id: targetBlockId, page_size: 100 }
              )
              let children = childrenResponse.data.results || []

              // Recursively fetch nested children up to max_depth
              if (max_depth > 1) {
                children = await fetchBlockChildren(children, httpClient, max_depth, 1)
              }

              result.children = children
              result.children_count = children.length
            } catch (e) {
              result.children = []
              result.children_error = 'Could not fetch children'
            }
          }

          // Fetch sibling context if requested
          if ((context_before > 0 || context_after > 0) && parentPageId) {
            try {
              // Get parent's children to find siblings
              const parentId = targetBlock.parent?.page_id || targetBlock.parent?.block_id || parentPageId
              const siblingsResponse = await httpClient.executeOperation(
                { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
                { block_id: parentId, page_size: 100 }
              )
              const siblings = siblingsResponse.data.results || []

              // Find target block's position
              const targetIndex = siblings.findIndex((b: any) => b.id === targetBlockId)

              if (targetIndex !== -1) {
                if (context_before > 0) {
                  const startIdx = Math.max(0, targetIndex - context_before)
                  result.siblings_before = siblings.slice(startIdx, targetIndex)
                }
                if (context_after > 0) {
                  const endIdx = Math.min(siblings.length, targetIndex + 1 + context_after)
                  result.siblings_after = siblings.slice(targetIndex + 1, endIdx)
                }
                result.position_in_parent = targetIndex
                result.total_siblings = siblings.length
              }
            } catch (e) {
              result.context_error = 'Could not fetch sibling context'
            }
          }

          return result
        }

        case 'append': {
          // Support appending to any container block (page or block)
          const parentId = block_id || page_id
          if (!parentId) return { success: false, error: 'page_id or block_id required for append' }
          if (!content) return { success: false, error: 'content required' }

          const children = parseStructuredContent(content)
          if (children.length === 0) return { success: false, error: 'No content to append' }

          const requestBody: any = { block_id: parentId, children }
          if (after) requestBody.after = after

          const response = await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
            requestBody
          )

          return {
            success: true,
            parent_id: parentId,
            parent_type: block_id ? 'block' : 'page',
            blocks_added: children.length,
            block_ids: response.data.results?.map((r: any) => r.id)
          }
        }

        case 'update': {
          if (!block_id) return { success: false, error: 'block_id required' }
          if (!content) return { success: false, error: 'content required' }

          const blockResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}', operationId: 'retrieve-a-block' },
            { block_id }
          )

          const block = blockResponse.data
          const blockType = block.type
          const updatePayload: any = { block_id }
          const richText = textToRichText(content)

          switch (blockType) {
            case 'paragraph': updatePayload.paragraph = { rich_text: richText }; break
            case 'heading_1': updatePayload.heading_1 = { rich_text: richText }; break
            case 'heading_2': updatePayload.heading_2 = { rich_text: richText }; break
            case 'heading_3': updatePayload.heading_3 = { rich_text: richText }; break
            case 'bulleted_list_item': updatePayload.bulleted_list_item = { rich_text: richText }; break
            case 'numbered_list_item': updatePayload.numbered_list_item = { rich_text: richText }; break
            case 'to_do':
              updatePayload.to_do = { rich_text: richText }
              if (typeof checked === 'boolean') updatePayload.to_do.checked = checked
              break
            case 'quote': updatePayload.quote = { rich_text: richText }; break
            case 'callout': updatePayload.callout = { rich_text: richText }; break
            case 'toggle': updatePayload.toggle = { rich_text: richText }; break
            default: return { success: false, error: `Block type "${blockType}" not supported` }
          }

          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
            updatePayload
          )

          return { success: true, block_id, block_type: blockType }
        }

        case 'delete': {
          if (!page_id && !block_ids?.length) return { success: false, error: 'page_id with section_name/clear_all, or block_ids required' }

          let idsToDelete: string[] = []

          if (block_ids?.length) {
            idsToDelete = block_ids
          } else if (page_id) {
            const blocksResponse = await httpClient.executeOperation(
              { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
              { block_id: page_id, page_size: 100 }
            )
            const blocks = blocksResponse.data.results || []

            if (clear_all) {
              idsToDelete = blocks.map((b: any) => b.id)
            } else if (section_name) {
              let inSection = false
              for (const block of blocks) {
                const text = getBlockText(block)
                if (text && matchesSectionName(text, section_name)) {
                  inSection = true
                  idsToDelete.push(block.id)
                  continue
                }
                if (inSection && isSectionHeader(block)) break
                if (inSection) idsToDelete.push(block.id)
              }
              if (idsToDelete.length === 0) return { success: false, error: `Section "${section_name}" not found` }
            }
          }

          const deleted: string[] = []
          for (const id of idsToDelete) {
            try {
              await httpClient.executeOperation(
                { method: 'delete', path: '/v1/blocks/{block_id}', operationId: 'delete-a-block' },
                { block_id: id }
              )
              deleted.push(id)
            } catch (e) { /* continue */ }
          }

          return { success: true, deleted_count: deleted.length, deleted_block_ids: deleted }
        }

        case 'replace-section': {
          if (!page_id) return { success: false, error: 'page_id required' }
          if (!section_name) return { success: false, error: 'section_name required' }
          if (!content) return { success: false, error: 'content required' }

          const blocksResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
            { block_id: page_id, page_size: 100 }
          )
          const blocks = blocksResponse.data.results || []

          let insertAfterId: string | null = null
          const blocksToDelete: string[] = []
          let inSection = false
          let previousBlockId: string | null = null

          for (const block of blocks) {
            const text = getBlockText(block)
            if (text && matchesSectionName(text, section_name)) {
              inSection = true
              insertAfterId = previousBlockId
              blocksToDelete.push(block.id)
              continue
            }
            if (inSection && isSectionHeader(block)) break
            if (inSection) blocksToDelete.push(block.id)
            previousBlockId = block.id
          }

          if (blocksToDelete.length === 0) return { success: false, error: `Section "${section_name}" not found` }

          for (const id of blocksToDelete) {
            try {
              await httpClient.executeOperation(
                { method: 'delete', path: '/v1/blocks/{block_id}', operationId: 'delete-a-block' },
                { block_id: id }
              )
            } catch (e) { /* continue */ }
          }

          const children = parseStructuredContent(content)
          const insertPayload: any = { block_id: page_id, children }
          if (insertAfterId) insertPayload.after = insertAfterId

          const response = await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
            insertPayload
          )

          return { success: true, deleted_count: blocksToDelete.length, inserted_count: children.length, inserted_block_ids: response.data.results?.map((r: any) => r.id) }
        }

        case 'add-activity-log': {
          if (!page_id) return { success: false, error: 'page_id required' }
          if (!entry) return { success: false, error: 'entry required' }

          const now = new Date()
          const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timezone}`
          const logEntry = `${timeStr} — ${entry}`

          const blocksResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
            { block_id: page_id, page_size: 100 }
          )
          const blocks = blocksResponse.data.results || []

          const activityLogSection = findSectionBlock(blocks, 'Activity Log')

          if (!activityLogSection) {
            // No Activity Log section exists - create one
            // Check if there are button blocks at the end that we should insert before
            const lastButtonId = findLastButtonBlock(blocks)
            const insertPayload: any = {
              block_id: page_id,
              children: [
                createSectionCallout('Activity Log'),
                { type: 'toggle', toggle: { rich_text: dateMentionRichText(dateStr), children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }] } }
              ]
            }

            // If there are buttons at the end, find the block before the first button to insert after
            if (lastButtonId) {
              // Find the first button in the trailing sequence to insert before it
              let firstButtonIndex = blocks.length - 1
              for (let i = blocks.length - 1; i >= 0; i--) {
                if (blocks[i].type === 'button') {
                  firstButtonIndex = i
                } else {
                  break
                }
              }
              // Insert after the block before the first button (or at start if buttons are first)
              if (firstButtonIndex > 0) {
                insertPayload.after = blocks[firstButtonIndex - 1].id
              }
            }

            await httpClient.executeOperation(
              { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
              insertPayload
            )
            return { success: true, entry: logEntry, date: dateStr, section_created: true }
          }

          const sectionBlocks = getSectionBlocks(blocks, activityLogSection.index)
          let todayToggleId: string | null = null

          for (const block of sectionBlocks) {
            if (block.type === 'toggle') {
              const toggleRichText = block.toggle?.rich_text || []
              if (hasDateMention(toggleRichText, dateStr) || richTextToPlain(toggleRichText) === dateStr) {
                todayToggleId = block.id
                break
              }
            }
          }

          if (todayToggleId) {
            await httpClient.executeOperation(
              { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
              { block_id: todayToggleId, children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }] }
            )
          } else {
            // Create new toggle for today - insert after any button blocks in the section
            const insertAfterId = findActivityLogInsertAfter(blocks, activityLogSection.index)
            await httpClient.executeOperation(
              { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
              {
                block_id: page_id, after: insertAfterId,
                children: [{ type: 'toggle', toggle: { rich_text: dateMentionRichText(dateStr), children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }] } }]
              }
            )
          }

          return { success: true, entry: logEntry, date: dateStr, section_created: false }
        }

        case 'complete-todo': {
          if (!page_id) return { success: false, error: 'page_id required' }
          if (!item_text) return { success: false, error: 'item_text required' }

          const blocksResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
            { block_id: page_id, page_size: 100 }
          )
          const blocks = blocksResponse.data.results || []

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

          if (!targetBlock) return { success: false, error: `No todo item found matching "${item_text}"` }

          const itemFullText = richTextToPlain(targetBlock.to_do?.rich_text || [])

          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
            { block_id: targetBlock.id, to_do: { checked: true } }
          )

          const now = new Date()
          const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timezone}`
          const logEntry = completion_note ? `${timeStr} — ✓ ${itemFullText} (${completion_note})` : `${timeStr} — ✓ ${itemFullText}`

          const activityLogSection = findSectionBlock(blocks, 'Activity Log')
          if (activityLogSection) {
            const sectionBlocks = getSectionBlocks(blocks, activityLogSection.index)
            let todayToggleId: string | null = null
            for (const block of sectionBlocks) {
              if (block.type === 'toggle') {
                const toggleRichText = block.toggle?.rich_text || []
                if (hasDateMention(toggleRichText, dateStr) || richTextToPlain(toggleRichText) === dateStr) {
                  todayToggleId = block.id
                  break
                }
              }
            }

            if (todayToggleId) {
              await httpClient.executeOperation(
                { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
                { block_id: todayToggleId, children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }] }
              )
            } else {
              // Create new toggle for today - insert after any button blocks in the section
              const insertAfterId = findActivityLogInsertAfter(blocks, activityLogSection.index)
              await httpClient.executeOperation(
                { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
                {
                  block_id: page_id, after: insertAfterId,
                  children: [{ type: 'toggle', toggle: { rich_text: dateMentionRichText(dateStr), children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: textToRichText(logEntry) } }] } }]
                }
              )
            }
          }

          return { success: true, completed_item: itemFullText, activity_logged: !!activityLogSection, log_entry: logEntry }
        }

        case 'add-table-row': {
          if (!table_id) return { success: false, error: 'table_id required' }
          if (!row_cells || !Array.isArray(row_cells)) return { success: false, error: 'row_cells array required' }

          // Get table info to verify it's a table and get width
          const tableResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}', operationId: 'retrieve-a-block' },
            { block_id: table_id }
          )

          const table = tableResponse.data
          if (table.type !== 'table') {
            return { success: false, error: `Block ${table_id} is not a table (type: ${table.type})` }
          }

          const tableWidth = table.table.table_width

          // Pad or trim cells to match table width
          const normalizedCells = [...row_cells]
          while (normalizedCells.length < tableWidth) normalizedCells.push('')
          if (normalizedCells.length > tableWidth) normalizedCells.length = tableWidth

          // Create new table row
          const newRow = {
            type: 'table_row',
            table_row: {
              cells: normalizedCells.map(cell => textToRichText(cell))
            }
          }

          const response = await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}/children', operationId: 'patch-block-children' },
            { block_id: table_id, children: [newRow] }
          )

          return {
            success: true,
            action: 'row_added',
            row_id: response.data.results?.[0]?.id,
            cells: normalizedCells
          }
        }

        case 'update-table-row': {
          if (!row_id) return { success: false, error: 'row_id required' }
          if (!row_cells || !Array.isArray(row_cells)) return { success: false, error: 'row_cells array required' }

          // Verify it's a table row
          const rowResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}', operationId: 'retrieve-a-block' },
            { block_id: row_id }
          )

          const row = rowResponse.data
          if (row.type !== 'table_row') {
            return { success: false, error: `Block ${row_id} is not a table_row (type: ${row.type})` }
          }

          // Update table row
          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
            {
              block_id: row_id,
              table_row: {
                cells: row_cells.map(cell => textToRichText(cell))
              }
            }
          )

          return { success: true, action: 'row_updated', row_id, cells: row_cells }
        }

        case 'add-table-column': {
          if (!table_id) return { success: false, error: 'table_id required' }
          if (!column_name) return { success: false, error: 'column_name required' }

          // Get table block
          const tableResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}', operationId: 'retrieve-a-block' },
            { block_id: table_id }
          )

          const table = tableResponse.data
          if (table.type !== 'table') {
            return { success: false, error: `Block ${table_id} is not a table (type: ${table.type})` }
          }

          const currentWidth = table.table.table_width
          const newWidth = currentWidth + 1

          // Update table width
          await httpClient.executeOperation(
            { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
            {
              block_id: table_id,
              table: { table_width: newWidth }
            }
          )

          // Get all table rows
          const rowsResponse = await httpClient.executeOperation(
            { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
            { block_id: table_id, page_size: 100 }
          )

          const rows = rowsResponse.data.results || []
          let updatedRows = 0

          // Update each row to add new cell
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            if (row.type !== 'table_row') continue

            const existingCells = row.table_row.cells || []
            // First row gets column name (if has_column_header), others get default
            const newCellValue = (i === 0 && table.table.has_column_header) ? column_name : column_default

            const updatedCells = [...existingCells, textToRichText(newCellValue)]

            await httpClient.executeOperation(
              { method: 'patch', path: '/v1/blocks/{block_id}', operationId: 'update-a-block' },
              {
                block_id: row.id,
                table_row: { cells: updatedCells }
              }
            )
            updatedRows++
          }

          return {
            success: true,
            action: 'column_added',
            column_name,
            new_width: newWidth,
            rows_updated: updatedRows
          }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  },

  // ============================================================================
  // 3. notion-database - Database Operations
  // ============================================================================
  {
    definition: {
      name: 'notion-database',
      description: 'Unified data source operations: get schema, query with filters/sorts, update schema (title/properties), or get due tasks. Note: In Notion API 2025-09-03+, "data source" is what the Notion UI calls a "database".',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'query', 'update', 'get-due-tasks'],
            description: 'The operation to perform'
          },
          data_source_id: { type: 'string', description: 'Data source ID (what Notion UI calls "database") - for get, query, update' },
          title: { type: 'string', description: 'New database title (for update action)' },
          properties: { type: 'object', description: 'Property configurations to add/update (for update action). Format: { "PropertyName": { "type_config": {...} } }', additionalProperties: true },
          filter: { type: 'object', description: 'Notion filter object', additionalProperties: true },
          sorts: { type: 'array', description: 'Sort criteria', items: { type: 'object' } },
          page_size: { type: 'number', description: 'Results per page (max 100)', default: 100 },
          start_cursor: { type: 'string', description: 'Pagination cursor' },
          days_ahead: { type: 'number', description: 'Include tasks due within N days', default: 0 },
          include_details: { type: 'boolean', description: 'Fetch checklist/activity for each task', default: true },
          overdue_floor_days: { type: 'number', description: 'Only return overdue tasks within this many days in the past (default: 60). Use 0 for today only. Use -1 for no floor (all overdue).', default: 60 }
        },
        required: ['action']
      }
    },
    handler: async (params, httpClient) => {
      const { action, data_source_id, title, properties, filter, sorts, page_size = 100, start_cursor, days_ahead = 0, include_details = true, overdue_floor_days = 60 } = params

      switch (action) {
        case 'get': {
          if (!data_source_id) return { success: false, error: 'data_source_id required' }

          const response = await httpClient.rawRequest('get', `/v1/data_sources/${data_source_id}`, {})
          const ds = response.data

          return {
            success: true,
            id: ds.id,
            title: richTextToPlain(ds.title),
            url: ds.url,
            properties: Object.fromEntries(Object.entries(ds.properties || {}).map(([name, prop]: [string, any]) => [name, { type: prop.type, id: prop.id }]))
          }
        }

        case 'query': {
          if (!data_source_id) return { success: false, error: 'data_source_id required' }

          // Build query body
          const queryBody: any = { page_size }
          if (filter) queryBody.filter = filter
          if (sorts) queryBody.sorts = sorts
          if (start_cursor) queryBody.start_cursor = start_cursor

          let response
          try {
            response = await httpClient.rawRequest('post', `/v1/data_sources/${data_source_id}/query`, queryBody)
          } catch (error: any) {
            const errMsg = error?.data?.message || error?.message || 'Query failed'
            const errCode = error?.data?.code || error?.status
            return {
              success: false,
              error: errMsg,
              code: errCode,
              details: error?.data
            }
          }

          const results = (response.data.results || []).map((page: any) => {
            const props: Record<string, any> = {}
            for (const [name, prop] of Object.entries(page.properties || {})) {
              const p = prop as any
              switch (p.type) {
                case 'title': props[name] = richTextToPlain(p.title); break
                case 'rich_text': props[name] = richTextToPlain(p.rich_text); break
                case 'select': props[name] = p.select?.name; break
                case 'status': props[name] = p.status?.name; break
                case 'date': props[name] = p.date?.start; break
                case 'checkbox': props[name] = p.checkbox; break
                case 'number': props[name] = p.number; break
                case 'relation': props[name] = p.relation?.length || 0; break
                default: props[name] = `[${p.type}]`
              }
            }
            return { id: page.id, url: page.url, properties: props }
          })

          return { success: true, results, has_more: response.data.has_more, next_cursor: response.data.next_cursor }
        }

        case 'update': {
          if (!data_source_id) return { success: false, error: 'data_source_id required' }
          if (!title && !properties) return { success: false, error: 'At least one of title or properties required' }

          // Build PATCH request body
          const patchBody: any = {}

          if (title) {
            patchBody.title = [{ type: 'text', text: { content: title } }]
          }

          if (properties) {
            patchBody.properties = properties
          }

          try {
            const response = await httpClient.rawRequest('patch', `/v1/data_sources/${data_source_id}`, patchBody)
            const ds = response.data

            // Build summary of updated properties
            const updatedProps = Object.fromEntries(
              Object.entries(ds.properties || {}).map(([name, prop]: [string, any]) => [name, { type: prop.type, id: prop.id }])
            )

            return {
              success: true,
              id: ds.id,
              title: richTextToPlain(ds.title),
              url: ds.url,
              properties_updated: properties ? Object.keys(properties) : [],
              title_updated: !!title,
              properties: updatedProps
            }
          } catch (error: any) {
            const errMsg = error?.data?.message || error?.message || 'Update failed'
            const errCode = error?.data?.code || error?.status
            return {
              success: false,
              error: errMsg,
              code: errCode,
              details: error?.data
            }
          }
        }

        case 'get-due-tasks': {
          // Get Tasks data_source IDs from env vars
          const TASKS_DATASOURCES = getAllDataSourceIds('tasks')

          const today = new Date()
          today.setDate(today.getDate() + days_ahead)
          const dueDateCutoff = today.toISOString().split('T')[0]

          // Calculate the overdue floor date (lower bound)
          // -1 means no floor (return all overdue), 0 means today only, N means N days back
          let overdueFloorDate: string | null = null
          if (overdue_floor_days >= 0) {
            const floorDate = new Date()
            floorDate.setDate(floorDate.getDate() - overdue_floor_days)
            overdueFloorDate = floorDate.toISOString().split('T')[0]
          }

          const allTasks: any[] = []
          let workspaceName = 'unknown'
          const errors: string[] = []
          const debug: string[] = [`datasources: ${JSON.stringify(TASKS_DATASOURCES)}`]

          for (const [ws, dsId] of Object.entries(TASKS_DATASOURCES)) {
            debug.push(`trying ${ws}: ${dsId}`)
            try {
              // Auto-discover property names from schema
              let statusPropertyName = 'Status'
              const dateProperties: string[] = []
              try {
                const schemaResponse = await httpClient.rawRequest('get', `/v1/data_sources/${dsId}`, {})
                const properties = schemaResponse.data?.properties || {}
                for (const [propName, propDef] of Object.entries(properties)) {
                  const propType = (propDef as any).type
                  // Find the status property (usually only one)
                  if (propType === 'status') {
                    statusPropertyName = propName
                  }
                  // Collect scheduling-related date properties
                  if (propType === 'date') {
                    const lowerName = propName.toLowerCase()
                    if (['due', 'deadline', 'work session'].includes(lowerName)) {
                      dateProperties.push(propName)
                    }
                  }
                }
              } catch (schemaErr: any) {
                // Fall back to defaults if schema fetch fails
                debug.push(`${ws} schema error: ${schemaErr?.data?.message || schemaErr?.message || 'Unknown'}`)
                dateProperties.push('Due', 'Work Session')
              }
              if (dateProperties.length === 0) {
                dateProperties.push('Due', 'Work Session')
              }
              debug.push(`${ws} props: status=${statusPropertyName}, dates=${dateProperties.join(',')}`)


              // Build date filter with OR across all scheduling properties
              // Each property gets an upper bound and optionally a lower bound (overdue floor)
              // Note: Notion API requires separate filter objects for each condition on the same property
              const buildDateRange = (propName: string) => {
                const upperBound = { property: propName, date: { on_or_before: dueDateCutoff } }
                if (overdueFloorDate) {
                  const lowerBound = { property: propName, date: { on_or_after: overdueFloorDate } }
                  return { and: [upperBound, lowerBound] } as any
                }
                return upperBound
              }
              // Build status filter
              const statusFilter = {
                and: [
                  { property: statusPropertyName, status: { does_not_equal: 'Done' } },
                  { property: statusPropertyName, status: { does_not_equal: "Don't Do" } },
                  { property: statusPropertyName, status: { does_not_equal: 'Archived' } }
                ]
              }

              // When multiple date properties + overdue floor active, Notion API rejects
              // nested compound filters: { or: [{ and: [...] }, { and: [...] }] }
              // Fix: run separate queries per date property and merge/dedup results
              const needsMultiQuery = dateProperties.length > 1 && !!overdueFloorDate

              const runQuery = async (filter: any, targetDsId: string) => {
                try {
                  return await httpClient.rawRequest('post', `/v1/data_sources/${targetDsId}/query`, {
                    filter,
                    sorts: [{ property: dateProperties[0], direction: 'ascending' }],
                    page_size: 50
                  })
                } catch {
                  const legacyDbId = getDatabaseId('tasks', ws)
                  if (!legacyDbId) return null
                  return await httpClient.rawRequest('post', `/v1/data_sources/${legacyDbId}/query`, {
                    filter,
                    sorts: [{ property: dateProperties[0], direction: 'ascending' }],
                    page_size: 50
                  })
                }
              }

              let tasks: any[]
              if (needsMultiQuery) {
                const seenIds = new Set<string>()
                tasks = []
                for (const dateProp of dateProperties) {
                  const filter = { and: [buildDateRange(dateProp), statusFilter] }
                  const resp = await runQuery(filter, dsId)
                  if (!resp) continue
                  for (const t of (resp.data.results || [])) {
                    if (!seenIds.has(t.id)) {
                      seenIds.add(t.id)
                      tasks.push(t)
                    }
                  }
                }
              } else {
                const dateFilters = dateProperties.map(prop => buildDateRange(prop))
                const dateFilter = dateFilters.length === 1
                  ? dateFilters[0]
                  : { or: dateFilters }
                const resp = await runQuery({ and: [dateFilter, statusFilter] }, dsId)
                if (!resp) continue
                tasks = resp.data.results || []
              }

              workspaceName = ws

              for (const task of tasks) {
                let title = ''
                const properties: Record<string, any> = {}

                for (const [name, prop] of Object.entries(task.properties || {})) {
                  const p = prop as any
                  switch (p.type) {
                    case 'title': title = richTextToPlain(p.title); properties[name] = title; break
                    case 'status': properties[name] = p.status?.name; break
                    case 'date': properties[name] = p.date?.start; break
                    case 'rich_text': properties[name] = richTextToPlain(p.rich_text); break
                    case 'people': properties[name] = p.people?.map((person: any) => person.name || person.id); break
                    case 'relation': properties[name] = p.relation?.length || 0; break
                  }
                }

                // Extract status and due from discovered properties
                const status = properties[statusPropertyName]
                // Find the earliest due date from scheduling properties
                let due: string | undefined
                for (const dateProp of dateProperties) {
                  if (properties[dateProp]) {
                    if (!due || properties[dateProp] < due) {
                      due = properties[dateProp]
                    }
                  }
                }

                const taskData: any = {
                  id: task.id, workspace: ws, title, url: task.url,
                  status, due,
                  do_next: properties['Do Next'] || properties['Smart List']
                }

                if (include_details) {
                  try {
                    const blocksResponse = await httpClient.executeOperation(
                      { method: 'get', path: '/v1/blocks/{block_id}/children', operationId: 'get-block-children' },
                      { block_id: task.id, page_size: 50 }
                    )
                    const blocks = blocksResponse.data.results || []
                    const checklist: any[] = []

                    for (const block of blocks) {
                      if (block.type === 'to_do') {
                        checklist.push({ text: richTextToPlain(block.to_do?.rich_text || []), checked: block.to_do?.checked || false })
                      }
                    }

                    taskData.checklist = checklist
                    taskData.checklist_progress = `${checklist.filter(c => c.checked).length}/${checklist.length}`
                  } catch (e) {
                    taskData.checklist = []
                  }
                }

                allTasks.push(taskData)
              }
              break
            } catch (err: any) {
              errors.push(`${ws}: ${err?.data?.message || err?.message || 'Unknown error'}`)
              continue
            }
          }

          const todayStr = new Date().toISOString().split('T')[0]
          const debugInfo = workspaceName === 'unknown' ? `${workspaceName}[${debug.length}d,${errors.length}e]` : workspaceName
          return {
            success: true,
            workspace: debugInfo,
            date_queried: todayStr,
            days_ahead,
            overdue_floor_days,
            overdue_floor_date: overdueFloorDate,
            total_tasks: allTasks.length,
            summary: {
              overdue: allTasks.filter(t => t.due && t.due < todayStr).length,
              due_today: allTasks.filter(t => t.due === todayStr).length,
              upcoming: allTasks.filter(t => t.due && t.due > todayStr).length
            },
            tasks: allTasks
          }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  },

  // ============================================================================
  // 4. notion-search - Search Operations
  // ============================================================================
  {
    definition: {
      name: 'notion-search',
      description: 'Search Notion pages and databases with summarized results.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          filter_type: { type: 'string', enum: ['page', 'data_source'], description: 'Filter to pages or data_sources only' },
          limit: { type: 'number', description: 'Max results', default: 10 }
        },
        required: ['query']
      }
    },
    handler: async (params, httpClient) => {
      const { query, filter_type, limit = 10 } = params

      const searchBody: any = { query, page_size: limit }
      if (filter_type) searchBody.filter = { property: 'object', value: filter_type }

      const response = await httpClient.executeOperation(
        { method: 'post', path: '/v1/search', operationId: 'post-search' },
        searchBody
      )

      const results = (response.data.results || []).map((item: any) => {
        const summary: any = { id: item.id, type: item.object, url: item.url }

        if (item.object === 'page') {
          for (const [name, prop] of Object.entries(item.properties || {})) {
            const p = prop as any
            if (p.type === 'title') { summary.title = richTextToPlain(p.title); break }
          }
          summary.last_edited = item.last_edited_time
        } else if (item.object === 'database') {
          summary.title = richTextToPlain(item.title)
          summary.properties = Object.keys(item.properties || {})
        }

        return summary
      })

      return { success: true, query, total_results: results.length, results }
    }
  },

  // ============================================================================
  // 5. notion-comments - Comment Operations
  // ============================================================================
  {
    definition: {
      name: 'notion-comments',
      description: 'Get or create comments on Notion pages.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['get', 'create'], description: 'The operation to perform' },
          page_id: { type: 'string', description: 'Page ID' },
          block_id: { type: 'string', description: 'Block ID (for get comments on specific block)' },
          content: { type: 'string', description: 'Comment text (for create)' },
          page_size: { type: 'number', description: 'Max comments to return', default: 100 }
        },
        required: ['action']
      }
    },
    handler: async (params, httpClient) => {
      const { action, page_id, block_id, content, page_size = 100 } = params

      switch (action) {
        case 'get': {
          const targetId = block_id || page_id
          if (!targetId) return { success: false, error: 'page_id or block_id required' }

          const response = await httpClient.executeOperation(
            { method: 'get', path: '/v1/comments', operationId: 'retrieve-a-comment' },
            { block_id: targetId, page_size }
          )

          const comments = (response.data.results || []).map((c: any) => ({
            id: c.id,
            created_time: c.created_time,
            created_by: c.created_by?.id,
            content: richTextToPlain(c.rich_text || [])
          }))

          return { success: true, comments }
        }

        case 'create': {
          if (!page_id) return { success: false, error: 'page_id required' }
          if (!content) return { success: false, error: 'content required' }

          const response = await httpClient.executeOperation(
            { method: 'post', path: '/v1/comments', operationId: 'create-a-comment' },
            { parent: { page_id }, rich_text: [{ text: { content } }] }
          )

          return { success: true, comment_id: response.data.id }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  },

  // ============================================================================
  // 6. notion-users - User Operations
  // ============================================================================
  {
    definition: {
      name: 'notion-users',
      description: 'List workspace users or get a specific user.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'me'], description: 'The operation to perform' },
          user_id: { type: 'string', description: 'User ID (for get)' },
          page_size: { type: 'number', description: 'Max users to return', default: 100 }
        },
        required: ['action']
      }
    },
    handler: async (params, httpClient) => {
      const { action, user_id, page_size = 100 } = params

      switch (action) {
        case 'list': {
          const response = await httpClient.executeOperation(
            { method: 'get', path: '/v1/users', operationId: 'get-users' },
            { page_size }
          )

          const users = (response.data.results || []).map((u: any) => ({
            id: u.id,
            type: u.type,
            name: u.name,
            avatar_url: u.avatar_url,
            email: u.person?.email
          }))

          return { success: true, users }
        }

        case 'get': {
          if (!user_id) return { success: false, error: 'user_id required' }

          const response = await httpClient.executeOperation(
            { method: 'get', path: '/v1/users/{user_id}', operationId: 'get-user' },
            { user_id }
          )
          const u = response.data

          return { success: true, user: { id: u.id, type: u.type, name: u.name, avatar_url: u.avatar_url, email: u.person?.email } }
        }

        case 'me': {
          const response = await httpClient.executeOperation(
            { method: 'get', path: '/v1/users/me', operationId: 'get-self' },
            {}
          )
          const u = response.data

          return { success: true, bot: { id: u.id, name: u.name, owner: u.bot?.owner } }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  }
]
