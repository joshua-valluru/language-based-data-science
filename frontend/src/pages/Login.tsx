import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register as apiRegister } from '../lib/api'

export default function Login() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'login'|'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await apiRegister(email, password)
      }
      nav('/chat')
    } catch (e: any) {
      setErr(e.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight:'100vh', display:'grid', placeItems:'center',
      background:'linear-gradient(180deg,#0b1014,#0a0f13)'
    }}>
      <form onSubmit={submit} style={{
        width: 400, maxWidth:'90vw',
        background:'rgba(255,255,255,0.06)',
        border:'1px solid rgba(255,255,255,0.12)',
        borderRadius:16, padding:22, color:'white',
        boxShadow:'0 20px 60px rgba(0,0,0,0.4)'
      }}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:20}}>
          <div style={{
            width:24, height:24, borderRadius:8,
            background:'linear-gradient(135deg,#1bd8a0,#18b38a)'
          }} />
          <div style={{fontWeight:800, letterSpacing:.2}}>GenBio AIDO</div>
        </div>

        <h2 style={{margin:'6px 0 16px', fontSize:18, opacity:.95}}>
          {mode === 'login' ? 'Sign in' : 'Create your account'}
        </h2>

        <div style={{display:'grid', gap:10}}>
          <input
            type="email" required placeholder="Email"
            value={email} onChange={e=>setEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password" required placeholder="Password (min 8 chars)"
            value={password} onChange={e=>setPassword(e.target.value)}
            style={inputStyle}
          />
          <button disabled={busy} style={btnStyle}>
            {busy ? 'Working…' : (mode === 'login' ? 'Sign in' : 'Register')}
          </button>
          {err && <div style={{color:'#ffb3b3', fontSize:13}}>{err}</div>}
        </div>

        <div style={{marginTop:14, fontSize:13, opacity:.9}}>
          {mode === 'login' ? (
            <>New here? <a href="#" onClick={(e)=>{e.preventDefault(); setMode('register')}}>Create an account</a></>
          ) : (
            <>Already have an account? <a href="#" onClick={(e)=>{e.preventDefault(); setMode('login')}}>Sign in</a></>
          )}
        </div>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding:'12px 14px', borderRadius:12,
  background:'rgba(255,255,255,0.06)', color:'white',
  border:'1px solid rgba(255,255,255,0.14)', outline:'none'
}

const btnStyle: React.CSSProperties = {
  padding:'12px 14px', borderRadius:12,
  background:'linear-gradient(135deg,#1bd8a0,#18b38a)',
  color:'#0a0f13', fontWeight:800, border:'1px solid rgba(255,255,255,0.18)',
  cursor:'pointer'
}
