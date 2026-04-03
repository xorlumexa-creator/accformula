import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const plans = [
  {
    name: 'Basic',
    price: 20,
    badge: null,
    features: [
      '1 active project',
      'All core features',
      'Gemini Flash AI',
      'Community support',
      'CAD Analysis',
      'Code Section',
      'Telemetry monitoring',
    ],
  },
  {
    name: 'Pro',
    price: 40,
    badge: 'Most Popular',
    features: [
      '3 active projects',
      'Priority analysis queue',
      'Gemini Pro AI',
      'Email support',
      'Export reports as PDF',
      'FEA Analysis',
      'Before vs After comparison',
      'Advanced Design Guides',
    ],
  },
  {
    name: 'Elite',
    price: 80,
    badge: 'Best Value',
    features: [
      'Unlimited projects',
      'Advanced Gemini Pro analysis',
      'Priority support',
      'White-label report export',
      'API access',
      'Advanced FEA analysis',
      'IC & Wire Integration',
      'Custom branding on exports',
      'Team collaboration (coming soon)',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="space-y-8 animate-slide-up max-w-4xl mx-auto">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Choose Your Plan</h1>
        <p className="text-muted-foreground mt-2">Scale your hardware development with Lumexa</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {plans.map(plan => (
          <div key={plan.name}
            className={`rounded-xl border p-6 flex flex-col ${plan.name === 'Pro' ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border/30'}`}
            style={{ background: '#111111' }}>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold">{plan.name}</h2>
                {plan.badge && <Badge variant="outline" className="border-primary/50 text-primary text-xs">{plan.badge}</Badge>}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-primary">${plan.price}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
            </div>

            <ul className="space-y-2 flex-1 mb-6">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Button variant={plan.name === 'Pro' ? 'default' : 'outline'} className="w-full">
              Get Started
            </Button>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        All plans include a 7-day free trial. Cancel anytime.
      </p>
    </div>
  );
}
