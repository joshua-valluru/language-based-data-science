// frontend/src/lib/api.ts

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// ---------- Shared Types ----------
export type HistoryNode = {
  node_id: string
  op_type: string
  parent_node_ids: string[]
  primary_artifact_id: string
  created_at?: number
}

export type NodeDetail = {
  node_id: string
  op_type: string
  op_params: any
  parent_node_ids: string[]
  primary_artifact_id?: string | null
  created_at: number
  session_id: string
}

// Small helper: build URLs safely
function q(params: Record<string, string | number | undefined>) {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) usp.set(k, String(v))
  })
  return usp.toString()
}

// ---------- Upload / Ingest ----------
export async function uploadCsv(file: File, sessionId: string) {
  const fd = new FormData()
  fd.append('file', file)
  const url = `${API_BASE}/v1/upload?${q({ session_id: sessionId })}`
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'include' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `uploadCsv() failed with ${res.status}`)
  }
  return res.json()
}

// ---------- Ask / LLM ----------
export async function ask(
  sessionId: string,
  artifactId: string,
  prompt: string,
  _baseNodeId?: string // ignored to match backend schema
): Promise<any> {
  const body = {
    session_id: sessionId,
    artifact_id: artifactId,
    message: prompt,
  }

  const res = await fetch(`${API_BASE}/v1/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `ask() failed with ${res.status}`)
  }
  return res.json()
}


// ---------- Artifacts ----------
export function artifactUrl(artifactId: string) {
  // Plain, reliable URL (no cache-buster)
  return `${API_BASE}/v1/artifacts/${encodeURIComponent(artifactId)}`
}

// ---------- History / DAG ----------
export async function getHistory(sessionId: string): Promise<{
  session_id: string
  items: HistoryNode[]
  head_node_id?: string
}> {
  const res = await fetch(`${API_BASE}/v1/history?${q({ session_id: sessionId })}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `getHistory() failed with ${res.status}`)
  }
  const json = await res.json()
  return {
    session_id: json.session_id,
    items: (json.items ?? json.nodes ?? []) as HistoryNode[], // backend returns "items"
    head_node_id: json.head_node_id,
  }
}

export async function checkout(sessionId: string, nodeId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, node_id: nodeId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `checkout() failed with ${res.status}`)
  }
}

export async function register(email: string, password: string) {
  const r = await fetch(`${API_BASE}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function login(email: string, password: string) {
  const r = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function me() {
  const r = await fetch(`${API_BASE}/v1/auth/me`, { credentials: 'include' })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

export async function logout() {
  await fetch(`${API_BASE}/v1/auth/logout`, { method: 'POST', credentials: 'include' })
}

export async function getNode(nodeId: string): Promise<NodeDetail> {
  const r = await fetch(`${API_BASE}/v1/nodes/${encodeURIComponent(nodeId)}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
