import { useCallback, useEffect, useState } from 'react'
import {
  deleteAdminUser,
  getAdminPermissions,
  getAdminRoles,
  getAdminUsers,
  saveAdminRole,
  saveAdminUser,
} from './api'
import type { AdminRole, AdminUser } from './types'
import { t, useLocale } from './i18n'

interface Props {
  onClose: () => void
  onMessage: (key: string, vars?: Record<string, unknown>) => void
}

/** 正在编辑的用户（口令留空表示不修改）。 */
interface UserDraft {
  username: string
  displayName: string
  password: string
  enabled: boolean
  roles: string[]
}

interface RoleDraft {
  code: string
  name: string
  description: string
  permissions: string[]
}

const emptyUser = (): UserDraft => ({
  username: '',
  displayName: '',
  password: '',
  enabled: true,
  roles: [],
})

const emptyRole = (): RoleDraft => ({ code: '', name: '', description: '', permissions: [] })

/**
 * 用户与角色管理抽屉。
 *
 * <p>权限码由服务端下发（/api/admin/permissions），前端不另维护一份清单，
 * 免得后端加了权限而界面勾不到。</p>
 */
export default function AdminPanel({ onClose, onMessage }: Props) {
  useLocale()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<AdminRole[]>([])
  const [permissions, setPermissions] = useState<{ code: string; label: string }[]>([])
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null)
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [userList, roleList, permissionList] = await Promise.all([
        getAdminUsers(),
        getAdminRoles(),
        getAdminPermissions(),
      ])
      setUsers(userList.users)
      setRoles(roleList.roles)
      setPermissions(permissionList.permissions)
    } catch (error) {
      onMessage('读取用户与角色失败：{error}', { error: error instanceof Error ? error.message : String(error) })
    }
  }, [onMessage])

  useEffect(() => {
    void reload()
  }, [reload])

  async function submitUser() {
    if (!userDraft) return
    setBusy(true)
    try {
      await saveAdminUser({
        username: userDraft.username.trim(),
        displayName: userDraft.displayName.trim(),
        password: userDraft.password,
        enabled: userDraft.enabled,
        roles: userDraft.roles,
      })
      onMessage('已保存用户 {username}', { username: userDraft.username })
      setUserDraft(null)
      await reload()
    } catch (error) {
      onMessage('保存用户失败：{error}', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  async function removeUser(username: string) {
    setBusy(true)
    try {
      await deleteAdminUser(username)
      onMessage('已删除用户 {username}', { username })
      await reload()
    } catch (error) {
      onMessage('删除用户失败：{error}', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  async function submitRole() {
    if (!roleDraft) return
    setBusy(true)
    try {
      await saveAdminRole({
        code: roleDraft.code.trim(),
        name: roleDraft.name.trim(),
        description: roleDraft.description.trim(),
        permissions: roleDraft.permissions,
      })
      onMessage('已保存角色 {code}', { code: roleDraft.code })
      setRoleDraft(null)
      await reload()
    } catch (error) {
      onMessage('保存角色失败：{error}', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  return (
    <aside className="admin-panel" role="dialog" aria-label={t('用户与角色')}>
      <header className="admin-head">
        <h2>{t('用户与角色')}</h2>
        <button type="button" onClick={onClose} title={t('关闭')}>{t('关闭')}</button>
      </header>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>{t('用户')}</h3>
          <button type="button" className="prop-link" onClick={() => setUserDraft(emptyUser())}>
            {t('新建用户')}
          </button>
        </div>
        {userDraft && (
          <div className="admin-form">
            <label>
              <span>{t('用户名')}</span>
              <input
                value={userDraft.username}
                onChange={(event) => setUserDraft({ ...userDraft, username: event.target.value })}
              />
            </label>
            <label>
              <span>{t('展示名')}</span>
              <input
                value={userDraft.displayName}
                onChange={(event) => setUserDraft({ ...userDraft, displayName: event.target.value })}
              />
            </label>
            <label>
              <span>{t('口令')}</span>
              <input
                type="password"
                value={userDraft.password}
                placeholder={t('留空表示不修改口令')}
                onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })}
              />
            </label>
            <div className="admin-checks">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={userDraft.enabled}
                  onChange={(event) => setUserDraft({ ...userDraft, enabled: event.target.checked })}
                />
                <span>{t('启用')}</span>
              </label>
            </div>
            <div className="admin-roles">
              <span className="admin-label">{t('角色')}</span>
              {roles.map((role) => (
                <label key={role.code} className="admin-check">
                  <input
                    type="checkbox"
                    checked={userDraft.roles.includes(role.code)}
                    onChange={() => setUserDraft({ ...userDraft, roles: toggle(userDraft.roles, role.code) })}
                  />
                  <span>{role.name}</span>
                </label>
              ))}
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" disabled={busy || !userDraft.username.trim()}
                onClick={() => void submitUser()}>
                {t('保存')}
              </button>
              <button type="button" onClick={() => setUserDraft(null)}>{t('取消')}</button>
            </div>
          </div>
        )}
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('用户名')}</th>
              <th>{t('展示名')}</th>
              <th>{t('角色')}</th>
              <th>{t('启用')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}{user.builtin && <span className="role-badge">{t('内置')}</span>}</td>
                <td>{user.displayName}</td>
                <td>{user.roles.join('、')}</td>
                <td>{user.enabled ? t('是') : t('否')}</td>
                <td className="admin-row-actions">
                  <button type="button" className="prop-link" onClick={() => setUserDraft({
                    username: user.username,
                    displayName: user.displayName,
                    password: '',
                    enabled: user.enabled,
                    roles: [...user.roles],
                  })}>{t('编辑')}</button>
                  {!user.builtin && (
                    <button type="button" className="prop-link danger" disabled={busy}
                      onClick={() => void removeUser(user.username)}>{t('删除')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h3>{t('角色')}</h3>
          <button type="button" className="prop-link" onClick={() => setRoleDraft(emptyRole())}>
            {t('新建角色')}
          </button>
        </div>
        {roleDraft && (
          <div className="admin-form">
            <label>
              <span>{t('角色码')}</span>
              <input
                value={roleDraft.code}
                onChange={(event) => setRoleDraft({ ...roleDraft, code: event.target.value })}
              />
            </label>
            <label>
              <span>{t('名称')}</span>
              <input
                value={roleDraft.name}
                onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })}
              />
            </label>
            <label>
              <span>{t('说明')}</span>
              <input
                value={roleDraft.description}
                onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })}
              />
            </label>
            <div className="admin-roles">
              <span className="admin-label">{t('权限')}</span>
              {permissions.map((permission) => (
                <label key={permission.code} className="admin-check">
                  <input
                    type="checkbox"
                    checked={roleDraft.permissions.includes(permission.code)}
                    onChange={() => setRoleDraft({
                      ...roleDraft,
                      permissions: toggle(roleDraft.permissions, permission.code),
                    })}
                  />
                  <span>{permission.label}</span>
                </label>
              ))}
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" disabled={busy || !roleDraft.code.trim()}
                onClick={() => void submitRole()}>
                {t('保存')}
              </button>
              <button type="button" onClick={() => setRoleDraft(null)}>{t('取消')}</button>
            </div>
          </div>
        )}
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('角色码')}</th>
              <th>{t('名称')}</th>
              <th>{t('权限')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.code}>
                <td>{role.code}{role.builtin && <span className="role-badge">{t('内置')}</span>}</td>
                <td>{role.name}</td>
                <td>{role.permissions.length}</td>
                <td className="admin-row-actions">
                  <button type="button" className="prop-link" onClick={() => setRoleDraft({
                    code: role.code,
                    name: role.name,
                    description: role.description,
                    permissions: [...role.permissions],
                  })}>{t('编辑')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </aside>
  )
}
