import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpClient } from '../openapi-mcp-server/client/http-client'
import { unifiedTools } from '../unified-tools'

// Mock HttpClient
vi.mock('../openapi-mcp-server/client/http-client')

describe('Unified Tools - notion-page', () => {
  let mockHttpClient: any

  beforeEach(() => {
    mockHttpClient = {
      executeOperation: vi.fn(),
      rawRequest: vi.fn(),
    }
  })

  describe('action: get', () => {
    it('should get a page with basic properties', async () => {
      const mockPage = {
        id: 'page-123',
        properties: { Name: { type: 'title', title: [{ plain_text: 'Test Page' }] } },
        url: 'https://notion.so/page-123',
      }

      // First call: retrieve page; Second call: get blocks (include_blocks defaults to true)
      mockHttpClient.executeOperation
        .mockResolvedValueOnce({ data: mockPage })
        .mockResolvedValueOnce({ data: { results: [] } })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        { action: 'get', page_id: 'page-123' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.id).toBe('page-123')
      expect(mockHttpClient.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'retrieve-a-page' }),
        { page_id: 'page-123' }
      )
    })

    it('should get a page with blocks', async () => {
      const mockPage = {
        id: 'page-123',
        properties: { Name: { type: 'title', title: [{ plain_text: 'Test Page' }] } },
      }

      const mockBlocks = {
        results: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Test content' }] },
          },
        ],
      }

      mockHttpClient.executeOperation
        .mockResolvedValueOnce({ data: mockPage })
        .mockResolvedValueOnce({ data: mockBlocks })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        { action: 'get', page_id: 'page-123', include_blocks: true },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.blocks).toBeDefined()
      expect(result.block_summary).toContain('paragraph: Test content')
    })

    it('should handle API errors gracefully', async () => {
      mockHttpClient.executeOperation.mockRejectedValue(new Error('Page not found'))

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!

      // The handler does not catch errors internally; they propagate to the proxy layer
      await expect(
        tool.handler({ action: 'get', page_id: 'invalid-id' }, mockHttpClient)
      ).rejects.toThrow('Page not found')
    })
  })

  describe('action: create', () => {
    it('should create a page in a database', async () => {
      const mockCreatedPage = {
        id: 'new-page-123',
        url: 'https://notion.so/new-page-123',
        properties: { Name: { type: 'title', title: [{ plain_text: 'New Task' }] } },
      }

      // resolvePropertiesWithFuzzyMatch fetches schema via executeOperation
      // Then the page is created via executeOperation
      mockHttpClient.executeOperation
        .mockResolvedValueOnce({
          data: {
            id: 'ds-123',
            properties: {
              Name: { type: 'title', id: 'title' },
              Status: { type: 'status', id: 'status', status: { options: [{ name: 'To Do' }], groups: [] } },
            },
          },
        }) // Schema fetch (resolvePropertiesWithFuzzyMatch)
        .mockResolvedValueOnce({ data: mockCreatedPage }) // Create page

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        {
          action: 'create',
          data_source_id: 'ds-123',
          title: 'New Task',
          properties: { Status: { status: { name: 'To Do' } } },
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('created')
      expect(result.page_id).toBe('new-page-123')
    })

    it('should create a page with template', async () => {
      const mockCreatedPage = {
        id: 'new-page-456',
        url: 'https://notion.so/new-page-456',
      }

      // Schema fetch via executeOperation (resolvePropertiesWithFuzzyMatch)
      mockHttpClient.executeOperation.mockResolvedValueOnce({
        data: {
          id: 'ds-123',
          properties: {
            Name: { type: 'title', id: 'title' },
          },
        },
      })

      // Template creation via rawRequest
      mockHttpClient.rawRequest.mockResolvedValueOnce({
        data: mockCreatedPage,
        status: 200,
      })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        {
          action: 'create',
          data_source_id: 'ds-123',
          title: 'Task from Template',
          template_id: 'template-123',
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.page_id).toBe('new-page-456')
      // Verify template rawRequest was called
      expect(mockHttpClient.rawRequest).toHaveBeenCalledWith(
        'post',
        '/v1/pages',
        expect.objectContaining({
          template: {
            type: 'template_id',
            template_id: 'template-123',
          },
        })
      )
    })

    it('should create a page with initial content', async () => {
      const mockCreatedPage = {
        id: 'new-page-789',
        url: 'https://notion.so/new-page-789',
      }

      // 1. Schema fetch (resolvePropertiesWithFuzzyMatch via executeOperation)
      // 2. Page create (executeOperation)
      // 3. Block append (executeOperation)
      mockHttpClient.executeOperation
        .mockResolvedValueOnce({
          data: {
            id: 'ds-123',
            properties: {
              Name: { type: 'title', id: 'title' },
            },
          },
        }) // Schema fetch
        .mockResolvedValueOnce({ data: mockCreatedPage }) // Create page
        .mockResolvedValueOnce({ data: { results: [] } }) // Append blocks

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        {
          action: 'create',
          data_source_id: 'ds-123',
          title: 'Page with Content',
          initial_content: 'h1: Header\n- Bullet point\n[] Todo item',
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(mockHttpClient.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'patch-block-children' }),
        expect.objectContaining({
          block_id: 'new-page-789',
        })
      )
    })
  })

  describe('action: update', () => {
    it('should update page properties', async () => {
      const mockCurrentPage = {
        id: 'page-123',
        parent: { database_id: 'db-123' },
        properties: { Status: { type: 'status', status: { name: 'To Do' } } },
      }

      const mockUpdatedPage = {
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: { Status: { type: 'status', status: { name: 'Done' } } },
      }

      // Sequence: 1) fetch page, 2) fetch schema (fuzzy matching), 3) update page
      mockHttpClient.executeOperation
        .mockResolvedValueOnce({ data: mockCurrentPage }) // Fetch page for relations/fuzzy
        .mockResolvedValueOnce({
          data: {
            id: 'db-123',
            properties: {
              Status: { type: 'status', id: 'status', status: { options: [{ name: 'Done' }], groups: [] } },
            },
          },
        }) // Schema fetch (resolvePropertiesWithFuzzyMatch)
        .mockResolvedValueOnce({ data: mockUpdatedPage }) // Update page

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        {
          action: 'update',
          page_id: 'page-123',
          properties: { Status: { status: { name: 'Done' } } },
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('updated')
    })

    it('should append relations', async () => {
      const mockCurrentPage = {
        id: 'page-123',
        parent: { type: 'page_id', page_id: 'parent-page' },
        properties: {
          Projects: { type: 'relation', relation: [{ id: 'existing-project' }] },
        },
      }

      const mockUpdatedPage = {
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {
          Projects: {
            type: 'relation',
            relation: [
              { id: 'existing-project' },
              { id: 'new-project' },
            ],
          },
        },
      }

      mockHttpClient.executeOperation
        .mockResolvedValueOnce({ data: mockCurrentPage }) // Fetch page
        .mockResolvedValueOnce({ data: mockUpdatedPage }) // Update page

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        {
          action: 'update',
          page_id: 'page-123',
          relations: {
            Projects: { ids: ['new-project'], mode: 'append' },
          },
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(mockHttpClient.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'patch-page' }),
        expect.objectContaining({
          properties: expect.objectContaining({
            Projects: {
              relation: [{ id: 'existing-project' }, { id: 'new-project' }],
            },
          }),
        })
      )
    })
  })

  describe('action: delete', () => {
    it('should archive a page', async () => {
      mockHttpClient.executeOperation.mockResolvedValue({ data: { id: 'page-123', archived: true } })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-page')!
      const result = await tool.handler(
        { action: 'delete', page_id: 'page-123' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('archived')
    })
  })
})

