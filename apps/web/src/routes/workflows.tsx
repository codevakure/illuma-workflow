import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkflows, useCreateWorkflow, useDeleteWorkflow } from '@/hooks/useWorkflows'
import { useSession } from '@/auth/context'

export function WorkflowsPage() {
  const { user, login, isAuthenticated } = useSession()
  const { data: workflows, isLoading, error } = useWorkflows()
  const createWorkflow = useCreateWorkflow()
  const deleteWorkflow = useDeleteWorkflow()

  const [newWorkflowName, setNewWorkflowName] = useState('')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWorkflowName.trim()) return

    try {
      await createWorkflow.mutateAsync({ name: newWorkflowName })
      setNewWorkflowName('')
    } catch (err) {
      console.error('Failed to create workflow:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) return

    try {
      await deleteWorkflow.mutateAsync(id)
    } catch (err) {
      console.error('Failed to delete workflow:', err)
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Illuma Studio</h1>
        {isAuthenticated ? (
          <span>Logged in as {user?.email || user?.id}</span>
        ) : (
          <button onClick={login} style={buttonStyle}>
            Login
          </button>
        )}
      </header>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Create Workflow</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <input
            type="text"
            value={newWorkflowName}
            onChange={(e) => setNewWorkflowName(e.target.value)}
            placeholder="Workflow name"
            style={inputStyle}
          />
          <button type="submit" disabled={createWorkflow.isPending} style={buttonStyle}>
            {createWorkflow.isPending ? 'Creating...' : 'Create'}
          </button>
        </form>
      </section>

      <section>
        <h2>Workflows</h2>

        {isLoading && <p>Loading workflows...</p>}

        {error && (
          <p style={{ color: '#ef4444' }}>Error loading workflows: {(error as Error).message}</p>
        )}

        {workflows && workflows.length === 0 && (
          <p style={{ color: '#666', marginTop: '1rem' }}>No workflows yet. Create one above!</p>
        )}

        {workflows && workflows.length > 0 && (
          <ul style={{ listStyle: 'none', marginTop: '1rem' }}>
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                style={{
                  padding: '1rem',
                  marginBottom: '0.5rem',
                  background: '#1a1a1a',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderLeft: `4px solid ${workflow.color}`,
                }}
              >
                <div>
                  <Link to={`/workflows/${workflow.id}`} style={{ fontSize: '1.1rem', fontWeight: 500 }}>
                    {workflow.name}
                  </Link>
                  {workflow.description && (
                    <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                      {workflow.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(workflow.id)}
                  disabled={deleteWorkflow.isPending}
                  style={{ ...buttonStyle, background: '#dc2626' }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.9rem',
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#1a1a1a',
  color: 'white',
  border: '1px solid #333',
  borderRadius: '6px',
  flex: 1,
  fontSize: '0.9rem',
}
