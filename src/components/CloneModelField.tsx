import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { visibleCloneModels } from '@/lib/cloneModelPick'

export function CloneModelField(props: {
  value: string
  onChange: (value: string) => void
  models: string[]
  listId?: string
  busy?: boolean
  hint?: string
  fetchDisabled?: boolean
  onFetch: () => void
  inputStyle: CSSProperties
}) {
  const { value, onChange, models, busy, hint, fetchDisabled, onFetch, inputStyle } = props
  const listDomId = useId()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const visible = visibleCloneModels(models, value, filtering)

  useEffect(() => {
    if (models.length) {
      setOpen(true)
      setFiltering(false)
    }
  }, [models])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (id: string) => {
    onChange(id)
    setFiltering(false)
    setOpen(false)
  }

  return (
    <div className="settings-field">
      模型（选填）
      <div className="clone-model-combo" ref={boxRef}>
        <div className="clone-model-row">
          <input
            style={inputStyle}
            role="combobox"
            aria-expanded={open}
            aria-controls={listDomId}
            aria-autocomplete="list"
            value={value}
            onFocus={() => {
              if (models.length) {
                setOpen(true)
                setFiltering(false)
              }
            }}
            onChange={(e) => {
              onChange(e.target.value)
              setFiltering(true)
              if (models.length) setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder={models.length ? '点击查看全部，输入可筛选或手填' : '留空则跟随 CLI 默认；可先获取列表'}
          />
          <button className="btn" type="button" disabled={!!busy || !!fetchDisabled} onClick={onFetch}>
            {busy ? '获取中…' : '获取模型列表'}
          </button>
        </div>
        {open && models.length > 0 && (
          <ul id={listDomId} className="clone-model-list" role="listbox">
            {visible.length ? (
              visible.map((id) => (
                <li key={id} role="option" aria-selected={id === value}>
                  <button
                    type="button"
                    className={`clone-model-option${id === value ? ' selected' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(id)}
                  >
                    {id}
                  </button>
                </li>
              ))
            ) : (
              <li className="clone-model-empty">无匹配，可继续手填</li>
            )}
          </ul>
        )}
      </div>
      {hint ? <span className="desc">{hint}</span> : null}
    </div>
  )
}
