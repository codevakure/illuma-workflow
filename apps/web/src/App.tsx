import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ReactFlowProvider } from 'reactflow'
import { SocketProvider } from '@/app/workspace/providers/socket-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/providers/workspace-permissions-provider'
import { GlobalCommandsProvider } from '@/app/workspace/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/providers/provider-models-loader'
import { RegistryLoader } from '@/app/workspace/providers/registry-loader'
import { SettingsLoader } from '@/app/workspace/providers/settings-loader'
import { SessionProvider } from '@/app/_shell/providers/session-provider'
import { TooltipProvider } from '@/app/_shell/providers/tooltip-provider'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'
import { useSession } from '@/lib/auth/auth-client'
import Workflow from '@/app/workflow/page'
import KnowledgePage from '@/app/workspace/knowledge/page'
import LogsPage from '@/app/workspace/logs/page'
import TemplatesPage from '@/app/workspace/templates/page'
import TemplateDetailPage from '@/app/workspace/templates/detail'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import ChatPage from '@/app/chat/page'
import FormPage from '@/app/form/page'
import ResumePage from '@/app/resume/page'

function WorkspaceLayout() {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <p className='text-sm text-[var(--text-tertiary)]'>Loading...</p>
      </div>
    )
  }

  return (
    <SocketProvider user={session?.user ? { id: session.user.id, name: session.user.name ?? undefined, email: session.user.email } : undefined}>
      <WorkspacePermissionsProvider>
        <GlobalCommandsProvider>
          <RegistryLoader />
          <ProviderModelsLoader />
          <SettingsLoader />
          <Routes>
            <Route path="w/:workflowId" element={<WorkflowPage />} />
            <Route path="w" element={<WorkspaceHome />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="templates/:templateId" element={<TemplateDetailPage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="*" element={<Navigate to="w" replace />} />
          </Routes>
        </GlobalCommandsProvider>
      </WorkspacePermissionsProvider>
    </SocketProvider>
  )
}

function WorkflowPage() {
  return (
    <div className='flex h-screen w-full overflow-hidden'>
      <Sidebar />
      <main className='flex h-full flex-1 flex-col overflow-hidden'>
        <ReactFlowProvider>
          <Workflow />
        </ReactFlowProvider>
      </main>
    </div>
  )
}

function WorkspaceHome() {
  return (
    <div className='flex h-screen w-full overflow-hidden'>
      <Sidebar />
      <main className='flex h-full flex-1 flex-col items-center justify-center overflow-hidden'>
        <p className='text-sm text-[var(--text-tertiary)]'>Select or create a workflow to get started</p>
      </main>
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2 style={{ color: 'red' }}>React Error</h2>
          <p><strong>{this.state.error.message}</strong></p>
          <pre style={{ fontSize: 12, color: '#666' }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 12, padding: '6px 12px' }}>
            Dismiss
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function AuthCallback() {
  return <Navigate to="/workspace/default/w" replace />
}

export function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <TooltipProvider>
        <SessionProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/workspace/default/w" replace />} />
            <Route path="/workspace/:workspaceId/*" element={<WorkspaceLayout />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/chat/:identifier" element={<ChatPage />} />
            <Route path="/form/:identifier" element={<FormPage />} />
            <Route path="/resume/:workflowId/:executionId" element={<ResumePage />} />
            <Route path="/resume/:workflowId/:executionId/:contextId" element={<ResumePage />} />
            <Route path="*" element={<Navigate to="/workspace/default/w" replace />} />
          </Routes>
        </SessionProvider>
      </TooltipProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
