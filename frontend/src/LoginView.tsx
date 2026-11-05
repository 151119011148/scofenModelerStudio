import { useState } from 'react'
import type { FormEvent } from 'react'
import { login, saveSession } from './api'
import type { Session } from './types'

interface Props {
  onSuccess: (session: Session) => void
}

/** 登录页：仿 scofenDoc 的居中卡片，但使用本产品的品牌与配色。 */
export default function LoginView({ onSuccess }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!username.trim() || !password) {
      setError('请填写用户名和密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      const session = await login(username.trim(), password)
      saveSession(session)
      onSuccess(session)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true" />
          <h1>Scofen Modeler Studio</h1>
          <p>One model. Nine views.</p>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="登录名"
              autoFocus
            />
          </label>
          <label>
            <span>密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="auth-tip">
          本实例已关闭自助注册，请使用管理员账号登录。<br />
          登录后方可读写模型、图与项目。
        </p>
      </div>
    </div>
  )
}
