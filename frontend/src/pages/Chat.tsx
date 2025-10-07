// frontend/src/pages/Chat.tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ask, artifactUrl, checkout, uploadCsv, logout, me } from '../lib/api'
import HistoryDag from '../components/HistoryDag'
import NiceTable from '../components/NiceTable'
import NiceReport from '../components/NiceReport'

type Block =
  | { type: 'table'; columns: string[]; rows: any[]; artifactId: string }
  | { type: 'image'; artifactId: string; title?: string }
  | { type: 'report'; html: string; artifactId?: string; title?: string }

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

// utils
function newSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
function slug(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export default function Chat() {
  const search = new URLSearchParams(useLocation().search)
  const nav = useNavigate()

  // ---------- User / namespace ----------
  const [userLabel, setUserLabel] = useState<string>('')
  const [ns, setNs] = useState<string>('user:guest')     // localStorage namespace
  const [ready, setReady] = useState<boolean>(false)      // per-user state booted?

  // Namespace-aware key helpers
  const k = (key: string) => `${ns}::${key}`
  const stateKey = (sessionId: string) => k(`${STATE_PREFIX}${sessionId}`)

  // ---------- Layout + sidebar width ----------
  const [sidebarW, setSidebarW] = useState<number>(320)
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
      localStorage.setItem(k(SIDEBAR_W_KEY), String(sidebarW))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, sidebarW, ns])

  // ---------- Sessions / chat state (per-user) ----------
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string>('') // set after bootstrap
  const [artifactId, setArtifactId] = useState<string>('')
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
  const [updateKey, setUpdateKey] = useState(0)

  const [messages, setMessages] = useState<Message[]>(defaultGreeting)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ---------- Autoscroll ----------
  const chatAreaRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const isAutoScroll = useRef(true)

  function scrollToEnd(behavior: ScrollBehavior = 'smooth') {
    endRef.current?.scrollIntoView({ behavior, block: 'end' })
  }

  useEffect(() => {
    const el = chatAreaRef.current
    if (!el) return
    const onScroll = () => {
      const threshold = 40
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
      isAutoScroll.current = atBottom
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!chatAreaRef.current) return
    requestAnimationFrame(() => { if (isAutoScroll.current) scrollToEnd('smooth') })
  }, [messages.length, sessionId])

  // --- prevent saving while switching sessions ---
  const switchingRef = useRef(false)

  // ---------- Namespace bootstrap ----------
  useEffect(() => {
    (async () => {
      try {
        const u = await me()
        const email: string = u?.email || ''
        const label = email ? email.split('@')[0] : ''
        setUserLabel(label)

        const ns0 = `user:${slug(email || (u as any)?.id || 'guest')}`
        const k0 = (key: string) => `${ns0}::${key}`
        const stateKey0 = (sid: string) => `${ns0}::${STATE_PREFIX}${sid}`

        // Sidebar width (per-user)
        const rawW = localStorage.getItem(k0(SIDEBAR_W_KEY))
        const w = rawW ? parseInt(rawW, 10) : 320
        setSidebarW(Number.isFinite(w) ? w : 320)

        // Sessions list (per-user)
        let list: SessionMeta[] = []
        try {
          const raw = localStorage.getItem(k0(SESSIONS_KEY))
          list = raw ? JSON.parse(raw) : []
        } catch { list = [] }

        // If first time for this user, seed a UNIQUE session id (no "demo")
        if (!Array.isArray(list) || list.length === 0) {
          const sid = newSessionId()
          const seeded: SessionMeta[] = [{
            id: sid,
            title: `Untitled session — ${new Date().toLocaleString()}`,
            created_at: Date.now(),
          }]
          localStorage.setItem(k0(SESSIONS_KEY), JSON.stringify(seeded))
          localStorage.setItem(k0(ACTIVE_KEY), sid)
          list = seeded
        }

        // Active session for this user
        let active = localStorage.getItem(k0(ACTIVE_KEY))
        if (!active) {
          active = list[0].id
          localStorage.setItem(k0(ACTIVE_KEY), active)
        }

        // Load state for active session (per-user)
        let saved: Partial<SessionState> = {}
        try {
          const raw = localStorage.getItem(stateKey0(active))
          saved = raw ? JSON.parse(raw) : {}
        } catch { saved = {} }

        // Optional URL override for artifact_id
        const urlArtifact = search.get('artifact_id') || ''

        setNs(ns0)
        setSessions(list)
        setSessionId(active)
        setMessages(saved.messages && saved.messages.length ? saved.messages : defaultGreeting)
        setArtifactId(urlArtifact || saved.artifactId || '')
        setCurrentNodeId(saved.currentNodeId ?? null)
        setUpdateKey(k => k + 1)
        setReady(true)
      } catch {
        // Fallback guest bootstrap (still unique, no "demo")
        const ns0 = `user:${slug('guest')}`
        const k0 = (key: string) => `${ns0}::${key}`
        const stateKey0 = (sid: string) => `${ns0}::${STATE_PREFIX}${sid}`

        const rawW = localStorage.getItem(k0(SIDEBAR_W_KEY))
        const w = rawW ? parseInt(rawW, 10) : 320
        setSidebarW(Number.isFinite(w) ? w : 320)

        let list: SessionMeta[] = []
        try {
          const raw = localStorage.getItem(k0(SESSIONS_KEY))
          list = raw ? JSON.parse(raw) : []
        } catch { list = [] }
        if (!Array.isArray(list) || list.length === 0) {
          const sid = newSessionId()
          const seeded: SessionMeta[] = [{
            id: sid,
            title: `Untitled session — ${new Date().toLocaleString()}`,
            created_at: Date.now(),
          }]
          localStorage.setItem(k0(SESSIONS_KEY), JSON.stringify(seeded))
          localStorage.setItem(k0(ACTIVE_KEY), sid)
          list = seeded
        }
        let active = localStorage.getItem(k0(ACTIVE_KEY))
        if (!active) {
          active = list[0].id
          localStorage.setItem(k0(ACTIVE_KEY), active)
        }

        let saved: Partial<SessionState> = {}
        try {
          const raw = localStorage.getItem(stateKey0(active))
          saved = raw ? JSON.parse(raw) : {}
        } catch { saved = {} }

        setNs(ns0)
        setSessions(list)
        setSessionId(active)
        setMessages(saved.messages && saved.messages.length ? saved.messages : defaultGreeting)
        setArtifactId(saved.artifactId || '')
        setCurrentNodeId(saved.currentNodeId ?? null)
        setUpdateKey(k => k + 1)
        setReady(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Per-session persistence (namespaced) ----------
  useEffect(() => {
    if (!ready || switchingRef.current || !sessionId) return
    try {
      const existingRaw = localStorage.getItem(stateKey(sessionId))
      const existing: Partial<SessionState> = existingRaw ? JSON.parse(existingRaw) : {}
      const merged: SessionState = {
        messages: messages ?? existing.messages ?? defaultGreeting,
        artifactId: artifactId ?? existing.artifactId,
        currentNodeId: currentNodeId ?? existing.currentNodeId ?? null,
        updated_at: Date.now(),
      }
      localStorage.setItem(stateKey(sessionId), JSON.stringify(merged))
    } catch { /* ignore */ }
  }, [ready, ns, sessionId, messages, artifactId, currentNodeId])

  // ---------- Actions ----------
  async function send() {
    if (!ready) return
    const text = input.trim()
    if (!text) return
    if (!artifactId) { setError('Upload a CSV first using the 📎 button.'); return }

    setMessages(m => [...m, { role: 'user', text }])
    setInput('')
    setBusy(true)
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

      if (res?.intent?.type === 'report') {
        const html = res?.result?.html || '<p>No content.</p>'
        const a = res?.result?.artifact || {}
        setMessages(m => [...m, {
          role: 'assistant',
          text: "Here’s your report.",
          block: { type: 'report', html, artifactId: a.artifact_id, title: res?.result?.title }
        }])
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
        const title = (res?.result?.title && String(res.result.title)) || 'Chart'
        setMessages(m => [...m, {
          role: 'assistant',
          text: 'Here’s your chart.',
          block: { type: 'image', artifactId: a.artifact_id, title }
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
    } catch (e: any) {
      setError(e.message || 'Checkout failed')
    }
  }

  // Per-user sessions helpers
  function loadSessionsNS(): SessionMeta[] {
    try {
      const raw = localStorage.getItem(k(SESSIONS_KEY))
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }
  function saveSessionsNS(list: SessionMeta[]) {
    localStorage.setItem(k(SESSIONS_KEY), JSON.stringify(list))
  }

  function labelWithFilename(id: string, filename: string) {
    const list = loadSessionsNS()
    const idx = list.findIndex(s => s.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], title: `${filename} — ${new Date().toLocaleString()}` }
      saveSessionsNS(list)
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
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function onSelectSession(id: string) {
    if (!ready || id === sessionId) return
    switchingRef.current = true
    localStorage.setItem(k(ACTIVE_KEY), id)
    setSessionId(id)

    try {
      const raw = localStorage.getItem(stateKey(id))
      const saved: Partial<SessionState> = raw ? JSON.parse(raw) : {}
      setMessages(saved.messages && saved.messages.length ? saved.messages : defaultGreeting)
      setArtifactId(saved.artifactId || '')
      setCurrentNodeId(saved.currentNodeId ?? null)
      setUpdateKey(k => k + 1)
    } catch {
      setMessages(defaultGreeting)
      setArtifactId('')
      setCurrentNodeId(null)
      setUpdateKey(k => k + 1)
    }
    switchingRef.current = false
  }

  function onNewSession() {
    if (!ready) return
    const id = newSessionId() // unique per user (prevents DAG collision)
    const meta: SessionMeta = {
      id,
      title: `Untitled session — ${new Date().toLocaleString()}`,
      created_at: Date.now(),
    }
    const list = [meta, ...loadSessionsNS()]
    saveSessionsNS(list)
    setSessions(list)
    localStorage.setItem(k(ACTIVE_KEY), id)

    const seeded: SessionState = { messages: defaultGreeting, artifactId: '', currentNodeId: null, updated_at: Date.now() }
    localStorage.setItem(stateKey(id), JSON.stringify(seeded))

    switchingRef.current = true
    setSessionId(id)
    setMessages(defaultGreeting)
    setArtifactId('')
    setCurrentNodeId(null)
    setUpdateKey(k => k + 1)
    switchingRef.current = false
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

        .logout {
          appearance: none;
          display: inline-flex; align-items: center; justify-content: center;
          height: 36px; padding: 0 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.16);
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0a0f13; font-weight: 800; letter-spacing: .2px;
          cursor: pointer;
          box-shadow: 0 0 0 0 rgba(0,0,0,0);
        }
        .logout:hover { filter: brightness(1.05); }

        .content {
          display: grid;
          grid-template-columns: var(--sidebar) 1fr;
          height: calc(100vh - var(--topbar-h));
          min-width: 0;
          position: relative;
        }

        .sidebar {
          position: relative;
          z-index: 60;
          height: 100%;
          background: transparent;
          overflow: hidden;
        }
        .sidebar::after{
          content:'';
          position:absolute;
          top:0; right:0;
          width:1px; height:100%;
          background: var(--line);
          pointer-events:none;
        }
        .sidebar-inner{
          height: 100%;
          display: grid;
          grid-template-rows: auto auto 1fr;
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
          margin-bottom: 20px;
        }
        .session-item {
          height: 40px; display: flex; align-items: center;
          padding: 0 12px;
          border-radius: 12px; cursor: pointer;
          border: 1px solid var(--line); background: rgba(255,255,255,0.06);
          font-size: 13px; line-height: 1; font-weight: 600;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          transition: background .15s ease, color .15s ease, border-color .15s ease;
          flex: 0 0 auto;
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

        .resize-handle {
          position: absolute;
          top: 0; right: calc(-1 * var(--handle) / 2);
          width: var(--handle);
          height: 100%;
          cursor: col-resize;
          z-index: 61;
          background: transparent;
        }

        .chat-area{
          height: calc(100vh - var(--topbar-h) - var(--composer-h));
          min-height: 0;
          overflow-y: auto;
          position: relative;
          padding-bottom: 24px;
          scroll-padding-bottom: 24px;
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
        .msg.assistant .bubble { 
          flex: 0 1 980 px;
          width: 100%;
          overflow: hidden;
          max-width: 980px; 
          background: transparent; 
          border: none; 
          box-shadow: none; 
          padding: 0; 
          margin: 0; 
        }

        .msg.assistant.intro .asst-text {
          font-size: clamp(18px, 2.2vw, 22px);
          line-height: 1.5;
          font-weight: 700;
          letter-spacing: .2px;
          padding: 4px 2px;
        }

        .asst-text { line-height: 1.7; font-size: 15px; padding: 6px 2px; max-width: 100% }

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

        .composer {
          position: fixed;
          left: var(--sidebar);
          right: 0;
          bottom: 0;
          height: var(--composer-h);
          z-index: 40;
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
        /* Plot card styled like NiceTable */
        .plot-card{
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          overflow: hidden;
        }
        .plot-head{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:10px 12px;
          border-bottom:1px solid var(--line);
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(4px);
        }
        .plot-title{
          font-weight:700; letter-spacing:.2px; opacity:.95; font-size:13px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .plot-actions{ display:flex; gap:8px; align-items:center; }
        .plot-btn{
          appearance:none; padding:6px 10px; border-radius:10px;
          border:1px solid var(--line); background: rgba(255,255,255,0.10);
          color:#fff; font-weight:800; font-size:12px; cursor:pointer; text-decoration:none;
          display:inline-flex; align-items:center;
        }
        .plot-btn:hover{ border-color: var(--ring); }

        .plot-wrap{
          width:100%;
          max-height: 420px;
          display:flex; align-items:center; justify-content:center;
          background: rgba(255,255,255,0.03);
        }
        .plot-wrap img{
          display:block; max-width:100%; max-height:420px; object-fit: contain;
        }
        .plot-foot{
          padding:8px 12px;
          border-top:1px solid rgba(255,255,255,0.22);
          background: rgba(7,10,13,0.88);
          font-size:11px; line-height:1.3;
          color:#B8C2D9; font-weight:700;
        }
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
                {ready && (
                  <HistoryDag
                    key={`${ns}::${sessionId}::${updateKey}`} // remount per user/session
                    sessionId={sessionId}
                    currentNodeId={currentNodeId}
                    updateKey={updateKey}
                    onSelect={handleDagSelect}
                  />
                )}
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
          <section className="chat-area" ref={chatAreaRef}>
            <div className="chat-scroll">
              {!ready ? (
                <div className="muted" style={{ padding: 16 }}>Loading…</div>
              ) : (
                <>
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`msg ${m.role === 'user' ? 'user' : 'assistant'} ${i === 0 && m.role === 'assistant' ? 'intro' : ''}`}
                    >
                      <div className="bubble">
                        {m.role === 'assistant' ? (
                          <>
                            <div className="asst-text">{m.text}</div>
                            {m.block?.type === 'report' && (
                              <NiceReport
                                html={m.block.html}
                                artifactId={m.block.artifactId}
                                title={m.block.title || 'Report'}
                              />
                            )}
                            {m.block?.type === 'table' && (
                              <NiceTable
                                columns={m.block.columns}
                                rows={m.block.rows}
                                artifactId={m.block.artifactId}
                                maxHeight={360}
                              />
                            )}
                            {m.block?.type === 'image' && (
                              <div className="plot-card">
                                <div className="plot-head">
                                  <div className="plot-title">{m.block.title || 'Chart'}</div>
                                  <div className="plot-actions">
                                    <a
                                      className="plot-btn"
                                      href={artifactUrl(m.block.artifactId)}
                                      download={`plot-${m.block.artifactId.slice(0,8)}.png`}
                                    >
                                      Download
                                    </a>
                                  </div>
                                </div>

                                <div className="plot-wrap">
                                  <img
                                    src={artifactUrl(m.block.artifactId)}
                                    alt={m.block.title || 'plot'}
                                    onLoad={() => { if (isAutoScroll.current) scrollToEnd('auto') }}
                                  />
                                </div>

                                <div className="plot-foot">
                                  Artifact — <span className="idmono">{m.block.artifactId}</span>
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
                  {error && <div style={{ color:'#ffb3b3', marginTop: 8 }}>{error}</div>}
                  <div ref={endRef} />
                </>
              )}
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
              disabled={busy || !ready}
            />

            <button className="send-btn" onClick={send} disabled={busy || !ready}>
              {busy ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
