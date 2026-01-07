import axios from 'axios'

const baseURL = 'https://api.notion.com'
const token = process.env.NOTION_TOKEN_FOURALL
const database_id = '2c624f67124181778c50d8756ca89af5'

if (!token) {
  console.error('NOTION_TOKEN_FOURALL not set')
  process.exit(1)
}

const client = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2025-09-03'
  }
})

async function test() {
  // Step 1: Get database to see data_sources
  console.log('=== Getting database ===')
  const dbResponse = await client.get(`/v1/databases/${database_id}`)
  console.log('data_sources:', JSON.stringify(dbResponse.data.data_sources, null, 2))

  if (dbResponse.data.data_sources?.length > 0) {
    const dataSourceId = dbResponse.data.data_sources[0].id
    console.log('\n=== Querying via data_sources endpoint ===')
    console.log('Using data_source_id:', dataSourceId)

    try {
      const queryResponse = await client.post(`/v1/data_sources/${dataSourceId}/query`, {
        page_size: 2
      })
      console.log('Query success:', JSON.stringify(queryResponse.data, null, 2).slice(0, 500))
    } catch (error) {
      console.error('Query error:', error.response?.data || error.message)
    }
  } else {
    console.log('No data_sources found, trying direct query')
    try {
      const queryResponse = await client.post(`/v1/databases/${database_id}/query`, {
        page_size: 2
      })
      console.log('Direct query success:', JSON.stringify(queryResponse.data, null, 2).slice(0, 500))
    } catch (error) {
      console.error('Direct query error:', error.response?.data || error.message)
    }
  }
}

test().catch(console.error)
