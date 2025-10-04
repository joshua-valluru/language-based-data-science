import React from 'react'
import { artifactUrl } from '../lib/api'

type View =
  | { kind: 'none' }
  | { kind: 'table'; columns: string[]; rows: any[]; artifactId: string }
  | { kind: 'image'; artifactId: string }

export default function ResultPanel({ view }: { view: View }) {
  return (
    <section className="result-panel">
      <style>{`
        .result-panel {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.18);
          overflow: hidden;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .result-head {
          display:flex; align-items:center; justify-content:space-between;
          gap: 12px; padding: 12px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
        }
        .result-title { font-weight: 600; }
        .muted { color:#A1AEC6; }
        .idmono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap:anywhere; }

        /* Uniform body size so tables & plots feel consistent */
        .result-body {
          height: 56vh;              /* stubby but roomy */
          padding: 12px;
          display: flex;
          min-height: 280px;
        }
        .scroll {
          width:100%; height:100%;
          overflow:auto; padding-right:6px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
        }

        /* Table */
        .table { width:100%; border-collapse:separate; border-spacing:0 8px; }
        .th {
          position: sticky; top: 0; z-index: 1;
          text-align:left; padding:8px 10px; color:#A1AEC6;
          background: rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.10); border-radius:8px; backdrop-filter: blur(4px);
        }
        .td {
          padding:10px 12px; border-radius:10px;
          background: rgba(255,255,255,0.06);
          border:1px solid rgba(255,255,255,0.10);
          font-variant-numeric: tabular-nums;
        }
        .td.alt { background: rgba(255,255,255,0.08); }

        /* Plot */
        .plot {
          width:100%; height:100%;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          display:flex; align-items:center; justify-content:center;
          overflow:hidden;
        }
        .plot img { max-width: 100%; max-height: 100%; object-fit: contain; }

        @media (max-width: 1100px) {
          .result-body { height: 48vh; }
        }
      `}</style>

      <div className="result-head">
        <div className="result-title">Result</div>
        {view.kind !== 'none' && 'artifactId' in view && (
          <div className="muted" style={{ fontSize: 12 }}>
            Artifact:&nbsp;<span className="idmono">{view.artifactId}</span>
          </div>
        )}
      </div>

      <div className="result-body">
        {view.kind === 'none' && (
          <div style={{ margin:'auto', color:'#A1AEC6' }}>Ask something to see output here.</div>
        )}

        {view.kind === 'table' && (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  {view.columns.map((c, i) => (
                    <th key={i} className="th">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r, ri) => (
                  <tr key={ri}>
                    {view.columns.map((c, ci) => {
                      const val = (r as any)[c]
                      const num = typeof val === 'number' || (!isNaN(Number(val)) && val !== '' && val !== null)
                      return (
                        <td
                          key={ci}
                          className={`td ${ri % 2 ? 'alt' : ''}`}
                          style={{ textAlign: num ? 'right' as const : 'left' as const }}
                          title={String(val)}
                        >
                          {String(val)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view.kind === 'image' && (
          <div className="plot">
            <img src={artifactUrl(view.artifactId)} alt="plot" />
          </div>
        )}
      </div>
    </section>
  )
}
