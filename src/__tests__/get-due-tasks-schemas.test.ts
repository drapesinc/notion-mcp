import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { unifiedTools } from '../unified-tools'
import { resolveTasksSchema, KNOWN_TASKS_SCHEMAS } from '../tasks-schema'

vi.mock('../openapi-mcp-server/client/http-client')

const statusProp = (closed: string[], open: string[]) => ({
  type: 'status',
  status: {
    options: [...open, ...closed].map((name, i) => ({ id: `o${i}`, name })),
    groups: [
      { name: 'To-do', option_ids: open.map((_, i) => `o${i}`) },
      { name: 'Complete', option_ids: closed.map((_, i) => `o${open.length + i}`) },
    ],
  },
})

interface Case {
  ws: string
  title: string
  status: string
  due: string
  closed: string[]
  extra?: Record<string, any>
}

const CASES: Case[] = [
  { ws: 'personal', title: 'Name', status: 'Status', due: 'Due', closed: ['Done'], extra: { Priority: { type: 'status', status: { options: [], groups: [] } } } },
  { ws: 'drapes', title: 'Task', status: 'Work Status', due: 'Deadline', closed: ['Done', "Don't Do"], extra: { 'Work Session': { type: 'date' }, Assignee: { type: 'people' } } },
  { ws: 'fourall', title: 'Task name', status: 'Status', due: 'Due', closed: ['Done', 'Archived'], extra: { Owner: { type: 'people' } } },
  { ws: 'reids', title: 'Task Name', status: 'Status', due: 'Date', closed: ['Done'] },
]

function schemaFor(c: Case) {
  return {
    [c.title]: { type: 'title' },
    [c.status]: statusProp(c.closed, ['Not started', 'In progress']),
    [c.due]: { type: 'date' },
    ...(c.extra || {}),
  }
}

describe('resolveTasksSchema', () => {
  for (const c of CASES) {
    it(`resolves ${c.ws} schema (known mapping)`, () => {
      const r = resolveTasksSchema(schemaFor(c), c.ws)
      expect(r.titleProperty).toBe(c.title)
      expect(r.statusProperty).toBe(c.status)
      expect(r.dateProperties[0]).toBe(c.due)
      expect([...r.closedStatuses].sort()).toEqual([...c.closed].sort())
    })

    it(`detects ${c.ws} schema without a workspace hint`, () => {
      const r = resolveTasksSchema(schemaFor(c), null)
      expect(r.titleProperty).toBe(c.title)
      expect(r.statusProperty).toBe(c.status)
      expect(r.dateProperties[0]).toBe(c.due)
    })
  }

  it('reads closed statuses from the Complete group, including custom names', () => {
    const r = resolveTasksSchema({
      T: { type: 'title' },
      Status: statusProp(['Shipped', 'Cancelled'], ['Open']),
      Due: { type: 'date' },
    }, null)
    expect(r.closedStatuses.sort()).toEqual(['Cancelled', 'Shipped'])
  })

  it('supports a select-type status property', () => {
    const r = resolveTasksSchema({
      T: { type: 'title' },
      'Work Status': { type: 'select', select: { options: [{ id: 'a', name: 'Open' }, { id: 'b', name: 'Done' }] } },
      Deadline: { type: 'date' },
    }, null)
    expect(r.statusType).toBe('select')
    expect(r.statusProperty).toBe('Work Status')
    expect(r.closedStatuses).toEqual(['Done'])
  })
})

describe('notion-database get-due-tasks per workspace schema', () => {
  let http: any
  const tool = () => unifiedTools.find(t => t.definition.name === 'notion-database')!
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    // The real server usually has NO NOTION_DS_TASKS_* env vars set.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('NOTION_DS_TASKS_') || k.startsWith('NOTION_DB_TASKS_')) {
        saved[k] = process.env[k]
        delete process.env[k]
      }
    }
    http = { executeOperation: vi.fn().mockResolvedValue({ data: { results: [] } }), rawRequest: vi.fn() }
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
  })

  for (const c of CASES) {
    it(`${c.ws}: queries the known data source with the right properties`, async () => {
      const page = {
        id: 'p1', url: 'https://notion.so/p1',
        properties: {
          [c.title]: { type: 'title', title: [{ plain_text: 'A task' }] },
          [c.due]: { type: 'date', date: { start: '2026-10-01' } },
          [c.status]: { type: 'status', status: { name: 'In progress' } },
        },
      }
      http.rawRequest
        .mockResolvedValueOnce({ data: { id: KNOWN_TASKS_SCHEMAS[c.ws].dataSourceId, properties: schemaFor(c) } })
        .mockResolvedValue({ data: { results: [page] } })

      // workspace arrives via ctx (as the proxy passes it)
      const res = await tool().handler(
        { action: 'get-due-tasks', include_details: false, overdue_floor_days: -1, days_ahead: 7 },
        http,
        { workspace: c.ws }
      )

      expect(res.success).toBe(true)
      expect(res.workspace).toBe(c.ws)
      expect(res.total_tasks).toBe(1)
      expect(res.tasks[0].title).toBe('A task')
      expect(res.tasks[0].status).toBe('In progress')
      expect(res.tasks[0].due).toBe('2026-10-01')
      expect(res.errors).toBeUndefined()

      const [, schemaPath] = http.rawRequest.mock.calls[0]
      expect(schemaPath).toBe(`/v1/data_sources/${KNOWN_TASKS_SCHEMAS[c.ws].dataSourceId}`)

      const body = http.rawRequest.mock.calls[1][2]
      const json = JSON.stringify(body.filter)
      expect(json).toContain(`"property":"${c.due}"`)
      expect(json).toContain(`"property":"${c.status}"`)
      for (const closed of c.closed) expect(json).toContain(`"does_not_equal":${JSON.stringify(closed)}`)
      expect(body.sorts[0].property).toBe(c.due)
    })
  }

  it('does not report "unknown" and errors loudly when the workspace has no data source', async () => {
    const res = await tool().handler({ action: 'get-due-tasks', include_details: false }, http, { workspace: 'nope' })
    expect(res.total_tasks).toBe(0)
    expect(res.workspace).toBe('nope')
    expect(res.errors?.[0]).toMatch(/No Tasks data source known/)
  })

  it('honours an explicit data_source_id and reports the matching workspace', async () => {
    const c = CASES[1]
    http.rawRequest
      .mockResolvedValueOnce({ data: { properties: schemaFor(c) } })
      .mockResolvedValue({ data: { results: [] } })
    const res = await tool().handler(
      { action: 'get-due-tasks', include_details: false, data_source_id: KNOWN_TASKS_SCHEMAS.drapes.dataSourceId },
      http
    )
    expect(res.workspace).toBe('drapes')
    expect(http.rawRequest.mock.calls[0][1]).toBe(`/v1/data_sources/${KNOWN_TASKS_SCHEMAS.drapes.dataSourceId}`)
  })
})
