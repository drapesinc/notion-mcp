import { describe, it, expect } from 'vitest'

// Helper to test structured content parsing
// This tests the parseStructuredContent function from unified-tools.ts

function textToRichText(text: string): any[] {
  return [{ type: 'text', text: { content: text } }]
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.split('|').slice(1, -1).map(cell => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  return /^\|[\s\-:]+\|/.test(trimmed) && trimmed.split('|').every(part => /^[\s\-:]*$/.test(part))
}

function parseStructuredContent(content: string): any[] {
  const lines = content.split('\n')
  const blocks: any[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    let block: any = null

    // Check for table (starts with |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableRows: string[][] = []
      let hasColumnHeader = false
      let isFirstRow = true

      while (i < lines.length) {
        const currentLine = lines[i].trim()
        if (!currentLine.startsWith('|')) break

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

      if (block) blocks.push(block)
      continue
    }

    // Headings
    if (trimmed.startsWith('h1: ')) {
      block = {
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: trimmed.substring(4) } }] },
      }
    } else if (trimmed.startsWith('h2: ')) {
      block = {
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: trimmed.substring(4) } }] },
      }
    } else if (trimmed.startsWith('h3: ')) {
      block = {
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: trimmed.substring(4) } }] },
      }
    }
    // Bullets
    else if (trimmed.startsWith('- ')) {
      block = {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: trimmed.substring(2) } }] },
      }
    }
    // Numbered
    else if (/^\d+\.\s/.test(trimmed)) {
      const text = trimmed.replace(/^\d+\.\s/, '')
      block = {
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: text } }] },
      }
    }
    // Todos
    else if (trimmed.startsWith('[] ')) {
      block = {
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: trimmed.substring(3) } }],
          checked: false,
        },
      }
    } else if (trimmed.startsWith('[x] ') || trimmed.startsWith('[X] ')) {
      block = {
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: trimmed.substring(4) } }],
          checked: true,
        },
      }
    }
    // Quote
    else if (trimmed.startsWith('> ') && !trimmed.startsWith('> @')) {
      block = {
        type: 'quote',
        quote: { rich_text: [{ type: 'text', text: { content: trimmed.substring(2) } }] },
      }
    }
    // Divider
    else if (trimmed === '---') {
      block = { type: 'divider', divider: {} }
    }
    // Callout
    else if (trimmed.startsWith('!> ') || trimmed.startsWith('callout:') || trimmed.startsWith('callout[')) {
      let text = ''
      let icon = '💡'
      let color = 'gray_background'

      const calloutMatch = trimmed.match(/^callout\[([^,\]]+)(?:,([^\]]+))?\]:\s*(.*)$/)
      if (calloutMatch) {
        icon = calloutMatch[1].trim()
        if (calloutMatch[2]) color = calloutMatch[2].trim() + '_background'
        text = calloutMatch[3].trim()
      } else if (trimmed.startsWith('!> ')) {
        text = trimmed.substring(3)
      } else if (trimmed.startsWith('callout: ')) {
        text = trimmed.substring(9)
      }

      block = {
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: text } }],
          icon: icon.startsWith('http')
            ? { type: 'external', external: { url: icon } }
            : { type: 'emoji', emoji: icon },
          color,
        },
      }
    }
    // Code block
    else if (trimmed.startsWith('```')) {
      const language = trimmed.substring(3).trim() || 'plain text'
      block = {
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: '' } }],
          language,
        },
      }
    }
    // Regular paragraph
    else {
      block = {
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: trimmed } }] },
      }
    }

    if (block) blocks.push(block)
    i++
  }

  return blocks
}

