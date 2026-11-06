import { LOCALES, setLocale, useLocale } from './i18n'

/**
 * 顶栏 / 登录页通用的中英切换按钮。
 *
 * <p>用分段控件而非下拉：两个候选项一屏可见，切换成本最低；
 * 当前项高亮，未选项淡化。语言状态由 {@link useLocale} 订阅，
 * 切换后所有订阅者（含整个 StudioApp）自动重渲染。</p>
 */
export default function LocaleSwitch({ compact = false }: { compact?: boolean }) {
  const locale = useLocale()
  return (
    <div className={`locale-switch${compact ? ' compact' : ''}`} role="group" aria-label="Language / 语言">
      {LOCALES.map((option) => (
        <button
          key={option.code}
          type="button"
          className={locale === option.code ? 'active' : ''}
          aria-pressed={locale === option.code}
          title={option.label}
          onClick={() => setLocale(option.code)}
        >
          {compact ? option.short : option.label}
        </button>
      ))}
    </div>
  )
}
