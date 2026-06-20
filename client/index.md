# Client Directory Index

React 18 + Vite + Tailwind v4 frontend for Camel Kanban.

## Files

- **[main.tsx](./src/main.tsx)** - Entry point; renders App into root DOM
- **[App.tsx](./src/App.tsx)** - Router setup: session check → BoardProvider → route definitions
- **[api.ts](./src/api.ts)** - Typed fetch wrapper for all API calls
- **[types.ts](./src/types.ts)** - Shared TypeScript interfaces (Card, Column, Workspace, AgentBoard, etc.)
- **[index.css](./src/index.css)** - Global styles and Tailwind imports
- **[package.json](./package.json)** - Dependencies: react, react-router, @dnd-kit, recharts, lucide-react, react-markdown
- **[tsconfig.json](./tsconfig.json)** - TypeScript config (bundler resolution, noUnusedLocals enabled)
- **[vite.config.ts](./vite.config.ts)** - Vite bundler config
- **[vitest.config.ts](./vitest.config.ts)** - Test runner config (jsdom environment)
- **[index.html](./index.html)** - HTML entry point

## Subdirectories

### src/context/

Shared React context.

- **[BoardContext.tsx](./src/context/BoardContext.tsx)** - Board state provider: columns, metrics, activity, presence, SSE, toast

### src/layout/

App shell and navigation.

- **[AppLayout.tsx](./src/layout/AppLayout.tsx)** - Main layout with collapsible sidebar; SSE state lives here, survives navigation
- **[Sidebar.tsx](./src/layout/Sidebar.tsx)** - Navigation sidebar component

### src/pages/

Route-level page components.

- **[BoardPage.tsx](./src/pages/BoardPage.tsx)** - Kanban board with @dnd-kit drag-and-drop
- **[DashboardPage.tsx](./src/pages/DashboardPage.tsx)** - Lazy-loaded Recharts KPI cards + 8-week trends
- **[AgentPage.tsx](./src/pages/AgentPage.tsx)** - LLM agent interaction page with streaming
- **[HistoryPage.tsx](./src/pages/HistoryPage.tsx)** - Agent board execution history
- **[ActivityPage.tsx](./src/pages/ActivityPage.tsx)** - Activity feed showing card events
- **[SettingsPage.tsx](./src/pages/SettingsPage.tsx)** - Board and workspace settings

### src/components/

Reusable UI components.

- **[ContextPanel.tsx](./src/components/ContextPanel.tsx)** - Card detail panel; route-driven via `/board/card/:cardId`
- **[CardView.tsx](./src/components/CardView.tsx)** - Individual card rendering
- **[ColumnView.tsx](./src/components/ColumnView.tsx)** - Column container with cards
- **[AuthPage.tsx](./src/components/AuthPage.tsx)** - Login/register authentication page
- **[AgentCardDetail.tsx](./src/components/AgentCardDetail.tsx)** - Agent card detail view with markdown rendering
- **[ArtifactCard.tsx](./src/components/ArtifactCard.tsx)** - Agent artifact display card
- **[ToolTrace.tsx](./src/components/ToolTrace.tsx)** - Tool execution trace visualization
- **[PresenceBar.tsx](./src/components/PresenceBar.tsx)** - Online users presence indicator
- **[TrashZone.tsx](./src/components/TrashZone.tsx)** - Drag target for deleting cards
- **[Toast.tsx](./src/components/Toast.tsx)** - Toast notification component
- **[LogoCropper.tsx](./src/components/LogoCropper.tsx)** - Image cropper for board logo upload
- **[LoadingCamel.tsx](./src/components/LoadingCamel.tsx)** - Lottie loading animation
- **[SuccessAnimation.tsx](./src/components/SuccessAnimation.tsx)** - Lottie success animation

### src/components/agent/

Agent-specific sub-components.

- **[AgentBoardHeader.tsx](./src/components/agent/AgentBoardHeader.tsx)** - Status badge and metadata header for agent board
- **[AgentBoardVisual.tsx](./src/components/agent/AgentBoardVisual.tsx)** - Column grid visualizing per-column execution state
- **[AgentChatPanel.tsx](./src/components/agent/AgentChatPanel.tsx)** - Chat input and conversation thread for agent follow-ups

### src/hooks/

Custom React hooks.

- **[useAgentBoard.ts](./src/hooks/useAgentBoard.ts)** - Agent board fetch and SSE event-driven re-fetch
- **[useAgentChat.ts](./src/hooks/useAgentChat.ts)** - Agent chat send, queue, and conversation state

### src/lib/

Utility modules.

- **[title.ts](./src/lib/title.ts)** - Page title and favicon helpers
- **[agentQueue.ts](./src/lib/agentQueue.ts)** - Agent message queue management
- **[agentStream.ts](./src/lib/agentStream.ts)** - SSE stream handling for agent events
- **[agentBoardSync.ts](./src/lib/agentBoardSync.ts)** - Sync agent board state with kanban board
- **[agentColumnState.ts](./src/lib/agentColumnState.ts)** - Agent column state management
- **[cardPanel.ts](./src/lib/cardPanel.ts)** - Card panel open/close logic
- **[toolTrace.ts](./src/lib/toolTrace.ts)** - Tool trace event parsing
- **[workspaceSelection.ts](./src/lib/workspaceSelection.ts)** - Workspace selection with localStorage persistence
- **[workspaceSwitcher.ts](./src/lib/workspaceSwitcher.ts)** - Workspace switching with limit enforcement
- **[settingsValidation.ts](./src/lib/settingsValidation.ts)** - Settings form validation rules
- **[agentFollowUp.ts](./src/lib/agentFollowUp.ts)** - Converts server conversations to follow-up message format

### src/assets/

Static assets.

- **[success.json](./src/assets/success.json)** - Lottie success animation data
- **[camel-loading.json](./src/assets/camel-loading.json)** - Lottie camel loading animation data

## Test Files

- **[api.test.ts](./src/api.test.ts)** - API client tests
- **[types.test.ts](./src/types.test.ts)** - Type utility tests
- **[title.test.ts](./src/lib/title.test.ts)** - Title helper tests
- **[agentQueue.test.ts](./src/lib/agentQueue.test.ts)** - Agent queue tests
- **[agentStream.test.ts](./src/lib/agentStream.test.ts)** - Agent stream tests
- **[agentBoardSync.test.ts](./src/lib/agentBoardSync.test.ts)** - Board sync tests
- **[agentColumnState.test.ts](./src/lib/agentColumnState.test.ts)** - Column state tests
- **[cardPanel.test.ts](./src/lib/cardPanel.test.ts)** - Card panel tests
- **[toolTrace.test.ts](./src/lib/toolTrace.test.ts)** - Tool trace tests
- **[workspaceSelection.test.ts](./src/lib/workspaceSelection.test.ts)** - Workspace selection tests
- **[workspaceSwitcher.test.ts](./src/lib/workspaceSwitcher.test.ts)** - Workspace switcher tests
- **[settingsValidation.test.ts](./src/lib/settingsValidation.test.ts)** - Settings validation tests
- **[AgentPage.test.tsx](./src/pages/AgentPage.test.tsx)** - Agent page component tests
- **[ArtifactCard.test.tsx](./src/components/ArtifactCard.test.tsx)** - Artifact card tests
- **[AgentCardDetail.test.tsx](./src/components/AgentCardDetail.test.tsx)** - Agent card detail tests
- **[ToolTrace.test.tsx](./src/components/ToolTrace.test.tsx)** - Tool trace component tests
