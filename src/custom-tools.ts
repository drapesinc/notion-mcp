import { Tool } from '@modelcontextprotocol/sdk/types.js'

export interface CustomToolHandler {
  (params: Record<string, any>, httpClient: any): Promise<any>
}

export interface CustomTool {
  definition: Tool
  handler: CustomToolHandler
}

// Helper to create rich_text from plain text
function textToRichText(content: string) {
  return [{ type: 'text', text: { content } }]
}

// Extract plain text from rich_text array
function richTextToPlain(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return ''
  return richText.map(rt => rt.plain_text || rt.text?.content || '').join('')
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
        { method: 'get', path: `/v1/pages/${page_id}`, operationId: 'retrieve-a-page' },
        {}
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
            { method: 'get', path: `/v1/blocks/${page_id}/children`, operationId: 'get-block-children' },
            { page_size: block_limit }
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
            { method: 'get', path: `/v1/databases/${page.parent.database_id}`, operationId: 'retrieve-a-database' },
            {}
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
      description: 'Append structured content to a Notion page using simple syntax. Supports headings (h1:, h2:, h3:), bullets (- ), numbered lists (1. ), todos ([] or [x]), quotes (> ), dividers (---), and paragraphs.',
      inputSchema: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'The ID of the page to append content to'
          },
          content: {
            type: 'string',
            description: 'Content in simple markup format. Each line becomes a block. Use h1:, h2:, h3: for headings, - for bullets, 1. for numbered, [] for unchecked todo, [x] for checked todo, > for quotes, --- for dividers.'
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
        { method: 'patch', path: `/v1/blocks/${page_id}/children`, operationId: 'patch-block-children' },
        requestBody
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
  }
]
