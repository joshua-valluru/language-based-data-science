// frontend/src/pages/Chat.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ask, artifactUrl, checkout, uploadCsv, logout, me } from '../lib/api'
import HistoryDag from '../components/HistoryDag'

type Block =
  | { type: 'table'; columns: string[]; rows: any[]; artifactId: string }
  | { type: 'image'; artifactId: string }

type Message = { role: 'user' | 'assistant'; text: string; block?: Block }

type SessionMeta = {
  id: string
  label: string
  createdAt: number
}

type PersistedState = {
  messages: Message[]
  artifactId: string
  headNodeId: string | null
}

function makeSessionId() {
  return `sid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultWelcome(): Message[] {
  return [
    {
      role: 'assistant',
      text:
        'Welcome to AIDO. Upload a CSV with the 📎 button, then ask, e.g., “total revenue by region”, followed by “bar chart of revenue by region”.',
    },
  ]
}

export default function Chat() {
  const search = new URLSearchParams(useLocation().search)
  const nav = useNavigate()

  // ------- Auth / user -------
  const [userEmail, setUserEmail] = useState<string>('')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const u = await me()
        if (!mounted) return
        setUserEmail(u.email || '')
      } catch {
        nav('/login')
      }
    })()
    return () => {
      mounted = false
    }
  }, [nav])

  // ------- Storage helpers keyed by user -------
  const sessionsKey = useMemo(
    () => (userEmail ? `aido_sessions::${userEmail}` : 'aido_sessions::anon'),
    [userEmail]
  )
  const stateKey = (sid: string) => (userEmail ? `aido_state::${userEmail}::${sid}` : `aido_state::anon::${sid}`)

  const loadSessions = (): SessionMeta[] => {
    try {
      const raw = localStorage.getItem(sessionsKey)
      return raw ? (JSON.parse(raw) as SessionMeta[]) : []
    } catch {
      return []
    }
  }
  const saveSessions = (list: SessionMeta[]) => {
    localStorage.setItem(sessionsKey, JSON.stringify(list))
  }

  const loadState = (sid: string): PersistedState | null => {
    try {
      const raw = localStorage.getItem(stateKey(sid))
      return raw ? (JSON.parse(raw) as PersistedState) : null
    } catch {
      return null
    }
  }
  const saveState = (sid: string, s: PersistedState) => {
    localStorage.setItem(stateKey(sid), JSON.stringify(s))
  }

  // ------- Session Tabs model -------
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string>(() => localStorage.getItem('aido_session_id') || makeSessionId())

  // Initialize sessions list once we know the user
  useEffect(() => {
    // ensure we have a session id in localStorage
    const existing = localStorage.getItem('aido_session_id')
    if (!existing) {
      const fresh = makeSessionId()
      localStorage.setItem('aido_session_id', fresh)
      setSessionId(fresh)
    }
    // load / seed sessions
    const list = loadSessions()
    if (list.length === 0) {
      const sid = localStorage.getItem('aido_session_id') || sessionId
      const first: SessionMeta = {
        id: sid,
        label: 'Session 1',
        createdAt: Date.now(),
      }
      setSessions([first])
      saveSessions([first])
    } else {
      setSessions(list)
      // ensure current session exists in list
      if (!list.find(s => s.id === sessionId)) {
        const add: SessionMeta = { id: sessionId, label: `Session ${list.length + 1}`, createdAt: Date.now() }
        const merged = [...list, add]
        setSessions(merged)
        saveSessions(merged)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsKey]) // rerun when userEmail available

  // Switch active session helper
  const switchSession = (sid: string) => {
    localStorage.setItem('aido_session_id', sid)
    setSessionId(sid)
    // load persisted chat state for that session
    const s = loadState(sid)
    if (s) {
      setMessages(s.messages && s.messages.length ? s.messages : defaultWelcome())
      setArtifactId(s.artifactId || '')
      setCurrentNodeId(s.headNodeId || null)
    } else {
      setMessages(defaultWelcome())
      setArtifactId('')
      setCurrentNodeId(null)
    }
    // force DAG re-fetch
    setUpdateKey(k => k + 1)
    setScrollOnNext(true)
  }

  // New session tab
  const newSession = () => {
    const sid = makeSessionId()
    const nextIndex = sessions.length + 1
    const meta: SessionMeta = { id: sid, label: `Session ${nextIndex}`, createdAt: Date.now() }
    const updated = [...sessions, meta]
    setSessions(updated)
    saveSessions(updated)
    // seed state with welcome
    saveState(sid, { messages: defaultWelcome(), artifactId: '', headNodeId: null })
    switchSession(sid)
  }

  // Optionally allow renaming (double-click), minimal impl
  const renameSession = (sid: string, nextLabel: string) => {
    const updated = sessions.map(s => (s.id === sid ? { ...s, label: nextLabel || s.label } : s))
    setSessions(updated)
    saveSessions(updated)
  }

  // ------- Chat & DAG state (per current session) -------
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [artifactId, setArtifactId] = useState(search.get('artifact_id') || '')
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
  const [updateKey, setUpdateKey] = useState(0)

  const [messages, setMessages] = useState<Message[]>(defaultWelcome())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load persisted state for the initial sessionId
  useEffect(() => {
    const s = loadState(sessionId)
    if (s) {
      setMessages(s.messages && s.messages.length ? s.messages : defaultWelcome())
      setArtifactId(s.artifactId || '')
      setCurrentNodeId(s.headNodeId || null)
    } else {
      // ensure something is stored so switching back works
      saveState(sessionId, { messages: defaultWelcome(), artifactId: '', headNodeId: null })
      setMessages(defaultWelcome())
      setArtifactId('')
      setCurrentNodeId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Persist chat+head on relevant changes
  useEffect(() => {
    saveState(sessionId, { messages, artifactId, headNodeId: currentNodeId })
  }, [sessionId, messages, artifactId, currentNodeId])

  // Only autoscroll after interactions
  const [scrollOnNext, setScrollOnNext] = useState(false)
  useEffect(() => {
    if (scrollOnNext) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      setScrollOnNext(false)
    }
  }, [messages, scrollOnNext])

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
        setScrollOnNext(true)
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
        setScrollOnNext(true)
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
        setScrollOnNext(true)
        return
      }

      setMessages(m => [...m, { role: 'assistant', text: 'I created a result, but cannot display it yet.' }])
      setScrollOnNext(true)
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

  async function onPickFile(file: File) {
    try {
      setBusy(true)
      setError(null)
      const res = await uploadCsv(file, sessionId)
      setArtifactId(res.artifact.artifact_id)
      setCurrentNodeId(res.node.node_id)
      setUpdateKey(k => k + 1)

      // Update tab label with filename (minimal “nice” touch)
      const updatedTabs = sessions.map(s =>
        s.id === sessionId ? { ...s, label: res?.artifact?.uri?.split('/').pop() || `Session ${s.id.slice(-4)}` } : s
      )
      setSessions(updatedTabs)
      saveSessions(updatedTabs)

      setMessages(m => [...m, {
        role: 'assistant',
        text: `Uploaded “${file.name}”. You can now query the data.`,
      }])
      setScrollOnNext(true)
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onLogout() {
    try { await logout() } finally { nav('/login') }
  }

  // Upload allowed only if no artifact yet in this session
  const uploadDisabled = !!artifactId

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
          display: grid; grid-template-columns: auto 1fr auto;
          align-items: center; gap: 8px;
          padding: 0 14px;
        }
        .top-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 10px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--line); cursor: pointer;
        }
        .top-btn:hover { border-color: var(--ring); }
        .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
        .brand .dot { width: 20px; height: 20px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }

        .userbox { display:flex; align-items:center; gap:10px; }
        .username { opacity: .9; font-weight: 600; }
        .logout { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); cursor: pointer; }
        .logout:hover { border-color: var(--ring); }

        .content {
          display: grid;
          grid-template-columns: var(--sidebar, 320px) 1fr;
          height: calc(100vh - var(--topbar-h));
          min-width: 0;
          overflow: hidden;
        }

        .sidebar{
          position: sticky;
          top: var(--topbar-h);
          height: calc(100vh - var(--topbar-h));
          border-right: 1px solid var(--line);
          background: rgba(255,255,255,0.04);
          transition: width .2s ease;
          overflow: hidden;
        }
        .sidebar.collapsed { width: 64px; }
        .sidebar-inner{
          height: 100%;
          padding: 12px;
          display: grid;
          grid-template-rows: auto auto 1fr; /* tabs + controls + dag */
          gap: 10px;
        }
        .sidebar-head{
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          color: var(--muted); font-weight: 600;
        }
        .tabs{
          display:flex; gap:8px; flex-wrap: wrap;
          max-height: 86px; overflow: auto; padding-right: 6px;
        }
        .tab{
          padding: 6px 10px; border-radius: 10px; cursor: pointer;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.06);
          font-size: 12px; max-width: 100%; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;
        }
        .tab.active{
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13; border-color: rgba(255,255,255,0.18); font-weight: 700;
        }
        .new-btn{
          padding: 6px 8px; border-radius: 10px; border: 1px dashed var(--line);
          background: rgba(255,255,255,0.04); cursor: pointer; font-size: 12px;
        }
        .new-btn:hover{ border-color: var(--ring); }

        .chat-area{
          height: calc(100vh - var(--topbar-h));
          min-height: 0;
          overflow-y: auto;
          position: relative;
          padding-bottom: calc(var(--composer-h) + 48px);
          scroll-padding-bottom: calc(var(--composer-h) + 48px);
        }

        .chat-scroll{
          width: 100%;
          max-width: 980px;
          margin: 0 auto;
          padding: 14px 18px 24px;
          min-height: 0;
        }

        .composer {
          position: fixed;
          left: var(--sidebar, 320px);
          right: 0;
          bottom: 0;
          height: var(--composer-h);
          z-index: 40;
          border-top: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
          backdrop-filter: blur(10px);
        }
        .composer .inner {
          height: 100%;
          width: 100%;
          max-width: 980px;
          margin: 0 auto;
          padding: 12px 18px;
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
        }

        .icon-btn{
          display:inline-flex; align-items:center; justify-content:center;
          width: 36px; height: 36px; border-radius: 10px;
          border: 1px solid var(--line); background: rgba(255,255,255,0.06);
          cursor: pointer;
        }
        .icon-btn[aria-disabled="true"]{
          opacity: .45; cursor: not-allowed; filter: grayscale(0.3);
        }
        .icon-btn:hover{ border-color: var(--ring); }

        .composer input[type="text"]{
          width: 100%;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--line); color: white; outline: none;
        }
        .composer input[type="text"]:focus{ border-color: var(--ring); box-shadow: 0 0 0 6px rgba(27,216,160,0.08); }

        .send-btn{
          padding: 10px 14px; border-radius: 12px; background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13; border: 1px solid rgba(255,255,255,0.16); cursor: pointer; font-weight: 700;
        }
        .send-btn:hover{ filter: brightness(1.03); }

        .msg { display: flex; gap: 12px; margin: 18px 0; align-items: flex-start; }
        .msg.user { justify-content: flex-end; }
        .msg.user .bubble {
          max-width: 100%;
          border: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.10));
          border-radius: 16px; padding: 12px 14px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.22);
        }
        .msg.assistant { justify-content: center; }
        .msg.assistant .bubble {
          flex: 1;
          max-width: 980px;
          background: transparent;
          border: none;
          box-shadow: none;
          padding: 0;
          margin: 0;
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
      `}</style>

      <div className="frame">
        {/* Top Bar */}
        <div className="topbar">
          <button className="top-btn" onClick={() => setSidebarOpen(s => !s)} title="Toggle history">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <span style={{opacity: .9}}>History</span>
          </button>
          <div className="brand"><div className="dot" /> GenBio AIDO</div>
          <div className="userbox">
            <div className="username">{userEmail || '—'}</div>
            <button className="logout" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {/* Content */}
        <div className="content" style={{ ['--sidebar' as any]: sidebarOpen ? '320px' : '64px' }}>
          {/* Sidebar / History (static) */}
          <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
            <div className="sidebar-inner">
              <div className="sidebar-head">
                <span>Sessions</span>
                <button className="new-btn" onClick={newSession}>+ New</button>
              </div>

              {/* tabs */}
              <div className="tabs">
                {sessions.map(s => (
                  <div
                    key={s.id}
                    className={`tab ${s.id === sessionId ? 'active' : ''}`}
                    title={s.label}
                    onClick={() => switchSession(s.id)}
                    onDoubleClick={() => {
                      const name = prompt('Rename session', s.label)
                      if (name !== null) renameSession(s.id, name.trim())
                    }}
                  >
                    {s.label}
                  </div>
                ))}
              </div>

              {/* DAG for current session */}
              {sidebarOpen
                ? (
                  <HistoryDag
                    sessionId={sessionId}
                    currentNodeId={currentNodeId}
                    updateKey={updateKey}
                    onSelect={handleDagSelect}
                  />
                ) : (
                  <div style={{display:'grid',placeItems:'center',height:'100%',color:'var(--muted)'}}>⇦</div>
                )}
            </div>
          </aside>

          {/* Chat column (only vertical scroller) */}
          <section className="chat-area">
            <div className="chat-scroll">
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
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

        {/* FIXED Composer */}
        <div className="composer" style={{ ['--sidebar' as any]: sidebarOpen ? '320px' : '64px' }}>
          <div className="inner">
            {/* Hidden file input */}
            <input
              ref={fileRef}
              id="csv-picker"
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPickFile(f)
                e.currentTarget.value = ''
              }}
            />
            {/* Upload (disabled after 1 CSV in this session) */}
            <label
              htmlFor="csv-picker"
              className="icon-btn"
              title={uploadDisabled ? 'Upload disabled (one CSV per session)' : 'Upload CSV'}
              aria-disabled={uploadDisabled ? 'true' : 'false'}
              onClick={(e) => {
                if (uploadDisabled) e.preventDefault()
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21 12.5l-8.485 8.485a6 6 0 11-8.485-8.485L12.5 4.5a4 4 0 015.657 5.657L9.88 18.434a2 2 0 11-2.829-2.829L15 7.657"
                  stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </label>

            {/* Text input */}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={busy ? 'Thinking…' : (artifactId ? 'Ask about your data…' : 'Upload a CSV to begin…')}
              disabled={busy}
            />

            {/* Send */}
            <button className="send-btn" onClick={send} disabled={busy}>
              {busy ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
