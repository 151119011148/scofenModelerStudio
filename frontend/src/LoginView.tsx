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
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const account = username.trim()
    // 从聊天/文档复制口令时容易带上首尾空格；本实例口令不含空白，统一裁掉。
    const secret = password.trim()
    if (!account || !secret) {
      setError('请填写用户名和密码')
      return
    }
    if (/[^\x20-\x7E]/.test(secret)) {
      setError('密码含全角或非英文字符，请切换到英文输入法后重新输入')
      return
    }
    setBusy(true)
    setError('')
    try {
      const session = await login(account, secret)
      saveSession(session)
      onSuccess(session)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      setError(reason.includes('用户名或密码不正确')
        ? '用户名或密码不正确：账号是 scofen（全小写），密码区分大小写。若浏览器自动填充了其它站点的账号，请清空两个输入框后手动填写。'
        : reason)
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
        <form className="auth-form" autoComplete="off" onSubmit={(event) => void submit(event)}>
          <label>
            <span>用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              name="scofen-admin-username"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              placeholder="超管账号：scofen"
              autoFocus
            />
          </label>
          <label>
            <span>密码</span>
            <div className="auth-password">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                name="scofen-admin-password"
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                placeholder="请输入密码"
              />
              <button
                className="auth-eye"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                title={showPassword ? '隐藏密码' : '显示密码，核对输入内容'}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="auth-tip">
          超管账号 <code>scofen</code>（全小写），密码区分大小写。<br />
          本实例已关闭自助注册；登录后方可读写模型、图与项目。
        </p>
      </div>
    </div>
  )
}
