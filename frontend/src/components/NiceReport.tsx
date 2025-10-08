// frontend/src/components/NiceReport.tsx
import React, { useMemo } from 'react'

type Props = {
  title?: string
  html: string
  artifactId?: string
}

export default function NiceReport({ title = 'Report', html, artifactId }: Props) {
  // --- Simple sanitizer for the limited tag set we expect from the LLM ---
  const safeHtml = useMemo(() => sanitizeHtml(html), [html])

  function handleDownloadHtml() {
    const blob = new Blob(
      [
        `<!doctype html><meta charset="utf-8"><title>${escapeForAttr(
          title
        )}</title><body>${safeHtml}</body>`,
      ],
      { type: 'text/html;charset=utf-8' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(title || 'report')}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="nr-card">
      <style>{`
        /* Match NiceTable visual language */

        .nr-card{
          border:1px solid var(--line);
          border-radius:12px;
          background: rgba(255,255,255,0.03);
          overflow:hidden;
          position: relative;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .nr-head{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:10px 12px;
          border-bottom:1px solid var(--line);
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(4px);
        }
        .nr-title{
          font-weight:700; letter-spacing:.2px; opacity:.95; font-size:13px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .nr-actions{ display:flex; gap:8px; align-items:center; }
        .nr-btn{
          appearance:none; padding:6px 10px; border-radius:10px;
          border:1px solid var(--line); background: rgba(255,255,255,0.10);
          color:#fff; font-weight:800; font-size:12px; cursor:pointer;
          display:inline-flex; align-items:center; gap:8px;
        }
        .nr-btn:hover{ border-color: var(--ring); }
        .nr-btn:disabled{ opacity:.7; cursor:default; }
        .nr-check{ width:14px; height:14px; flex:0 0 14px; }

        .nr-body{
          padding:12px;
          line-height:1.7;
          font-size:14px;
          overflow-x:auto; /* allow horizontal scroll for wide code blocks/tables */
          box-sizing: border-box;
        }

        /* Typography (kept subtle to match NiceTable) */
        .nr-body h2{
          font-size:16px; font-weight:800; margin: 2px 0 8px 0; letter-spacing:.2px;
        }
        .nr-body h3{
          font-size:14px; font-weight:800; margin: 10px 0 6px 0; letter-spacing:.2px; color: var(--muted);
        }
        .nr-body p{ margin: 8px 0; }
        .nr-body ul, .nr-body ol{ margin: 8px 0 12px 18px; padding:0; }
        .nr-body li{ margin: 4px 0; }

        /* Code styling (dark, rounded, consistent with app vibe) */
        .nr-body code{
          background: rgba(255,255,255,0.08);
          border:1px solid var(--line);
          border-radius:8px;
          padding: 0 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
        }
        .nr-body pre{
          background: rgba(255,255,255,0.06);
          border:1px solid var(--line);
          border-radius:10px;
          padding: 10px 12px;
          overflow:auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          line-height: 1.6;
        }

        /* Links */
        .nr-body a{ color: var(--accent); text-decoration: none; }
        .nr-body a:hover{ text-decoration: underline; }

        /* Inline tables inside the report */
        .nr-body table{
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: auto;
          margin: 8px 0 10px 0;
          border:1px solid var(--line);
          border-radius:10px;
          overflow:hidden;
        }
        .nr-body thead th{
          position: sticky; top: 0; z-index: 0;
          text-align:left; padding:8px 10px; color:var(--muted);
          background: rgba(255,255,255,0.08);
          border-bottom:1px solid var(--line);
          font-weight:800; font-size:12px;
        }
        .nr-body tbody td{
          padding:8px 10px; font-size:13px; border-bottom:1px solid rgba(255,255,255,0.08);
        }
        .nr-body tbody tr:nth-child(2n) td{ background: rgba(255,255,255,0.03); }

        /* Metric pills (as instructed for the LLM) */
        .nr-metrics{
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap:10px; margin: 8px 0 10px 0;
        }
        .nr-metric{
          border:1px solid var(--line);
          background: rgba(255,255,255,0.06);
          border-radius:12px;
          padding:10px 12px;
        }
        .nr-metric .lab{
          font-size:11px; color: var(--muted); font-weight:800; margin-bottom: 4px;
          letter-spacing: .2px;
        }
        .nr-metric .val{
          font-size:15px; font-weight:800;
        }

        /* Images (if any) should fit the content width */
        .nr-body img{
          max-width: 100%;
          height: auto;
          display:block;
          border-radius:10px;
          border:1px solid var(--line);
          background: rgba(255,255,255,0.03);
        }

        .nr-foot{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:8px 12px;
          border-top:1px solid rgba(255,255,255,0.22);
          background: rgba(7,10,13,0.88); /* EXACTLY matches NiceTable */
        }
        .nr-footline{
          font-size:11px; line-height:1.3;
          color:#B8C2D9; font-weight:700;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%;
        }
      `}</style>

      <div className="nr-head">
        <div className="nr-title">{title}</div>
        <div className="nr-actions">
          <button className="nr-btn" onClick={handleDownloadHtml} title="Download HTML">Download</button>
        </div>
      </div>

      <div className="nr-body" dangerouslySetInnerHTML={{ __html: safeHtml }} />

      <div className="nr-foot">
        <div className="nr-footline">Artifact — {artifactId || '—'}</div>
      </div>
    </div>
  )
}

/* ---------------- helpers ---------------- */

function slugify(s: string) {
  return (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function escapeForAttr(s: string) {
  return (s || '').replace(/"/g, '&quot;')
}

/**
 * Very small sanitizer for the constrained HTML we ask the model to produce.
 * Allowed tags + a minimal attribute policy (href with safe protocols, class, title).
 */
function sanitizeHtml(html: string): string {
  const ALLOWED = new Set([
    'h2','h3','p','ul','ol','li','strong','em','b','i','code','pre',
    'div','span','br','hr','table','thead','tbody','tr','th','td','a','img'
  ])
  const tmp = document.createElement('div')
  tmp.innerHTML = html || ''

  const walk = (node: Node) => {
    // remove comment nodes
    if (node.nodeType === Node.COMMENT_NODE) {
      node.parentNode?.removeChild(node)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()

    if (!ALLOWED.has(tag)) {
      // unwrap node but keep children
      const parent = el.parentNode
      while (el.firstChild) parent?.insertBefore(el.firstChild, el)
      parent?.removeChild(el)
      return
    }

    // drop all event handlers + style
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase()
      const value = attr.value

      // allow a small set of attributes; purge the rest
      const allow =
        name === 'class' ||
        name === 'title' ||
        (tag === 'a' && name === 'href') ||
        (tag === 'img' && (name === 'src' || name === 'alt'))

      if (!allow) {
        el.removeAttribute(name)
        return
      }

      // href/src protocol guard
      if ((name === 'href' || name === 'src') && value) {
        const v = value.trim().toLowerCase()
        const ok = v.startsWith('http:') || v.startsWith('https:') || (name === 'href' && v.startsWith('mailto:')) || v.startsWith('/')
        if (!ok) el.removeAttribute(name)
      }
    })

    // recurse
    Array.from(el.childNodes).forEach(walk)
  }

  Array.from(tmp.childNodes).forEach(walk)
  return tmp.innerHTML
}
