interface RiskBadgeProps {
  level: 'low' | 'medium' | 'high' | 'critical';
}

const colorMap = {
  low: 'bg-risk-low',
  medium: 'bg-risk-medium',
  high: 'bg-risk-high',
  critical: 'bg-risk-critical',
};

export default function RiskBadge({ level }: RiskBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold uppercase text-white ${colorMap[level]}`}
    >
      {level}
    </span>
  );
}
