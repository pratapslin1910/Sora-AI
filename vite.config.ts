import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleApiRequest } from './src/server/apiRouter.js'
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Shared middleware handler — forwards /api/* requests to the FreeLLMAPI backend.
 * err is narrowed to Error via instanceof to satisfy strict TypeScript.
 */
async function apiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction
): Promise<void> {
  if (req.url && req.url.startsWith('/api/')) {
    try {
      const handled = await handleApiRequest(req, res)
      if (handled) return
    } catch (err: unknown) {
      console.error('API Error:', err)
      if (!res.writableEnded) {
        res.statusCode = 500
        const message = err instanceof Error ? err.message : String(err)
        res.end(JSON.stringify({ error: message }))
      }
      return
    }
  }
  next()
}

export default defineConfig(({ mode }) => {
  // Load environment variables (including server-side keys without VITE_ prefix)
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, val] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'freellmapi-backend-plugin',
        configureServer(server) {
          server.middlewares.use(apiMiddleware)
        },
        configurePreviewServer(server) {
          server.middlewares.use(apiMiddleware)
        },
      },
    ],
  }
})
