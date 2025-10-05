// frontend/src/pages/Chat.tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ask, artifactUrl, checkout, uploadCsv, logout, me } from '../lib/api'
import HistoryDag from '../components/HistoryDag'

type Block =
  | { type: 'table'; columns: string[]; rows: any[]; artifactId: string }
  | { type: 'image'; artifactId: string }

type Message = { role: 'user' | 'assistant'; text: string; block?: Block }

type SessionMeta = {
  id: string
  title: string
  created_at: number
}

type SessionState = {
  messages: Message[]
  artifactId?: string
  currentNodeId?: string | null
  updated_at: number
}

const SESSIONS_KEY    = 'aido_sessions_v1'
const ACTIVE_KEY      = 'aido_session_id'
const SIDEBAR_W_KEY   = 'aido_sidebar_w'
const STATE_PREFIX    = 'aido_state_v1:'
const HANDLE_W        = 12

const defaultGreeting: Message[] = [
  { role: 'assistant', text: 'Welcome to AIDO. Upload a CSV with the 📎 button, then ask, e.g., “total revenue by region”, followed by “bar chart of revenue by region”.' }
]

// ---------- localStorage helpers ----------
function loadSessions(): SessionMeta[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as SessionMeta[]
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function saveSessions(list: SessionMeta[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list))
}
function newSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
function stateKey(sessionId: string) {
  return `${STATE_PREFIX}${sessionId}`
}
function loadState(sessionId: string): Partial<SessionState> {
  try {
    const raw = localStorage.getItem(stateKey(sessionId))
    if (!raw) return {}
    return JSON.parse(raw) as SessionState
  } catch { return {} }
}
function saveState(sessionId: string, state: Partial<SessionState>) {
  const existing = loadState(sessionId)
  const merged: SessionState = {
    messages: state.messages ?? existing.messages ?? defaultGreeting,
    artifactId: state.artifactId ?? existing.artifactId,
    currentNodeId: state.currentNodeId ?? existing.currentNodeId ?? null,
    updated_at: Date.now(),
  }
  localStorage.setItem(stateKey(sessionId), JSON.stringify(merged))
}

