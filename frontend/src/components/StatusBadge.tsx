type StatusBadgeProps = {
  value?: string;
  kind?: 'status' | 'sync';
};

const statusLabelMap: Record<string, { label: string; tone: string }> = {
  active: { label: 'Ativo', tone: 'success' },
  paused: { label: 'Pausado', tone: 'warning' },
  closed: { label: 'Encerrado', tone: 'neutral' },
  under_review: { label: 'Em revisao', tone: 'info' },
  inactive: { label: 'Inativo', tone: 'neutral' },
};

const syncLabelMap: Record<string, { label: string; tone: string }> = {
  synced: { label: 'Sincronizado', tone: 'info' },
  missing_remote: { label: 'Divergente', tone: 'warning' },
  remote_changed: { label: 'Mudanca remota', tone: 'warning' },
  conflict: { label: 'Conflito', tone: 'warning' },
};

function formatFallbackLabel(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function StatusBadge({ value = 'unknown', kind = 'status' }: StatusBadgeProps) {
  const lookup = kind === 'sync' ? syncLabelMap : statusLabelMap;
  const mapped = lookup[value] ?? {
    label: formatFallbackLabel(value),
    tone: kind === 'sync' ? 'warning' : 'neutral',
  };

  return <span className={`status-badge status-badge--${mapped.tone}`}>{mapped.label}</span>;
}

export default StatusBadge;
