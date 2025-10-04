import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadCsv } from '../lib/api'

function useSessionId() {
  const [id] = useState(() => {
    const key = 'aido_session_id'
    const ex = localStorage.getItem(key)
    if (ex) return ex
    const v = Math.random().toString(36).slice(2, 10)
    localStorage.setItem(key, v)
    return v
  })
  return id
}

export default function Upload() {
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionId = useSessionId()

  async function handleFiles(files: FileList | null) {
    if (!files || !files[0]) return
    setError(null)
    setBusy(true)
    try {
      const res = await uploadCsv(files[0], sessionId)
      const artifactId = res.artifact.artifact_id
      nav(`/chat?artifact_id=${artifactId}`)
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="hero">
        <div className="pill">Step 1</div>
        <h1 style={{ margin: '10px 0 6px', fontSize: 28, fontWeight: 700 }}>Start an Analysis</h1>
        <p className="muted">Drag & drop a CSV to begin, or click to select a file.</p>
      </div>

      <div
        className={`drop ${dragOver ? 'over' : ''}`}
        style={{ marginTop: 24 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
      >
        <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>
        <div>Drop your CSV here</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Max ~50MB recommended for the demo</div>
        <div style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy}>{busy ? 'Uploading…' : 'Choose file'}</button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {error && <div style={{ marginTop: 16, color: '#ffb3b3' }}>{error}</div>}

      <div style={{ marginTop: 18 }} className="muted">Session: <span style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{sessionId}</span></div>
    </div>
  )
}