export default function Chat() {
  const search = new URLSearchParams(useLocation().search)
  const nav = useNavigate()

  // initial session + state
  const initialSessionId = localStorage.getItem(ACTIVE_KEY) || 'demo'
  const initialSaved = loadState(initialSessionId)

  // ----- Sessions (list + active) -----
  const [sessions, setSessions] = useState<SessionMeta[]>((() => {
    const existing = loadSessions()
    if (existing.length) return existing
    const seeded: SessionMeta[] = [{
      id: initialSessionId,
      title: `Untitled session — ${new Date().toLocaleString()}`,
      created_at: Date.now(),
    }]
    saveSessions(seeded)
    localStorage.setItem(ACTIVE_KEY, seeded[0].id)
    return seeded
  })())
  const [sessionId, setSessionId] = useState<string>(() => initialSessionId)

  // ----- Sidebar width (resizable with *internal* handle) -----
  const [sidebarW, setSidebarW] = useState<number>(() => {
    const raw = localStorage.getItem(SIDEBAR_W_KEY)
    const n = raw ? parseInt(raw, 10) : 320
    return Number.isFinite(n) ? n : 320
  })
  const [dragging, setDragging] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging) return
      const rect = contentRef.current?.getBoundingClientRect()
      const left = rect?.left ?? 0
      const x = e.clientX - left - HANDLE_W / 2
      const clamped = Math.max(220, Math.min(600, x))
      setSidebarW(clamped)
    }
    function onUp() {
      if (!dragging) return
      setDragging(false)
      document.body.style.userSelect = ''
      localStorage.setItem(SIDEBAR_W_KEY, String(sidebarW))
    }
    if (dragging) {
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.userSelect = 'none'
    }
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
  }, [dragging, sidebarW])

  // ----- User (top-right label) -----
  const [userLabel, setUserLabel] = useState<string>('')
  useEffect(() => {
    (async () => {
      try {
        const u = await me()
        const email: string = u?.email || ''
        const label = email ? email.split('@')[0] : ''
        setUserLabel(label)
      } catch {
        setUserLabel('')
      }
    })()
  }, [])

  // ----- Artifact / DAG / chat (init from saved state) -----
  const [artifactId, setArtifactId] = useState<string>(search.get('artifact_id') || initialSaved.artifactId || '')
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(initialSaved.currentNodeId ?? null)
  const [updateKey, setUpdateKey] = useState(0)

  const [messages, setMessages] = useState<Message[]>(
    initialSaved.messages && initialSaved.messages.length ? initialSaved.messages : defaultGreeting
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // autoscroll
  const [scrollOnNext, setScrollOnNext] = useState(false)
  useEffect(() => {
    if (scrollOnNext) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      setScrollOnNext(false)
    }
  }, [messages, scrollOnNext])

  // --- prevent saving while switching sessions ---
  const switchingRef = useRef(false)

  // Persist per-session state
  useEffect(() => {
    if (switchingRef.current) return
    saveState(sessionId, { messages, artifactId, currentNodeId })
  }, [messages, artifactId, currentNodeId])

  // Load state when active session changes
  useEffect(() => {
    const s = loadState(sessionId)
    setMessages(s.messages && s.messages.length ? s.messages : defaultGreeting)
    setArtifactId(s.artifactId || '')
    setCurrentNodeId(s.currentNodeId ?? null)
    setUpdateKey(k => k + 1)
    setScrollOnNext(true)
    switchingRef.current = false
  }, [sessionId])

  function isNumber(val: unknown) {
    return typeof val === 'number' || (!!`${val}` && !isNaN(Number(val)))
  }

  async function send() {
    const text = input.trim()
    if (!text) return
    if (!artifactId) { setError('Upload a CSV first using the 📎 button.'); return }

    setMessages(m => [...m, { role: 'user', text }])
    setInput('')
    setBusy(true)
    setScrollOnNext(true)
    setError(null)

    try {
      const res = await ask(sessionId, artifactId, text, currentNodeId || undefined)
      const maybeNodeId = res?.result?.node?.node_id as string | undefined
      if (maybeNodeId) setCurrentNodeId(maybeNodeId)

      if (res?.intent?.type === 'answer') {
        const answerText = res?.result?.text || 'OK.'
        setMessages(m => [...m, { role: 'assistant', text: answerText }])
        setUpdateKey(k => k + 1)
        return
      }

      if (res?.intent?.type === 'sql') {
        const a = res.result.artifact
        const cols = (res.result.columns || res.result.schema || []).map((c: any) => c.name)
        const rows = res.result.preview || []
        setArtifactId(a.artifact_id)
        setMessages(m => [...m, {
          role: 'assistant',
          text: 'Here’s your table.',
          block: { type: 'table', columns: cols, rows, artifactId: a.artifact_id }
        }])
        setUpdateKey(k => k + 1)
        return
      }

      if (res?.intent?.type === 'plot') {
        const a = res.result.artifact
        setMessages(m => [...m, {
          role: 'assistant',
          text: 'Here’s your chart.',
          block: { type: 'image', artifactId: a.artifact_id }
        }])
        setUpdateKey(k => k + 1)
        return
      }

      setMessages(m => [...m, { role: 'assistant', text: 'I created a result, but cannot display it yet.' }])
    } catch (e: any) {
      setError(e.message || 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleDagSelect({ nodeId, artifactId: artId }: { nodeId: string; artifactId: string }) {
    try {
      setCurrentNodeId(nodeId)
      setArtifactId(artId)
      await checkout(sessionId, nodeId)
      setMessages(m => [...m, { role: 'assistant', text: 'Switched context to the selected node.' }])
      setScrollOnNext(true)
    } catch (e: any) {
      setError(e.message || 'Checkout failed')
    }
  }

  function labelWithFilename(id: string, filename: string) {
    const list = loadSessions()
    const idx = list.findIndex(s => s.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], title: `${filename} — ${new Date().toLocaleString()}` }
      saveSessions(list)
      setSessions(list)
    }
  }

  async function onPickFile(file: File) {
    try {
      setBusy(true)
      const res = await uploadCsv(file, sessionId)
      setArtifactId(res.artifact.artifact_id)
      setCurrentNodeId(res.node.node_id)
      setUpdateKey(k => k + 1)
      setMessages(m => [...m, {
        role: 'assistant',
        text: `Uploaded “${file.name}”. You can now query the data.`,
      }])
      labelWithFilename(sessionId, file.name)
      setScrollOnNext(true)
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function onSelectSession(id: string) {
    if (id === sessionId) return
    switchingRef.current = true
    localStorage.setItem(ACTIVE_KEY, id)
    setSessionId(id)
  }

  function onNewSession() {
    const id = newSessionId()
    const meta: SessionMeta = {
      id,
      title: `Untitled session — ${new Date().toLocaleString()}`,
      created_at: Date.now(),
    }
    const list = [meta, ...loadSessions()]
    saveSessions(list)
    setSessions(list)
    localStorage.setItem(ACTIVE_KEY, id)
    const seeded: SessionState = { messages: defaultGreeting, artifactId: '', currentNodeId: null, updated_at: Date.now() }
    localStorage.setItem(stateKey(id), JSON.stringify(seeded))
    switchingRef.current = true
    setSessionId(id)
  }

  async function onLogout() {
    try { await logout() } finally { nav('/login') }
  }

  return (
    <div className="page">
      <style>{`
        :root{
          --bg: #0b1014;
          --panel: rgba(255,255,255,0.06);
          --line: rgba(255,255,255,0.12);
          --muted: #A1AEC6;
          --accent: #1bd8a0;
          --accent-2: #18b38a;
          --ring: rgba(27,216,160,0.35);
          --topbar-h: 56px;
          --composer-h: 76px;
          --sidebar: ${sidebarW}px;
          --handle: ${HANDLE_W}px;
        }
        * { box-sizing: border-box; }
        body { background: var(--bg); color: white; overflow: hidden; }

        .frame {
          display: grid;
          grid-template-rows: var(--topbar-h) 1fr;
          height: 100vh;
          width: 100%;
        }

        .topbar {
          position: sticky; top: 0; z-index: 50;
          border-bottom: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
          backdrop-filter: blur(10px);
          display: grid; grid-template-columns: 1fr auto;
          align-items: center; gap: 10px; padding: 0 14px;
        }
        .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
        .brand .dot { width: 20px; height: 20px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }

        .userbox { display:flex; align-items:center; gap:10px; }
        .userlabel { color: var(--muted); font-weight: 700; font-size: 13px; }

        /* UPDATED: logout matches themed buttons */
        .logout {
          appearance: none;
          display: inline-flex; align-items: center; justify-content: center;
          height: 36px; padding: 0 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.16);
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13; font-weight: 800; letter-spacing: .2px;
          cursor: pointer;
          box-shadow: 0 0 0 0 rgba(0,0,0,0); /* no glow, crisp like + New */
        }
        .logout:hover { filter: brightness(1.05); }

        /* 2-col layout: sidebar | chat (no dedicated handle column) */
        .content {
          display: grid;
          grid-template-columns: var(--sidebar) 1fr;
          height: calc(100vh - var(--topbar-h));
          min-width: 0;
          position: relative;
        }

        /* Sidebar: transparent bg, single gray edge via ::after */
        .sidebar {
          position: relative;
          z-index: 60;   /* above composer */
          height: 100%;
          background: transparent;
          overflow: hidden;
        }
        .sidebar::after{
          content:'';
          position:absolute;
          top:0; right:0;
          width:1px; height:100%;
          background: var(--line);   /* the only visible edge */
          pointer-events:none;
        }
        .sidebar-inner{
          height: 100%;
          display: grid;
          grid-template-rows: auto auto 1fr; /* title, cards, DAG */
          gap: 12px;
          padding: 12px;
          min-height: 0;
        }

        .sessions-head { display:flex; align-items:center; justify-content: space-between; font-weight: 800; letter-spacing:.2px; opacity:.95; }
        .new-btn {
          appearance: none; padding: 8px 12px; border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.16);
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13; font-weight: 800; cursor: pointer;
        }
        .new-btn:hover { filter: brightness(1.05); }

        .sessions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 200px;
          overflow-y: auto;
          padding-right: 2px;
          margin-bottom: 20px; /* space between cards and DAG */
        }
        .session-item {
          height: 40px; display: flex; align-items: center;
          padding: 0 12px;
          border-radius: 12px; cursor: pointer;
          border: 1px solid var(--line); background: rgba(255,255,255,0.06);
          font-size: 13px; line-height: 1; font-weight: 600;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          transition: background .15s ease, color .15s ease, border-color .15s ease;
          flex: 0 0 auto; /* fixed vertical size */
        }
        .session-item.active {
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13;
          border-color: rgba(255,255,255,0.25);
        }

        .dag-wrap{
          min-height: 0;
          height: 100%;
          margin: 0; padding: 0; border: 0 !important;
          box-shadow: none !important; background: transparent !important; border-radius: 0;
          display: grid; grid-template-rows: 1fr;
        }
        .dag-wrap :where(.react-flow, .reactflow, .react-flow__renderer){
          width: 100% !important;
          height: 100% !important;
        }

        /* Invisible resizer handle that straddles the edge */
        .resize-handle {
          position: absolute;
          top: 0; right: calc(-1 * var(--handle) / 2);
          width: var(--handle);
          height: 100%;
          cursor: col-resize;
          z-index: 61; /* above composer */
          background: transparent;
        }

        /* Chat column */
        .chat-area{
          height: calc(100vh - var(--topbar-h));
          min-height: 0;
          overflow-y: auto;
          position: relative;
          padding-bottom: calc(var(--composer-h) + 48px);
          scroll-padding-bottom: calc(var(--composer-h) + 48px);
        }
        .chat-scroll{ width: 100%; max-width: 980px; margin: 0 auto; padding: 14px 18px 24px; min-height: 0; }
        .msg { display: flex; gap: 12px; margin: 18px 0; align-items: flex-start; }
        .msg.user { justify-content: flex-end; }
        .msg.user .bubble {
          max-width: 100%; border: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.10));
          border-radius: 16px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(0,0,0,0.22);
        }
        .msg.assistant { justify-content: center; }
        .msg.assistant .bubble { flex: 1; max-width: 980px; background: transparent; border: none; box-shadow: none; padding: 0; margin: 0; }

        /* Subtle larger intro (ChatGPT-like, not huge) */
        .msg.assistant.intro .asst-text {
          font-size: clamp(18px, 2.2vw, 22px);
          line-height: 1.5;
          font-weight: 700;
          letter-spacing: .2px;
          padding: 4px 2px;
        }

        .asst-text { line-height: 1.7; font-size: 15px; padding: 6px 2px; }

        .block { margin-top: 10px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.03); }
        .table-wrap { max-height: 360px; overflow: auto; }
        table.tbl { width: 100%; border-collapse: separate; border-spacing: 0 8px; }
        .tbl th { position: sticky; top: 0; z-index: 0; text-align: left; padding: 8px 10px; color: var(--muted); background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 8px; backdrop-filter: blur(4px); }
        .tbl td { padding: 10px 12px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); border-radius: 10px; font-variant-numeric: tabular-nums; }
        .tbl tr:nth-child(2n) td { background: rgba(255,255,255,0.08); }

        .plot { height: 360px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); }
        .plot img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .muted { color: var(--muted); }
        .idmono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap:anywhere; }

        /* Composer (glass). Aligns to sidebar edge. */
        .composer {
          position: fixed;
          left: var(--sidebar);
          right: 0;
          bottom: 0;
          height: var(--composer-h);
          z-index: 40; /* below the sidebar’s 60 */
          border-top: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
          backdrop-filter: blur(10px);
        }
        .composer .inner {
          height: 100%; width: 100%; max-width: 980px; margin: 0 auto; padding: 12px 18px;
          display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center;
        }
        .icon-btn{
          display:inline-flex; align-items:center; justify-content:center;
          width: 42px; height: 42px; border-radius: 12px;
          border: 1px solid var(--line); background: rgba(255,255,255,0.06);
          cursor: pointer;
        }
        .icon-btn:hover{ border-color: var(--ring); }
        .icon-btn.disabled { opacity: .45; pointer-events: none; cursor: default; }
        .composer input[type="text"]{
          width: 100%; padding: 12px 14px; border-radius: 12px;
          background: rgba(255,255,255,0.06); border: 1px solid var(--line); color: white; outline: none;
        }
        .composer input[type="text"]:focus{ border-color: var(--ring); box-shadow: 0 0 0 6px rgba(27,216,160,0.08); }
        .send-btn{
          padding: 10px 14px; border-radius: 12px; background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13; border: 1px solid rgba(255,255,255,0.16); cursor: pointer; font-weight: 700;
        }
        .send-btn:hover{ filter: brightness(1.03); }
      `}</style>

      <div className="frame">
        {/* Top Bar */}
        <div className="topbar">
          <div className="brand"><div className="dot" /> GenBio AIDO</div>
          <div className="userbox">
            {userLabel && <span className="userlabel">@{userLabel}</span>}
            <button className="logout" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {/* Content */}
        <div ref={contentRef} className="content">
          {/* Sidebar */}
          <aside className="sidebar" style={{ width: sidebarW }}>
            <div className="sidebar-inner">
              <div className="sessions-head">
                <span>Sessions</span>
                <button className="new-btn" onClick={onNewSession}>+ New</button>
              </div>

              <div className="sessions">
                {sessions.map(s => (
                  <div
                    key={s.id}
                    className={`session-item ${s.id === sessionId ? 'active' : ''}`}
                    title={s.title}
                    onClick={() => onSelectSession(s.id)}
                  >
                    {s.title}
                  </div>
                ))}
              </div>

              {/* DAG */}
              <div className="dag-wrap">
                <HistoryDag
                  sessionId={sessionId}
                  currentNodeId={currentNodeId}
                  updateKey={updateKey}
                  onSelect={handleDagSelect}
                />
              </div>
            </div>

            {/* Invisible edge resizer */}
            <div
              className="resize-handle"
              onMouseDown={() => setDragging(true)}
              title="Drag to resize"
            />
          </aside>

          {/* Chat */}
          <section className="chat-area">
            <div className="chat-scroll">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`msg ${m.role === 'user' ? 'user' : 'assistant'} ${i === 0 && m.role === 'assistant' ? 'intro' : ''}`}
                >
                  <div className="bubble">
                    {m.role === 'assistant' ? (
                      <>
                        <div className="asst-text">{m.text}</div>

                        {m.block?.type === 'table' && (
                          <div className="block">
                            <div className="table-wrap">
                              <table className="tbl">
                                <thead>
                                  <tr>{m.block.columns.map((c, ci) => <th key={ci}>{c}</th>)}</tr>
                                </thead>
                                <tbody>
                                  {m.block.rows.map((r, ri) => (
                                    <tr key={ri}>
                                      {m.block.columns.map((c, ci) => {
                                        const val = (r as any)[c]
                                        const align = isNumber(val) ? 'right' : 'left'
                                        return (
                                          <td key={ci} style={{ textAlign: align as 'left'|'right' }} title={String(val)}>
                                            {String(val)}
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--line)' }}>
                              <span className="muted" style={{ fontSize: 12 }}>
                                Artifact:&nbsp;<span className="idmono">{m.block.artifactId}</span>
                              </span>
                            </div>
                          </div>
                        )}

                        {m.block?.type === 'image' && (
                          <div className="block">
                            <div className="plot">
                              <img src={artifactUrl(m.block.artifactId)} alt="plot" />
                            </div>
                            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--line)' }}>
                              <span className="muted" style={{ fontSize: 12 }}>
                                Artifact:&nbsp;<span className="idmono">{m.block.artifactId}</span>
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div>{m.text}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
              {error && <div style={{ color:'#ffb3b3', marginTop: 8 }}>{error}</div>}
            </div>
          </section>
        </div>

        {/* Fixed Composer */}
        <div className="composer">
          <div className="inner">
            <input
              ref={fileRef}
              id="csv-picker"
              type="file"
              accept=".csv,text/csv"
              style={{ position:'absolute', left:-9999, width:1, height:1, opacity:0 }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPickFile(f)
                e.currentTarget.value = ''
              }}
            />

            <label
              htmlFor="csv-picker"
              className={`icon-btn ${artifactId ? 'disabled' : ''}`}
              title={artifactId ? 'Upload disabled (one CSV per session)' : 'Upload CSV'}
              role="button"
              tabIndex={0}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21 12.5l-8.485 8.485a6 6 0 11-8.485-8.485L12.5 4.5a4 4 0 015.657 5.657L9.88 18.434a2 2 0 11-2.829-2.829L15 7.657"
                  stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </label>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={busy ? 'Thinking…' : (artifactId ? 'Ask about your data…' : 'Upload a CSV to begin…')}
              disabled={busy}
            />

            <button className="send-btn" onClick={send} disabled={busy}>
              {busy ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
