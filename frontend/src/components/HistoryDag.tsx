// frontend/src/components/HistoryDag.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import ReactFlow, { Background, Node, Edge } from 'reactflow'
import 'reactflow/dist/style.css'
import { getHistory, HistoryNode } from '../lib/api'

type Props = {
  sessionId: string
  currentNodeId?: string | null
  updateKey?: number
  onSelect: (p: { nodeId: string; artifactId: string }) => void
}

export default function HistoryDag({ sessionId, currentNodeId, updateKey, onSelect }: Props) {
  const [nodesData, setNodesData] = useState<HistoryNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const h = await getHistory(sessionId)
        if (!mounted) return
        setNodesData(h.items || [])
      } catch (e: any) {
        if (!mounted) return
        setError(e.message || 'Failed to load history')
      } finally {
        if (!mounted) return
        setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [sessionId, updateKey])

  const { nodes, edges } = useMemo(() => {
    if (!nodesData.length) return { nodes: [] as Node[], edges: [] as Edge[] }
    const idToNode = new Map(nodesData.map(n => [n.node_id, n]))

    // compute roots/depth with BFS
    const indeg = new Map<string, number>()
    nodesData.forEach(n => indeg.set(n.node_id, 0))
    nodesData.forEach(n => n.parent_node_ids.forEach(p =>
      indeg.set(n.node_id, (indeg.get(n.node_id) || 0) + 1)
    ))
    const roots = nodesData.filter(n => (indeg.get(n.node_id) || 0) === 0).map(n => n.node_id)

    const depth = new Map<string, number>()
    const queue = [...roots]
    roots.forEach(r => depth.set(r, 0))
    while (queue.length) {
      const u = queue.shift()!
      const d = depth.get(u) || 0
      const children = nodesData.filter(n => n.parent_node_ids.includes(u))
      for (const c of children) {
        if (!depth.has(c.node_id)) {
          depth.set(c.node_id, d + 1)
          queue.push(c.node_id)
        }
      }
    }

    // group by depth (top→down)
    const byDepth: Record<number, string[]> = {}
    nodesData.forEach(n => {
      const d = depth.get(n.node_id) ?? 0
      byDepth[d] ||= []
      byDepth[d].push(n.node_id)
    })

    // vertical layout
    const nodeWidth = 170
    const nodeHeight = 46
    const vGap = 110  // vertical gap between layers (depth)
    const hGap = 210  // horizontal gap between siblings

    const rfNodes: Node[] = []
    Object.entries(byDepth).forEach(([dStr, ids]) => {
      const d = Number(dStr) // vertical layer
      ids.forEach((id, i) => {
        rfNodes.push({
          id,
          data: { label: (idToNode.get(id)!.op_type || '').toUpperCase() },
          position: { x: i * hGap, y: d * vGap }, // depth = y
          style: {
            width: nodeWidth,
            height: nodeHeight,
            borderRadius: 10,
            border: `2px solid ${id === currentNodeId ? '#7aa2ff' : 'rgba(255,255,255,0.16)'}`,
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            cursor: 'pointer',
          },
        })
      })
    })

    const rfEdges: Edge[] = []
    nodesData.forEach(n => {
      n.parent_node_ids.forEach(p => {
        rfEdges.push({
          id: `${p}->${n.node_id}`,
          source: p,
          target: n.node_id,
          style: { stroke: 'rgba(255,255,255,0.28)' },
          animated: false,
        })
      })
    })

    return { nodes: rfNodes, edges: rfEdges }
  }, [nodesData, currentNodeId])

  const onNodeClick = useCallback((_: any, node: Node) => {
    const found = nodesData.find(n => n.node_id === node.id)
    if (found) onSelect({ nodeId: found.node_id, artifactId: found.primary_artifact_id })
  }, [nodesData, onSelect])

  return (
    <div className="dag-shell">
      <style>{`
        .dag-shell {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 16px;
          overflow: hidden;
          height: 100%;                /* fill the sticky column */
          min-width: 0;
          display: grid;
          grid-template-rows: auto 1fr;
        }
        .dag-head {
          padding: 10px 12px;
          font-weight: 600;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
        }
        .dag-body { width: 100%; height: 100%; }
        .muted { color: #A1AEC6; padding: 10px 12px; }
      `}</style>

      <div className="dag-head">History</div>
      <div className="dag-body">
        {error && <div className="muted">⚠️ {error}</div>}
        {!error && loading && <div className="muted">Loading…</div>}
        {!error && !loading && nodes.length === 0 && (
          <div className="muted">No nodes yet. Upload a CSV and run an operation.</div>
        )}
        {!error && !loading && nodes.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
            style={{ background: 'transparent' }}
            fitViewOptions={{ padding: 0.2 }}
            onNodeClick={onNodeClick}
          >
            <Background gap={16} color="rgba(255,255,255,0.08)" />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}
