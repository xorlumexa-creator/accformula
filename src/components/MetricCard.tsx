import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  unit: string;
  icon: LucideIcon;
  variant?: 'default' | 'primary' | 'accent' | 'success';
}

const variantStyles = {
  default: 'border-border',
  primary: 'border-primary/30 glow-red',
  accent: 'border-accent/30 glow-accent',
  success: 'border-success/30',
};

const iconVariant = {
  default: 'text-muted-foreground',
  primary: 'text-primary',
  accent: 'text-accent',
  success: 'text-success',
};

export default function MetricCard({ label, value, unit, icon: Icon, variant = 'default' }: MetricCardProps) {
  return (
    <div className={`gradient-card rounded-lg border p-4 animate-slide-up ${variantStyles[variant]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${iconVariant[variant]}`} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold data-display">{value}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
