import { serve } from '@hono/node-server'
import app from './index.js'

const port = parseInt(process.env.PORT || '3000')

console.log(`[元擎智算] Starting server on port ${port}...`)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[元擎智算] Server running at http://0.0.0.0:${info.port}`)
})
