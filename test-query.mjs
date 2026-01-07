import axios from 'axios'

const baseURL = 'https://api.notion.com'
// Try both tokens
const tokenFourall = process.env.NOTION_TOKEN_FOURALL
const tokenPersonal = process.env.NOTION_TOKEN_PERSONAL

// Use the fourall database
const database_id = '2c624f67124181778c50d8756ca89af5'
const token = tokenFourall || tokenPersonal

if (!token) {
  console.error('No NOTION_TOKEN found')
  console.error('Available env vars with NOTION:', Object.keys(process.env).filter(k => k.includes('NOTION')))
  process.exit(1)
}

console.log('Using token from:', tokenFourall ? 'FOURALL' : 'PERSONAL')

const directAxios = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'notion-mcp-server',
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2026-01'
  }
})

async function test() {
  const path = `/v1/databases/${database_id}/query`
  const body = { page_size: 2 }

  console.log('BaseURL:', baseURL)
  console.log('Path:', path)
  console.log('Full URL:', `${baseURL}${path}`)
  console.log('Body:', JSON.stringify(body))

  try {
    const response = await directAxios.request({
      method: 'post',
      url: path,
      data: body
    })
    console.log('Success:', JSON.stringify(response.data, null, 2).slice(0, 500))
  } catch (error) {
    console.error('Error:', error.message)
    console.error('Status:', error.response?.status)
    console.error('Response:', JSON.stringify(error.response?.data, null, 2))
    console.error('Request URL:', error.config?.url)
    console.error('Request baseURL:', error.config?.baseURL)
  }
}

test()
