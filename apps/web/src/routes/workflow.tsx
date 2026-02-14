import { useParams, Link } from 'react-router-dom'
import { useWorkflow, useUpdateWorkflow } from '@/hooks/useWorkflows'
import { useState } from 'react'

export function WorkflowPage() {
  const { id } = useParams<{ id: string }>()
  const { data: workflow, isLoading, error } = useWorkflow(id!)
  const updateWorkflow = useUpdateWorkflow(id!)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const startEditing = () => {
    if (workflow) {
      setEditName(workflow.name)
      setEditDescription(workflow.description || '')
      setIsEditing(true)
    }
  }

  const handleSave = async () => {
    try {
      await updateWorkflow.mutateAsync({
        name: editName,
        description: editDescription,
      })
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to update workflow:', err)
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Loading workflow...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: '#ef4444' }}>Error: {(error as Error).message}</p>
        <Link to="/workflows">Back to workflows</Link>
      </div>
    )
  }

  if (!workflow) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Workflow not found</p>
        <Link to="/workflows">Back to workflows</Link>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link to="/workflows">&larr; Back to workflows</Link>
      </nav>

      <header
        style={{
          marginBottom: '2rem',
          padding: '1.5rem',
          background: '#1a1a1a',
          borderRadius: '8px',
          borderLeft: `4px solid ${workflow.color}`,
        }}
      >
        {isEditing ? (
          <div>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={inputStyle}
              placeholder="Workflow name"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              style={{ ...inputStyle, marginTop: '0.5rem', minHeight: '80px' }}
              placeholder="Description (optional)"
            />
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleSave} disabled={updateWorkflow.isPending} style={buttonStyle}>
                {updateWorkflow.isPending ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setIsEditing(false)} style={{ ...buttonStyle, background: '#666' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h1>{workflow.name}</h1>
              <button onClick={startEditing} style={buttonStyle}>
                Edit
              </button>
            </div>
            {workflow.description && (
              <p style={{ color: '#888', marginTop: '0.5rem' }}>{workflow.description}</p>
            )}
          </div>
        )}
      </header>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Workflow State</h2>
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
          }}
        >
          <p>Blocks: {Object.keys(workflow.state.blocks).length}</p>
          <p>Edges: {workflow.state.edges.length}</p>
          <p>Loops: {Object.keys(workflow.state.loops).length}</p>
          <p>Parallels: {Object.keys(workflow.state.parallels).length}</p>
          <p>Deployed: {workflow.state.isDeployed ? 'Yes' : 'No'}</p>
        </div>
      </section>

      <section>
        <h2>Debug Info</h2>
        <pre
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '8px',
            overflow: 'auto',
            fontSize: '0.8rem',
          }}
        >
          {JSON.stringify(workflow, null, 2)}
        </pre>
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
  background: '#0a0a0a',
  color: 'white',
  border: '1px solid #333',
  borderRadius: '6px',
  width: '100%',
  fontSize: '1rem',
}