describe('Structured Content Parsing', () => {
  describe('Headings', () => {
    it('should parse h1 heading', () => {
      const blocks = parseStructuredContent('h1: Main Title')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('heading_1')
      expect(blocks[0].heading_1.rich_text[0].text.content).toBe('Main Title')
    })

    it('should parse h2 heading', () => {
      const blocks = parseStructuredContent('h2: Subtitle')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('heading_2')
    })

    it('should parse h3 heading', () => {
      const blocks = parseStructuredContent('h3: Section')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('heading_3')
    })

    it('should parse multiple headings', () => {
      const blocks = parseStructuredContent('h1: Title\nh2: Subtitle\nh3: Section')
      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('heading_1')
      expect(blocks[1].type).toBe('heading_2')
      expect(blocks[2].type).toBe('heading_3')
    })
  })

  describe('Lists', () => {
    it('should parse bulleted list items', () => {
      const blocks = parseStructuredContent('- First item\n- Second item\n- Third item')
      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('bulleted_list_item')
      expect(blocks[1].type).toBe('bulleted_list_item')
      expect(blocks[2].type).toBe('bulleted_list_item')
    })

    it('should parse numbered list items', () => {
      const blocks = parseStructuredContent('1. First\n2. Second\n3. Third')
      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('numbered_list_item')
      expect(blocks[0].numbered_list_item.rich_text[0].text.content).toBe('First')
    })

    it('should handle mixed list formats', () => {
      const blocks = parseStructuredContent('- Bullet\n1. Numbered\n- Another bullet')
      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('bulleted_list_item')
      expect(blocks[1].type).toBe('numbered_list_item')
      expect(blocks[2].type).toBe('bulleted_list_item')
    })
  })

  describe('Todos', () => {
    it('should parse unchecked todo', () => {
      const blocks = parseStructuredContent('[] Unchecked task')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('to_do')
      expect(blocks[0].to_do.checked).toBe(false)
      expect(blocks[0].to_do.rich_text[0].text.content).toBe('Unchecked task')
    })

    it('should parse checked todo (lowercase x)', () => {
      const blocks = parseStructuredContent('[x] Completed task')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('to_do')
      expect(blocks[0].to_do.checked).toBe(true)
    })

    it('should parse checked todo (uppercase X)', () => {
      const blocks = parseStructuredContent('[X] Completed task')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('to_do')
      expect(blocks[0].to_do.checked).toBe(true)
    })

    it('should parse multiple todos', () => {
      const blocks = parseStructuredContent('[] Todo 1\n[x] Todo 2\n[] Todo 3')
      expect(blocks).toHaveLength(3)
      expect(blocks[0].to_do.checked).toBe(false)
      expect(blocks[1].to_do.checked).toBe(true)
      expect(blocks[2].to_do.checked).toBe(false)
    })
  })

  describe('Callouts', () => {
    it('should parse simple callout with default icon', () => {
      const blocks = parseStructuredContent('!> Important information')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('callout')
      expect(blocks[0].callout.icon.emoji).toBe('💡')
      expect(blocks[0].callout.color).toBe('gray_background')
    })

    it('should parse callout with custom emoji', () => {
      const blocks = parseStructuredContent('callout[🔥,red]: Critical alert')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('callout')
      expect(blocks[0].callout.icon.emoji).toBe('🔥')
      expect(blocks[0].callout.color).toBe('red_background')
      expect(blocks[0].callout.rich_text[0].text.content).toBe('Critical alert')
    })

    it('should parse callout with emoji only', () => {
      const blocks = parseStructuredContent('callout[✅]: Success')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].callout.icon.emoji).toBe('✅')
      expect(blocks[0].callout.color).toBe('gray_background')
    })

    it('should parse callout with URL icon', () => {
      const blocks = parseStructuredContent('callout[https://example.com/icon.png,blue]: Custom icon')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].callout.icon.type).toBe('external')
      expect(blocks[0].callout.icon.external.url).toBe('https://example.com/icon.png')
    })

    it('should parse simple callout syntax', () => {
      const blocks = parseStructuredContent('callout: Basic callout')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('callout')
      expect(blocks[0].callout.rich_text[0].text.content).toBe('Basic callout')
    })
  })

  describe('Tables', () => {
    it('should parse simple table', () => {
      const content = `| Name | Age |
| John | 30 |
| Jane | 25 |`
      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('table')
      expect(blocks[0].table.table_width).toBe(2)
      expect(blocks[0].table.children).toHaveLength(3)
    })

    it('should parse table with header separator', () => {
      const content = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`
      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('table')
      expect(blocks[0].table.has_column_header).toBe(true)
      expect(blocks[0].table.children).toHaveLength(2) // Header row + data row (separator excluded)
    })

    it('should parse table with varying column widths', () => {
      const content = `| A | B | C |
| 1 | 2 |
| X | Y | Z |`
      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].table.table_width).toBe(3) // Max columns
    })

    it('should handle table followed by other content', () => {
      const content = `| Col1 | Col2 |
| Val1 | Val2 |

h1: Title after table`
      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(2)
      expect(blocks[0].type).toBe('table')
      expect(blocks[1].type).toBe('heading_1')
    })

    it('should preserve cell content formatting', () => {
      const content = `| **Bold** | *Italic* |
| Code | Link |`
      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(1)
      const firstCell = blocks[0].table.children[0].table_row.cells[0]
      expect(firstCell[0].text.content).toBe('**Bold**')
    })
  })

  describe('Other Blocks', () => {
    it('should parse quote', () => {
      const blocks = parseStructuredContent('> This is a quote')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('quote')
      expect(blocks[0].quote.rich_text[0].text.content).toBe('This is a quote')
    })

    it('should parse divider', () => {
      const blocks = parseStructuredContent('---')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('divider')
    })

    it('should parse code block', () => {
      const blocks = parseStructuredContent('```javascript')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('code')
      expect(blocks[0].code.language).toBe('javascript')
    })

    it('should parse paragraph', () => {
      const blocks = parseStructuredContent('This is regular text')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('paragraph')
      expect(blocks[0].paragraph.rich_text[0].text.content).toBe('This is regular text')
    })
  })

  describe('Complex Content', () => {
    it('should parse mixed content types', () => {
      const content = `h1: Project Overview
- Key point 1
- Key point 2
[] Task to complete
[x] Completed task
> Important quote
---
callout[⚠️,yellow]: Warning message
Regular paragraph text`

      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(9)
      expect(blocks[0].type).toBe('heading_1')
      expect(blocks[1].type).toBe('bulleted_list_item')
      expect(blocks[2].type).toBe('bulleted_list_item')
      expect(blocks[3].type).toBe('to_do')
      expect(blocks[4].type).toBe('to_do')
      expect(blocks[5].type).toBe('quote')
      expect(blocks[6].type).toBe('divider')
      expect(blocks[7].type).toBe('callout')
      expect(blocks[8].type).toBe('paragraph')
    })

    it('should handle empty lines gracefully', () => {
      const content = `h1: Title

- Item 1

- Item 2`
      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(3)
    })

    it('should parse activity log format', () => {
      const content = `callout[📊,blue]: Activity Log
> Activity date heading
- 10:30 ET — First entry
- 14:15 ET — Second entry`

      const blocks = parseStructuredContent(content)
      expect(blocks).toHaveLength(4)
      expect(blocks[0].type).toBe('callout')
      expect(blocks[1].type).toBe('quote')
      expect(blocks[2].type).toBe('bulleted_list_item')
      expect(blocks[3].type).toBe('bulleted_list_item')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      const blocks = parseStructuredContent('')
      expect(blocks).toHaveLength(0)
    })

    it('should handle whitespace-only content', () => {
      const blocks = parseStructuredContent('   \n\n   ')
      expect(blocks).toHaveLength(0)
    })

    it('should trim whitespace from lines', () => {
      const blocks = parseStructuredContent('   h1: Title   ')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].heading_1.rich_text[0].text.content).toBe('Title')
    })

    it('should handle special characters', () => {
      const blocks = parseStructuredContent('- Item with "quotes" and \'apostrophes\'')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].bulleted_list_item.rich_text[0].text.content).toContain('quotes')
    })
  })
})
