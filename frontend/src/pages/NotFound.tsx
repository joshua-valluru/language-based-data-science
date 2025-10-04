import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      minHeight:'100vh',
      display:'grid',
      placeItems:'center',
      background:'linear-gradient(180deg,#0b1014,#0a0f13)',
      color:'white'
    }}>
      <div style={{
        background:'rgba(255,255,255,0.06)',
        border:'1px solid rgba(255,255,255,0.12)',
        borderRadius:16,
        padding:24,
        width:420,
        maxWidth:'92vw',
        textAlign:'center'
      }}>
        <div style={{fontSize:22, fontWeight:800, marginBottom:8}}>Page not found</div>
        <div style={{opacity:.9, marginBottom:18}}>The page you’re looking for doesn’t exist.</div>
        <div style={{display:'flex', gap:10, justifyContent:'center'}}>
          <Link to="/login" style={btnStyle}>Go to Login</Link>
          <Link to="/chat" style={btnStyle}>Go to Chat</Link>
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding:'10px 14px',
  borderRadius:12,
  background:'linear-gradient(135deg,#1bd8a0,#18b38a)',
  color:'#0a0f13',
  fontWeight:800,
  border:'1px solid rgba(255,255,255,0.18)',
  textDecoration:'none'
}
