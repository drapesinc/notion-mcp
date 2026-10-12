import { describe, it, expect } from 'vitest'
import { filesToList } from '../property-values.js'

describe('filesToList', () => {
  it('returns name and signed URL for Notion-hosted files', () => {
    expect(filesToList([
      { name: 'order-fulfilment-map.pdf', type: 'file', file: { url: 'https://s3/x.pdf', expiry_time: '2026-10-06T13:00:00.000Z' } },
    ])).toEqual([{ name: 'order-fulfilment-map.pdf', url: 'https://s3/x.pdf', expiry_time: '2026-10-06T13:00:00.000Z' }])
  })

  it('returns external links as-is', () => {
    expect(filesToList([{ name: 'Board', type: 'external', external: { url: 'https://miro.com/b' } }]))
      .toEqual([{ name: 'Board', url: 'https://miro.com/b' }])
  })

  it('keeps the name for unknown types and handles empty input', () => {
    expect(filesToList([{ name: 'upload.pdf', type: 'file_upload', file_upload: { id: 'abc' } }]))
      .toEqual([{ name: 'upload.pdf', url: null }])
    expect(filesToList(undefined)).toEqual([])
  })
})