describe('Unified Tools - notion-blocks', () => {
  let mockHttpClient: any

  beforeEach(() => {
    mockHttpClient = {
      executeOperation: vi.fn(),
    }
  })

  describe('action: get', () => {
    it('should get blocks from a page', async () => {
      const mockBlocks = {
        results: [
          {
            id: 'block-1',
            type: 'heading_1',
            heading_1: { rich_text: [{ plain_text: 'Title' }] },
          },
          {
            id: 'block-2',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Content' }] },
          },
        ],
        has_more: false,
      }

      mockHttpClient.executeOperation.mockResolvedValue({ data: mockBlocks })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-blocks')!
      const result = await tool.handler(
        { action: 'get', page_id: 'page-123' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.blocks).toHaveLength(2)
    })
  })

  describe('action: append', () => {
    it('should append structured content', async () => {
      mockHttpClient.executeOperation.mockResolvedValue({ data: { results: [] } })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-blocks')!
      const result = await tool.handler(
        {
          action: 'append',
          page_id: 'page-123',
          content: 'h1: Header\n- Bullet\n[] Todo\n> Quote\ncallout[💡,blue]: Info',
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(mockHttpClient.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'patch-block-children' }),
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({ type: 'heading_1' }),
            expect.objectContaining({ type: 'bulleted_list_item' }),
            expect.objectContaining({ type: 'to_do' }),
            expect.objectContaining({ type: 'quote' }),
            expect.objectContaining({ type: 'callout' }),
          ]),
        })
      )
    })
  })

  describe('action: complete-todo', () => {
    it('should complete a todo item', async () => {
      const mockBlocks = {
        results: [
          {
            id: 'todo-1',
            type: 'to_do',
            to_do: {
              rich_text: [{ plain_text: 'Complete this task' }],
              checked: false,
            },
          },
        ],
      }

      mockHttpClient.executeOperation
        .mockResolvedValueOnce({ data: mockBlocks }) // Get blocks
        .mockResolvedValueOnce({ data: {} }) // Update todo (check it)

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-blocks')!
      const result = await tool.handler(
        {
          action: 'complete-todo',
          page_id: 'page-123',
          item_text: 'Complete this task',
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.completed_item).toBe('Complete this task')
    })
  })
})

