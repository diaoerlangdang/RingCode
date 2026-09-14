import type { AgentDef } from '@/types'

export function CloneEntrySelect({
  agents,
  value,
  disabled,
  disabledReason,
  onChange,
}: {
  agents: AgentDef[]
  value: string
  disabled?: boolean
  disabledReason?: string
  onChange: (id: string) => void
}) {
  if (agents.length <= 1) return null
  return (
    <label className="clone-entry-select" title={disabled ? disabledReason : '改选同家族入口，使用该入口当前配置'}>
      <span>入口</span>
      <select
        value={value}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.value)}
      >
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
            {agent.commandName ? ` · ${agent.commandName}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
