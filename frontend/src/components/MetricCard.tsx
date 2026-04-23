type MetricCardProps = {
  label: string;
  value: string;
  hint: string;
  accent: 'gold' | 'blue' | 'green' | 'slate';
};

function MetricCard({ label, value, hint, accent }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${accent}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      <p className="metric-card__hint">{hint}</p>
    </article>
  );
}

export default MetricCard;