describe('Unified Tools - notion-database', () => {
  let mockHttpClient: any

  beforeEach(() => {
    mockHttpClient = {
      executeOperation: vi.fn(),
      rawRequest: vi.fn(),
    }
  })

  describe('action: get', () => {
    it('should get database schema', async () => {
      const mockDatabase = {
        id: 'ds-123',
        title: [{ plain_text: 'Tasks' }],
        url: 'https://notion.so/ds-123',
        properties: {
          Name: { type: 'title', id: 'title' },
          Status: { type: 'status', id: 'status' },
          Due: { type: 'date', id: 'date' },
        },
      }

      mockHttpClient.rawRequest.mockResolvedValue({ data: mockDatabase })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-database')!
      const result = await tool.handler(
        { action: 'get', data_source_id: 'ds-123' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.properties).toBeDefined()
    })
  })

  describe('action: query', () => {
    it('should query database with filters', async () => {
      const mockResults = {
        results: [
          { id: 'page-1', properties: {} },
          { id: 'page-2', properties: {} },
        ],
        has_more: false,
      }

      mockHttpClient.rawRequest.mockResolvedValue({ data: mockResults })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-database')!
      const result = await tool.handler(
        {
          action: 'query',
          data_source_id: 'ds-123',
          filter: {
            property: 'Status',
            status: { equals: 'To Do' },
          },
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
    })
  })

  describe('action: get-due-tasks', () => {
    it('should fetch due tasks with filters', async () => {
      const mockSchema = {
        id: 'ds-tasks',
        properties: {
          Name: { type: 'title', id: 'title' },
          Due: { type: 'date', id: 'due' },
          Status: { type: 'status', id: 'status', status: { options: [{ name: 'To Do' }, { name: 'Done' }], groups: [{ name: 'Complete', option_ids: [] }] } },
        },
      }

      const mockResults = {
        results: [
          {
            id: 'task-1',
            url: 'https://notion.so/task-1',
            properties: {
              Name: { type: 'title', title: [{ plain_text: 'Overdue Task' }] },
              Due: { type: 'date', date: { start: '2025-01-01' } },
              Status: { type: 'status', status: { name: 'To Do' } },
            },
          },
        ],
      }

      // Set env var for the handler to discover
      process.env.NOTION_DS_TASKS_PERSONAL = 'ds-tasks'

      // Sequence: 1) rawRequest for schema, 2) rawRequest for query
      mockHttpClient.rawRequest
        .mockResolvedValueOnce({ data: mockSchema }) // Schema fetch
        .mockResolvedValueOnce({ data: mockResults }) // Query

      // 3) executeOperation for block children (include_details defaults to true)
      mockHttpClient.executeOperation
        .mockResolvedValueOnce({ data: { results: [] } }) // Blocks for task-1

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-database')!
      const result = await tool.handler(
        { action: 'get-due-tasks', workspace: 'personal' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.total_tasks).toBeGreaterThan(0)

      delete process.env.NOTION_DS_TASKS_PERSONAL
    })
  })
})

describe('Unified Tools - notion-search', () => {
  let mockHttpClient: any

  beforeEach(() => {
    mockHttpClient = {
      executeOperation: vi.fn(),
    }
  })

  it('should search and return summarized results', async () => {
    const mockResults = {
      results: [
        {
          id: 'page-1',
          object: 'page',
          url: 'https://notion.so/page-1',
          last_edited_time: '2025-01-01T00:00:00Z',
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Test Page' }] },
          },
        },
        {
          id: 'db-1',
          object: 'database',
          url: 'https://notion.so/db-1',
          title: [{ plain_text: 'Test Database' }],
          properties: { Name: { type: 'title' } },
        },
      ],
    }

    mockHttpClient.executeOperation.mockResolvedValue({ data: mockResults })

    const tool = unifiedTools.find((t) => t.definition.name === 'notion-search')!
    const result = await tool.handler(
      { query: 'test', limit: 10 },
      mockHttpClient
    )

    expect(result.success).toBe(true)
    expect(result.total_results).toBe(2)
    expect(result.results).toBeDefined()
  })
})

describe('Unified Tools - notion-comments', () => {
  let mockHttpClient: any

  beforeEach(() => {
    mockHttpClient = {
      executeOperation: vi.fn(),
    }
  })

  describe('action: get', () => {
    it('should get comments for a page', async () => {
      const mockComments = {
        results: [
          {
            id: 'comment-1',
            rich_text: [{ plain_text: 'Great work!' }],
            created_time: '2025-01-01T00:00:00Z',
            created_by: { id: 'user-1' },
          },
        ],
      }

      mockHttpClient.executeOperation.mockResolvedValue({ data: mockComments })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-comments')!
      const result = await tool.handler(
        { action: 'get', page_id: 'page-123' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.comments).toHaveLength(1)
    })
  })

  describe('action: create', () => {
    it('should create a comment', async () => {
      const mockComment = {
        id: 'comment-2',
        rich_text: [{ plain_text: 'New comment' }],
      }

      mockHttpClient.executeOperation.mockResolvedValue({ data: mockComment })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-comments')!
      const result = await tool.handler(
        {
          action: 'create',
          page_id: 'page-123',
          content: 'New comment',
        },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.comment_id).toBe('comment-2')
    })
  })
})

describe('Unified Tools - notion-users', () => {
  let mockHttpClient: any

  beforeEach(() => {
    mockHttpClient = {
      executeOperation: vi.fn(),
    }
  })

  describe('action: list', () => {
    it('should list workspace users', async () => {
      const mockUsers = {
        results: [
          {
            id: 'user-1',
            name: 'John Doe',
            type: 'person',
            person: { email: 'john@example.com' },
          },
        ],
      }

      mockHttpClient.executeOperation.mockResolvedValue({ data: mockUsers })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-users')!
      const result = await tool.handler({ action: 'list' }, mockHttpClient)

      expect(result.success).toBe(true)
      expect(result.users).toHaveLength(1)
    })
  })

  describe('action: get', () => {
    it('should get a specific user', async () => {
      const mockUser = {
        id: 'user-1',
        name: 'John Doe',
        type: 'person',
      }

      mockHttpClient.executeOperation.mockResolvedValue({ data: mockUser })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-users')!
      const result = await tool.handler(
        { action: 'get', user_id: 'user-1' },
        mockHttpClient
      )

      expect(result.success).toBe(true)
      expect(result.user.id).toBe('user-1')
    })
  })

  describe('action: me', () => {
    it('should get the bot user', async () => {
      const mockBotUser = {
        id: 'bot-1',
        name: 'Integration Bot',
        type: 'bot',
        bot: { owner: { type: 'workspace' } },
      }

      mockHttpClient.executeOperation.mockResolvedValue({ data: mockBotUser })

      const tool = unifiedTools.find((t) => t.definition.name === 'notion-users')!
      const result = await tool.handler({ action: 'me' }, mockHttpClient)

      expect(result.success).toBe(true)
      expect(result.bot.id).toBe('bot-1')
    })
  })
})
