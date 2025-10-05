// frontend/src/components/HistoryDag.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import ReactFlow, { Background, Node, Edge } from 'reactflow'
import { createPortal } from 'react-dom'
import 'reactflow/dist/style.css'
import { getHistory, HistoryNode, getNode, NodeDetail } from '../lib/api'

type Props = {
  sessionId: string
  currentNodeId?: string | null
  updateKey?: number
  onSelect: (p: { nodeId: string; artifactId: string }) => void
}

// ---------- helpers ----------
function toMs(ts?: number | null): number | null {
  if (ts == null) return null
  return ts < 1e12 ? ts * 1000 : ts
}
function timeAgo(tsSec?: number | null): string {
  const ms = toMs(tsSec)
  if (ms == null) return ''
  const diff = Date.now() - ms
  if (diff < 5_000) return 'now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
function opDotColor(op: string): string {
  const t = op.toLowerCase()
  if (t.includes('upload')) return '#11cbd7'
  if (t.includes('plot')) return '#1bd8a0'
  if (t.includes('sql')) return '#9e83ff'
  return 'rgba(255,255,255,0.7)'
}
function trunc(s?: string, n = 100) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
function staticSubline(opType: string): string {
  const t = opType.toLowerCase()
  if (t.includes('plot')) return 'plot'
  if (t.includes('sql')) return 'sql query'
  if (t.includes('upload')) return 'file upload'
  return ''
}
// middle-ellipsis for long IDs/paths
function midEllip(s?: string, max = 36) {
  if (!s) return ''
  if (s.length <= max) return s
  const keep = Math.floor((max - 1) / 2)
  return s.slice(0, keep) + '…' + s.slice(-keep)
}

export default function HistoryDag({ sessionId, currentNodeId, updateKey, onSelect }: Props) {
  const [nodesData, setNodesData] = useState<HistoryNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [details, setDetails] = useState<Record<string, NodeDetail | null>>({})

  // Hover state uses viewport (window) coordinates for a fixed-position tooltip
  const [hover, setHover] = useState<{ id: string; winX: number; winY: number } | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const h = await getHistory(sessionId)
        if (!mounted) return
        setNodesData(h.items || [])
        setDetails({})
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

  const ensureDetail = useCallback(async (nodeId: string) => {
    if (details[nodeId] !== undefined) return
    try {
      const d = await getNode(nodeId)
      setDetails(prev => ({ ...prev, [nodeId]: d }))
    } catch {
      setDetails(prev => ({ ...prev, [nodeId]: null }))
    }
  }, [details])

  const { nodes, edges } = useMemo(() => {
    if (!nodesData.length) return { nodes: [] as Node[], edges: [] as Edge[] }

    // indegree + roots
    const indeg = new Map<string, number>()
    nodesData.forEach(n => indeg.set(n.node_id, 0))
    nodesData.forEach(n => n.parent_node_ids.forEach(() => {
      indeg.set(n.node_id, (indeg.get(n.node_id) || 0) + 1)
    }))
    const roots = nodesData.filter(n => (indeg.get(n.node_id) || 0) === 0).map(n => n.node_id)

    // BFS depth
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

    // group by depth
    const byDepth: Record<number, string[]> = {}
    nodesData.forEach(n => {
      const d = depth.get(n.node_id) ?? 0
      ;(byDepth[d] ||= []).push(n.node_id)
    })

    // layout
    const nodeWidth = 200
    const nodeHeight = 58
    const vGap = 110
    const hGap = 220

    const rfNodes: Node[] = []
    Object.entries(byDepth).forEach(([dStr, ids]) => {
      const d = Number(dStr)
      ids.forEach((id, i) => {
        const n = nodesData.find(x => x.node_id === id)!
        const isActive = id === currentNodeId
        const color = opDotColor(n.op_type || '')
        const ago = timeAgo(n.created_at)
        const sub = staticSubline(n.op_type)

        rfNodes.push({
          id,
          position: { x: i * hGap, y: d * vGap },
          data: {
            label: (
              <div style={{ width: '100%', height: '100%', display:'grid', alignContent:'center' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                  <span style={{ fontWeight: 800, letterSpacing: .3, fontSize: 12 }}>
                    {(n.op_type || '').toUpperCase()}
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: color }} />
                </div>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 11, opacity: .85 }}>{ago}</span>
                  {sub && <span style={{ fontSize: 11, opacity: .8, marginLeft: 8 }}>{sub}</span>}
                </div>
              </div>
            )
          },
          style: {
            width: nodeWidth,
            height: nodeHeight,
            borderRadius: 10,
            border: `2px solid ${isActive ? '#7aa2ff' : 'rgba(255,255,255,0.16)'}`,
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            cursor: 'pointer',
            padding: '8px 10px',
          },
        })
      })
    })

    // keep edges
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

  // Use viewport coords so tooltip can escape sidebar/resizer/composer via portal
  const onNodeMouseEnter = useCallback(async (e: any, node: Node) => {
    setHover({ id: node.id, winX: e.clientX + 12, winY: e.clientY + 12 })
    ensureDetail(node.id)
  }, [ensureDetail])

  const onNodeMouseMove = useCallback((e: any) => {
    setHover(prev => (prev ? { ...prev, winX: e.clientX + 12, winY: e.clientY + 12 } : prev))
  }, [])

  const onNodeMouseLeave = useCallback(() => {
    setHover(null)
  }, [])

  const hoveredNode = hover ? nodesData.find(n => n.node_id === hover.id) : undefined
  const hoveredDetail = hover ? details[hover.id] : undefined

  // Tooltip content (clipped long values with middle-ellipsis)
  function tooltipContent(n: HistoryNode, detail?: NodeDetail) {
    const t = (n.op_type || '').toLowerCase()

    const ArtifactLine = (id?: string | null) =>
      id ? (
        <div className="kv-line" style={{ marginTop: 6 }}>
          <span className="k">Artifact:</span>
          <span className="v mono-clip" title={id}>{midEllip(id, 36)}</span>
        </div>
      ) : null

    if (!detail) {
      return (
        <div style={{ fontSize: 12, opacity: 0.9 }}>
          <div style={{ marginBottom: 4, fontWeight: 700 }}>{(n.op_type || 'Op').toUpperCase()}</div>
          <div>When: {n.created_at ? new Date(toMs(n.created_at)!).toLocaleString() : '—'}</div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>Loading details…</div>
          {ArtifactLine(n.primary_artifact_id)}
        </div>
      )
    }

    if (t.includes('plot')) {
      const k = detail.op_params?.kind ?? '?'
      const x = detail.op_params?.x ?? '?'
      const y = detail.op_params?.y ?? '?'
      return (
        <div style={{ fontSize: 12 }}>
          <div style={{ marginBottom: 4, fontWeight: 700 }}>{(n.op_type || 'PLOT').toUpperCase()}</div>
          <div>When: {n.created_at ? new Date(toMs(n.created_at)!).toLocaleString() : '—'}</div>
          <div style={{ marginTop: 6 }}>Kind: {k}</div>
          <div>x: <span className="mono-clip" title={String(x)}>{midEllip(String(x), 48)}</span></div>
          <div>y: <span className="mono-clip" title={String(y)}>{midEllip(String(y), 48)}</span></div>
          {ArtifactLine(n.primary_artifact_id)}
        </div>
      )
    }

    if (t.includes('sql')) {
      const sql = String(detail.op_params?.sql || detail.op_params?.query || '')
      return (
        <div style={{ fontSize: 12 }}>
          <div style={{ marginBottom: 4, fontWeight: 700 }}>SQL</div>
          <div>When: {n.created_at ? new Date(toMs(n.created_at)!).toLocaleString() : '—'}</div>
          {sql && (
            <pre
              style={{
                marginTop: 6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}
            >{trunc(sql, 600)}</pre>
          )}
          {ArtifactLine(n.primary_artifact_id)}
        </div>
      )
    }

    // upload / default
    const name = detail.op_params?.filename || detail.op_params?.name
    return (
      <div style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 4, fontWeight: 700 }}>{(n.op_type || 'UPLOAD').toUpperCase()}</div>
        <div>When: {n.created_at ? new Date(toMs(n.created_at)!).toLocaleString() : '—'}</div>
        {name && (
          <div style={{ marginTop: 6 }}>
            File: <span className="mono-clip" title={String(name)}>{midEllip(String(name), 42)}</span>
          </div>
        )}
        {ArtifactLine(n.primary_artifact_id)}
      </div>
    )
  }

  // clamp tooltip into the viewport
  function tooltipPos(winX: number, winY: number) {
    const TIP_W = 360, TIP_H = 260, PAD = 12
    const maxX = window.innerWidth - TIP_W - PAD
    const maxY = window.innerHeight - TIP_H - PAD
    return { left: Math.max(PAD, Math.min(winX, maxX)), top: Math.max(PAD, Math.min(winY, maxY)) }
  }

  return (
    <div className="dag-shell">
      <style>{`
        .dag-shell {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 16px;
          overflow: hidden;
          height: 100%;
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
        .dag-body { position: relative; width: 100%; height: 100%; }
        .muted { color: #A1AEC6; padding: 10px 12px; }

        .hover-tip {
          position: fixed; /* << key: escape sidebar overflow & stacking */
          max-width: 360px;
          min-width: 220px;
          z-index: 2147483647; /* top-most */
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.16);
          background: rgba(15, 20, 24, 0.96);
          box-shadow: 0 12px 28px rgba(0,0,0,0.45);
          pointer-events: none;
          color: #fff;
          backdrop-filter: blur(6px);
          overflow: hidden;
        }
        .kv-line { display: flex; gap: 6px; align-items: baseline; }
        .k { opacity: .9; }
        .v { opacity: .95; }
        .mono-clip {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 260px;
          display: inline-block;
          vertical-align: bottom;
        }
      `}</style>

      <div className="dag-head">Version Tree</div>
      <div className="dag-body">
        {error && <div className="muted">⚠️ {error}</div>}
        {!error && loading && <div className="muted">Loading…</div>}
        {!error && !loading && nodes.length === 0 && (
          <div className="muted">No nodes yet. Upload a CSV and run an operation.</div>
        )}
        {!error && !loading && nodes.length > 0 && (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              nodesDraggable={false}
              proOptions={{ hideAttribution: true }}
              style={{ background: 'transparent' }}
              fitViewOptions={{ padding: 0.2 }}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseMove={onNodeMouseMove}
              onNodeMouseLeave={onNodeMouseLeave}
            >
              <Background gap={16} color="rgba(255,255,255,0.08)" />
            </ReactFlow>

            {hover && hoveredNode &&
              createPortal(
                <div
                  className="hover-tip"
                  style={tooltipPos(hover.winX, hover.winY)}
                >
                  {tooltipContent(hoveredNode, hoveredDetail)}
                </div>,
                document.body
              )
            }
          </>
        )}
      </div>
    </div>
  )
}
