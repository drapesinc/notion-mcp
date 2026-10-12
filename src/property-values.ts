/**
 * Flatten a Notion `files` property ("Files & media") into name + URL pairs.
 * Notion-hosted files come back as signed S3 URLs that expire after about an
 * hour, so `expiry_time` is passed through for callers that need to fetch them.
 */
export function filesToList(files: any[] | undefined): Array<{ name: string; url: string | null; expiry_time?: string }> {
  return (files || []).map((f: any) => {
    if (f.type === 'external') return { name: f.name, url: f.external?.url ?? null }
    if (f.type === 'file') return { name: f.name, url: f.file?.url ?? null, expiry_time: f.file?.expiry_time }
    // file_upload and any future type: keep the name so the attachment is at least visible
    return { name: f.name, url: null }
  })
}
