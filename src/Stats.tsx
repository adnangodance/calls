import { useId } from 'react';

export function StatBars({ value, total, label, segments = 40, gradient = false }: { value: number; total: number; label: string; segments?: number; gradient?: boolean }) {
  const filled = Math.round(value / total * segments);
  return <div className="stat-bars" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
    {Array.from({ length: segments }, (_, i) => <span key={i} className={i < filled ? 'is-filled' : ''} style={gradient && i < filled ? { backgroundColor: `hsl(${Math.round(i / Math.max(1, filled - 1) * 36)} 95% 58%)` } : undefined} />)}
  </div>;
}

export function ScoreSparkline({ values, itemLabels, label = 'Best quiz scores in demo order.', emptyLabel = 'No quiz scores yet' }: { values: (number | undefined)[]; itemLabels?: string[]; label?: string; emptyLabel?: string }) {
  const point = (value: number, index: number) => ({ x: 4 + index / Math.max(1, values.length - 1) * 312, y: 34 - value / 100 * 28 });
  const path = values.map((value, i) => {
    if (value === undefined) return '';
    const { x, y } = point(value, i);
    return `${i > 0 && values[i - 1] !== undefined ? 'L' : 'M'}${x},${y}`;
  }).join(' ');
  const description = values.flatMap((value, i) => value === undefined ? [] : [`${itemLabels?.[i] || `Demo ${i + 1}`}: ${value}%`]).join(', ');
  return <svg className="stat-sparkline" viewBox="0 0 320 40" preserveAspectRatio="none" role="img" aria-label={description ? `${label} ${description}` : emptyLabel}>
    <path className="stat-chart-baseline" d="M4,35 H316" />
    {values.map((_, i) => <path className="stat-chart-tick" key={i} d={`M${point(0, i).x},36 v3`} />)}
    <path className="stat-chart-line" d={path} />
    {values.map((value, i) => value === undefined ? null : <circle className="stat-chart-point" key={i} cx={point(value, i).x} cy={point(value, i).y} r="2.5" />)}
  </svg>;
}

export function ScoreGauge({ score, demo = 1, caption, ariaLabel, statusLabel, colorTone }: { score?: number; demo?: number; caption?: string; ariaLabel?: string; statusLabel?: string; colorTone?: 'high' | 'medium' | 'low' | 'unscored' }) {
  const gradientId = useId();
  const arc = 'M46.16 119.84 A62 62 0 1 1 133.84 119.84';
  const angle = (135 + (score ?? 0) * 2.7) * Math.PI / 180;
  const status = score === undefined ? 'unscored' : score >= 67 ? 'passed' : 'retry';
  const tone = colorTone ?? (score === undefined ? 'unscored' : score === 100 ? 'high' : score >= 67 ? 'medium' : 'low');
  return <div className={`score-gauge ${status} score-${tone}`} role="img" aria-label={ariaLabel || (score === undefined ? `Demo ${demo} has no quiz score yet` : `Best quiz score for demo ${demo}: ${score} out of 100. ${status === 'passed' ? 'Passed' : 'Try again'}.`)}>
    <svg viewBox="0 0 180 130" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor="var(--gauge-start)" /><stop offset="55%" stopColor="var(--gauge-middle)" /><stop offset="100%" stopColor="var(--gauge-end)" /></linearGradient></defs>
      <path className="score-gauge-halo" d={arc} />
      <path className="score-gauge-track" d={arc} />
      <path className="score-gauge-fill" d={arc} pathLength="100" stroke={`url(#${gradientId})`} strokeDasharray={`${score ?? 0} 100`} />
      {score !== undefined && <circle className="score-gauge-marker" cx={90 + 62 * Math.cos(angle)} cy={76 + 62 * Math.sin(angle)} r="4" />}
    </svg>
    <div className="score-gauge-readout" aria-hidden="true"><span className="score-gauge-number">{score ?? '—'}</span><span className="score-gauge-caption">{caption || `Best · Demo ${String(demo).padStart(2, '0')}`}</span></div>
    <span className="score-gauge-status" aria-hidden="true">{statusLabel || (status === 'unscored' ? 'Not scored' : status === 'passed' ? 'Passed' : 'Try again')}</span>
  </div>;
}
