/**
 * DAG builder stub for client-side compilation.
 */
export interface DAG {
  nodes: Map<string, unknown>
  edges: Map<string, unknown[]>
}

export class DAGBuilder {
  build(): DAG {
    throw new Error('DAGBuilder is only available on the server')
  }
}
