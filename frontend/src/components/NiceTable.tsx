// frontend/src/components/NiceTable.tsx
import React, { useMemo, useRef, useLayoutEffect } from 'react'

type Props = {
  columns: string[]
  rows: any[]
  artifactId?: string
  caption?: string
  maxHeight?: number
}

function isNumberLike(val: unknown) {
  if (typeof val === 'number') return Number.isFinite(val)
  if (val === null || val === undefined || val === '') return false
  const n = Number(val)
  return Number.isFinite(n) && String(val).trim() !== ''
}
function formatNumber(val: unknown) {
  if (typeof val === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(val)
  const n = Number(val)
  if (!Number.isFinite(n)) return String(val ?? '')
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n)
}
function toCell(val: unknown) { return isNumberLike(val) ? formatNumber(val) : String(val ?? '') }

function toCsv(columns: string[], rows: any[]) {
  const esc = (s: any) => {
    const t = String(s ?? '')
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const head = columns.map(esc).join(',')
  const body = rows.map(r => columns.map(c => esc((r as any)[c])).join(',')).join('\n')
  return `${head}\n${body}`
}

export default function NiceTable({ columns, rows, artifactId, caption, maxHeight = 360 }: Props) {
  const csv = useMemo(() => toCsv(columns, rows), [columns, rows])

  // Decide per-column alignment by sampling values
  const isNumericCol = useMemo(() => {
    const SAMPLE = 60
    return columns.map(c => {
      let total = 0, numeric = 0
      for (let i = 0; i < rows.length && total < SAMPLE; i++) {
        const v = (rows[i] as any)[c]
        if (v !== null && v !== undefined && v !== '') {
          total++
          if (isNumberLike(v)) numeric++
        }
      }
      return total > 0 && numeric / total >= 0.7
    })
  }, [columns, rows])

  // Auto description
  const autoDesc = useMemo(() => {
    const rc = rows.length
    const cc = columns.length
    const head = `${rc.toLocaleString()} rows × ${cc.toLocaleString()} columns`
    if (cc === 0) return head
    const preview = columns.slice(0, 4)
    const more = cc > 4 ? `, +${cc - 4} more` : ''
    return `${head} — ${preview.join(', ')}${more}`
  }, [columns, rows])
  const normalized = (caption || '').trim().toLowerCase()
  const looksLikeDefaultTitle =
    normalized.startsWith("here’s your table") || normalized.startsWith("here's your table")
  const desc = !caption || looksLikeDefaultTitle ? autoDesc : caption

  // --- Standardize visible width to match surrounding content ---
  const COL_MIN_PX = 180
  const intrinsicMin = Math.max(columns.length * COL_MIN_PX, 0)

  // Measure the wrapper width and keep it updated (resizes, sidebar drag, etc.)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapWidth, setWrapWidth] = React.useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect
        setWrapWidth(Math.max(0, Math.floor(cr.width)))
      }
    })
    ro.observe(el)
    setWrapWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // The table should be at least as wide as the wrapper, or wider if many cols.
  const effectiveMinWidth = Math.max(intrinsicMin, wrapWidth)

  const alignClass = (i: number) => (i === 0 ? 'nt-left' : (isNumericCol[i] ? 'nt-right' : 'nt-left'))

  return (
    <div className="nt-card">
      <style>{`
        /* STATIC rules only: safe to duplicate across multiple tables */

        .nt-card{
          border:1px solid var(--line);
          border-radius:12px;
          background: rgba(255,255,255,0.03);
          overflow:hidden;
          position: relative;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .nt-head{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:10px 12px;
          border-bottom:1px solid var(--line);
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(4px);
        }
        .nt-title{
          font-weight:700; letter-spacing:.2px; opacity:.95; font-size:13px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .nt-actions{ display:flex; gap:8px; align-items:center; }
        .nt-btn{
          appearance:none; padding:6px 10px; border-radius:10px;
          border:1px solid var(--line); background: rgba(255,255,255,0.10);
          color:#fff; font-weight:800; font-size:12px; cursor:pointer;
          display:inline-flex; align-items:center; gap:8px; text-decoration:none;
        }
        .nt-btn:hover{ border-color: var(--ring); }

        .nt-wrap{
          /* dynamic max-height applied inline */
          overflow: auto;     /* both axes */
          overflow-x: auto;   /* explicit horizontal scroll */
          width: 100%;
          box-sizing: border-box;
        }

        table.nt{
          width: 100%;
          /* dynamic min-width applied inline to standardize visible width */
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
          box-sizing: border-box;
        }

        thead th, tbody td{
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding:10px 12px;
        }
        thead th{
          position:sticky; top:0; z-index:1;
          font-size:12px; color:var(--muted); font-weight:800;
          background: rgba(255,255,255,0.08);
          border-bottom:1px solid var(--line);
          backdrop-filter: blur(4px);
        }
        tbody td{
          font-size:14px; border-bottom:1px solid rgba(255,255,255,0.08);
          vertical-align:top;
        }
        tbody tr:nth-child(2n) td{ background: rgba(255,255,255,0.03); }
        tbody tr:hover td{ background: rgba(255,255,255,0.05); }

        .nt-left { text-align:left; }
        .nt-right { text-align:right; font-variant-numeric: tabular-nums; }

        .nt-foot{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:8px 12px;
          border-top:1px solid rgba(255,255,255,0.22);
          background: rgba(7,10,13,0.88);
        }
        .nt-footline{
          font-size:11px; line-height:1.3;
          color:#B8C2D9; font-weight:700;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%;
        }
      `}</style>

      <div className="nt-head">
        <div className="nt-title">{desc}</div>

        <div className="nt-actions">
          <button
            className="nt-btn"
            onClick={() => {
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'table.csv'
              document.body.appendChild(a)
              a.click()
              a.remove()
              URL.revokeObjectURL(url)
            }}
            title="Download CSV"
          >
            Download
          </button>
        </div>
      </div>

      {/* The measured wrapper — this defines the visible width */}
      <div
        className="nt-wrap"
        ref={wrapRef}
        style={{ maxHeight }}
      >
        <table
          className="nt"
          style={{ minWidth: effectiveMinWidth }}
        >
          {/* NOTE: no <colgroup> — that blocked horizontal scroll earlier */}
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c} className={alignClass(i)} title={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>

        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {columns.map((c, i) => {
                const raw = (r as any)[c]
                const display = toCell(raw)
                return (
                  <td key={c} className={alignClass(i)} title={String(raw ?? '')}>
                    {display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        </table>
      </div>

      <div className="nt-foot">
        <div className="nt-footline">Artifact — {artifactId || '—'}</div>
      </div>
    </div>
  )
}
