/**
 * Per-workspace Tasks database schema resolution.
 *
 * The four Tasks databases do NOT share a schema, so get-due-tasks must not
 * hard-code "Due"/"Status". Known workspaces use the table below; anything else
 * (or a renamed property) falls back to detection from the data source schema.
 */

export interface KnownTasksSchema {
  dataSourceId: string
  title: string
  status: string
  due: string
}

export const KNOWN_TASKS_SCHEMAS: Record<string, KnownTasksSchema> = {
  personal: { dataSourceId: '135b4417-f9cb-81a3-857b-000b9fb27289', title: 'Name', status: 'Status', due: 'Due' },
  drapes: { dataSourceId: 'feba1afe-d508-4646-b583-c8fc06f3c1c4', title: 'Task', status: 'Work Status', due: 'Deadline' },
  fourall: { dataSourceId: 'afd2cded-5f2b-46b7-b0bc-d416a230ed3f', title: 'Task name', status: 'Status', due: 'Due' },
  reids: { dataSourceId: 'd1d03277-b7b5-8352-9a5d-87445f14065d', title: 'Task Name', status: 'Status', due: 'Date' },
}

/** Status names treated as closed even when the schema has no "Complete" group. */
export const CLOSED_STATUS_NAMES = ['Done', "Don't Do", 'Archived']

export function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

/** Reverse lookup: which known workspace owns this data source id. */
export function workspaceForDataSource(dsId: string): string | null {
  const n = normalizeId(dsId)
  for (const [ws, k] of Object.entries(KNOWN_TASKS_SCHEMAS)) {
    if (normalizeId(k.dataSourceId) === n) return ws
  }
  return null
}

export interface ResolvedTasksSchema {
  titleProperty: string | null
  statusProperty: string | null
  statusType: 'status' | 'select' | null
  /** Names that mean "closed" (Complete group + Done/Don't Do/Archived that exist). */
  closedStatuses: string[]
  /** Date properties to check, primary due property first. */
  dateProperties: string[]
  assigneeProperty: string | null
}

const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function findProp(properties: Record<string, any>, name: string | undefined, types: string[]): string | null {
  if (!name) return null
  for (const [n, def] of Object.entries(properties)) {
    if (ci(n, name) && types.includes(def?.type)) return n
  }
  return null
}

/**
 * Resolve title/status/date/assignee property names from a data source's
 * `properties` object. `workspace` selects the known mapping, if any.
 */
export function resolveTasksSchema(
  properties: Record<string, any>,
  workspace?: string | null
): ResolvedTasksSchema {
  const known = workspace ? KNOWN_TASKS_SCHEMAS[workspace.toLowerCase()] : undefined
  const entries = Object.entries(properties || {})

  // Title: exactly one title property exists in a Notion database.
  const titleProperty = entries.find(([, d]) => d?.type === 'title')?.[0] ?? null

  // Status: known name -> any status-type prop literally named "status" -> name
  // containing "status" -> first status-type prop. Fall back to select-type with
  // the same preference order (some databases model status as a select).
  let statusProperty: string | null = findProp(properties, known?.status, ['status'])
  let statusType: 'status' | 'select' | null = statusProperty ? 'status' : null
  if (!statusProperty) {
    const pick = (type: string) => {
      const props = entries.filter(([, d]) => d?.type === type).map(([n]) => n)
      return props.find(n => ci(n, 'status'))
        ?? props.find(n => n.toLowerCase().includes('status'))
        ?? (type === 'status' ? props[0] : undefined)
        ?? null
    }
    statusProperty = pick('status')
    statusType = statusProperty ? 'status' : null
    if (!statusProperty) {
      const sel = findProp(properties, known?.status, ['select']) ?? pick('select')
      if (sel) { statusProperty = sel; statusType = 'select' }
    }
  }

  // Closed statuses: the "Complete" group (status type) plus the usual names.
  const closed = new Set<string>()
  if (statusProperty) {
    const def = properties[statusProperty] || {}
    const cfg = def[statusType === 'select' ? 'select' : 'status'] || {}
    const options: any[] = cfg.options || []
    const byId = new Map(options.map(o => [o?.id, o?.name]))
    for (const g of cfg.groups || []) {
      if (/^(complete|completed|done)$/i.test(g?.name || '')) {
        for (const oid of g.option_ids || []) {
          const nm = byId.get(oid)
          if (nm) closed.add(nm)
        }
      }
    }
    const available = new Set(options.map(o => o?.name).filter(Boolean))
    for (const n of CLOSED_STATUS_NAMES) if (available.has(n)) closed.add(n)
  }

  // Dates: known due property -> date prop named Due/Deadline/Date -> (none).
  // "Work Session" is always checked in addition when present.
  const dateNames = entries.filter(([, d]) => d?.type === 'date').map(([n]) => n)
  const primary =
    findProp(properties, known?.due, ['date'])
    ?? ['due', 'deadline', 'date'].map(w => dateNames.find(n => ci(n, w))).find(Boolean)
    ?? null
  const dateProperties: string[] = primary ? [primary] : []
  const ws = dateNames.find(n => ci(n, 'work session'))
  if (ws && !dateProperties.includes(ws)) dateProperties.push(ws)

  const assigneeProperty =
    entries.find(([n, d]) => d?.type === 'people' && ['assignee', 'owner'].includes(n.toLowerCase()))?.[0] ?? null

  return {
    titleProperty,
    statusProperty,
    statusType,
    closedStatuses: [...closed],
    dateProperties,
    assigneeProperty,
  }
}
