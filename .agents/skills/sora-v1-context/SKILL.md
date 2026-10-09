---
name: sora-v1-context
description: Architecture, configuration, endpoints, and workflows for the Sora V1 desktop AI assistant and IDE application.
---

# Sora V1 — Agent Skills & Repository Knowledge Base

This skill provides persistent knowledge about the `Sora_V1` codebase. Agents should reference this skill rather than repeatedly inspecting configuration files or small source modules.

---

## 1. Project Overview & Environment

- **Project**: `sora-v1`
- **Application Structure**: Sora AI Workspace — desktop web application featuring two dedicated workspaces:
  1. **Assistant (`assistant`)**: Full-featured Sora AI Chat with streaming completions, cross-chat memory, and web browsing.
  2. **IDE (`ide`)**: In-browser IDE with live filesystem tree, multi-file code editor, file creation/deletion, and powershell terminal command runner.
- **Frontend Stack**: React 19 (`react`, `react-dom`), TypeScript 5.7, Vite 8, TailwindCSS v4 (`@tailwindcss/vite`).
- **Backend Stack**: Embedded Vite server middleware (`vite.config.ts`) driving Node.js ESM routes via `src/server/apiRouter.js`.
- **Target OS & Shell**: Windows 11 with PowerShell.
  - **PowerShell Rule**: Use `;` (semicolon) for command chaining. **NEVER use `&&`**.
- **Dev Server**: `npm run dev` (runs on `http://localhost:5173` or `http://localhost:5174`).
- **Test Runner**: `npm test` (`node --test test/*.test.mjs`).
- **Build / Lint**: `npm run build` (`vite build`), `npx tsc --noEmit` for type checking.

---

## 2. Workspace Structure & Active Views

The application strictly contains **two primary tabs**:

```
src/
├── App.tsx                     # Main layout: TopNavbar, active view switcher, BottomStatusBar, Settings Modal
├── main.jsx                    # Vite entrypoint mounting <App />
├── index.css                   # Global styles & Tailwind v4 `@import "tailwindcss";`
├── views/
│   ├── AssistantView.tsx       # AI Assistant wrapper around SoraChat
│   └── IDEView.tsx             # Complete IDE with file explorer, code editor, terminal runner, and "Ask Sora" button
├── components/
│   └── common/
│       ├── TopNavbar.tsx       # Top bar with logo, tab selector ('assistant' | 'ide'), gateway status, and settings button
│       └── BottomStatusBar.tsx # Status bar: FreeLLMAPI port, model status, live UTC clock, system health
├── services/
│   └── chatService.ts          # Frontend API client (gateway health, chat completion, history, memory, IDE FS & execution)
└── server/                     # Backend server & router modules
```

> **Note on Removed Features**: All legacy intelligence features (World Map, Live News, Financial Markets, Research, and Leaflet dependencies) have been completely removed. Do not reintroduce them.

---

## 3. Backend Endpoints (`src/server/apiRouter.js`)

All requests under `/api/*` are handled by `src/server/apiRouter.js` via Vite middleware:

### Health & Models
- `GET /api/health` — FreeLLMAPI gateway health (`checkGatewayHealth`)
- `GET /api/models` — List available models from gateway (default port 31415)

### Chat & Completions
- `POST /api/chat` — Streaming (SSE) or JSON chat completions via `FreeLLMAPIProvider.js`. Suppresses thinking tokens if configured.
- `GET /api/chats` — List saved chat sessions from `chatStore.js`
- `GET /api/chats/:id` — Retrieve specific chat session
- `POST /api/chats` — Create / update chat session
- `DELETE /api/chats/:id` — Delete chat session
- `GET /api/chats/search?q=...` — Semantic vector search across past chats

### Memory & Context Recall
- `GET /api/memories` — List long-term user memories
- `POST /api/memories` — Store new memory
- `DELETE /api/memories/:id` — Remove memory
- `GET /api/memories/search?q=...` — Semantic / keyword memory search
- `POST /api/memories/detect` — Automatic memory entity extraction from user prompts
- `GET /api/context/recall?q=...&chatId=...` — Cross-chat contextual recall combining memories and turns

### Web Search & Browsing
- `POST /api/search` — DuckDuckGo HTML web search with instant answer cards (`webSearch.js`)
- `POST /api/read-site` — Web scraping, sanitization, and Markdown extraction (`siteReader.js`)

### IDE Filesystem & Terminal Execution
- `GET /api/ide/info` — Workspace root directory, Node version, and platform info
- `GET /api/ide/list?path=...` — List files and directories (ignores `.git` and `node_modules`)
- `GET /api/ide/read?path=...` — Read file content (UTF-8)
- `POST /api/ide/write` — Write content to file (auto-creates parent directories)
- `POST /api/ide/create` — Create empty file or directory
- `POST /api/ide/delete` — Recursively delete file or directory
- `POST /api/ide/exec` — Run command in PowerShell with timeout and return stdout, stderr, exitCode

---

## 4. Key Dependencies & Quirks

1. **React 19 & Dependency Resolution**:
   - `package.json` uses React 19 (`^19.2.8`).
   - If installing any new packages via `npm install`, ALWAYS add `--legacy-peer-deps` to prevent peer dependency resolution errors.
2. **TypeScript Strictness**:
   - `tsconfig.json` has `"strict": true` and `"noUnusedLocals": true`.
   - Any unused variable or unused import will fail `npx tsc --noEmit`. Keep all imports minimal and active.
3. **TailwindCSS v4**:
   - Uses Vite plugin `@tailwindcss/vite`.
   - Standard `@import "tailwindcss";` in `src/index.css`.
   - No separate `tailwind.config.js` exists.
4. **Vector Database**:
   - Uses embedded `@lancedb/lancedb` with `apache-arrow` for vector embeddings in `chatStore.js` and `memoryStore.js`.
5. **Gateway Configuration**:
   - Local gateway URL defaults to `http://127.0.0.1:31415/v1`.
   - Configurable via `.env` (`FREELLMAPI_BASE_URL`, `FREELLMAPI_API_KEY`, `FREELLMAPI_DEFAULT_MODEL`).

---

## 5. Verification Commands Quick Sheet

- **Typecheck**: `npx tsc --noEmit`
- **Unit / Integration Tests**: `npm test`
- **Build**: `npm run build`
- **Lint**: `npm run lint` (uses `oxlint`)
- **Dev Server**: `npm run dev`
