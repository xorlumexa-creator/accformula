import { Link } from 'react-router-dom';
import {
  Check, ArrowRight, Sparkles, Zap, Shield, FileOutput,
  Cpu, Boxes, MessageSquare, Gauge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import lumexaLogo from '@/assets/lumexa-logo.webp';

// Same three tiers/prices as PricingPage.tsx — kept in sync manually since
// this page and PricingPage.tsx are separate files; if you change pricing,
// update both.
const plans = [
  {
    name: 'Basic', price: 20, badge: null,
    features: ['1 active project', 'All core features', 'Gemini Flash AI', 'Community support', 'CAD Analysis'],
  },
  {
    name: 'Pro', price: 40, badge: 'Most Popular',
    features: ['3 active projects', 'Priority analysis queue', 'Gemini Pro AI', 'Email support', 'FEA Analysis'],
  },
  {
    name: 'Elite', price: 80, badge: 'Best Value',
    features: ['Unlimited projects', 'Advanced Gemini Pro analysis', 'Priority support', 'API access', 'Advanced FEA analysis'],
  },
];

const features = [
  { icon: Sparkles, title: 'Describe, Don\u2019t Draft', desc: 'Tell it what you need in plain language — Lumexa generates real, parametric CAD geometry from your description.' },
  { icon: Gauge, title: 'Real Physics, Not Guesses', desc: 'Solid tetrahedral FEM, fatigue, fracture, and thermal analysis run before you ever touch Ansys.' },
  { icon: Boxes, title: 'Self-Healing Design Loop', desc: 'Failed a check? Lumexa reads the failure and regenerates a corrected design automatically.' },
  { icon: FileOutput, title: 'Export, Ready to Manufacture', desc: 'STEP for Ansys/SolidWorks, DXF for laser-cutting and CNC shops — not locked into one format.' },
  { icon: Cpu, title: 'Assembly-Aware', desc: 'Analyze how multiple parts fit and interact, not just one component in isolation.' },
  { icon: MessageSquare, title: 'Iterate by Conversation', desc: 'Refine your design by talking through changes, the same way you\u2019d brief a colleague.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/30">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src={lumexaLogo} alt="Lumexa" className="w-8 h-8 rounded-lg object-cover" />
            <span className="font-bold tracking-tight text-lg">Lumexa</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative gradient-hero">
        <div className="max-w-4xl mx-auto px-4 pt-20 pb-16 text-center">
          <Badge variant="outline" className="border-primary/50 text-primary mb-6">
            AI-native engineering, from prompt to part
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
            Design it. <span className="text-gradient">Validate it.</span> Build it.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Lumexa turns a plain-language description into real CAD geometry, runs
            structural analysis before you spend a dollar on simulation software,
            and hands off a manufacturing-ready file when it's done.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="gap-2 px-8">
                Start building free <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <a href="#plans">
              <Button size="lg" variant="outline" className="px-8">See plans</Button>
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold">Everything between an idea and a real part</h2>
          <p className="text-muted-foreground mt-2">Not a CAD editor. An engineering loop.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div key={f.title} className="gradient-card rounded-xl border border-border/30 p-6">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-border/30 bg-secondary/20">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Sandboxed AI code execution</div>
          <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Real CalculiX FEM solver</div>
          <div className="flex items-center gap-2"><FileOutput className="w-4 h-4 text-primary" /> STEP + DXF export</div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="max-w-4xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold">Choose your plan</h2>
          <p className="text-muted-foreground mt-2">Every plan includes a 7-day free trial. Cancel anytime.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl border p-6 flex flex-col ${plan.name === 'Pro' ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border/30'}`}
              style={{ background: '#111111' }}
            >
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {plan.badge && (
                    <Badge variant="outline" className="border-primary/50 text-primary text-xs">
                      {plan.badge}
                    </Badge>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-primary">${plan.price}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
              </div>
              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/auth">
                <Button variant={plan.name === 'Pro' ? 'default' : 'outline'} className="w-full">
                  Get Started
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="gradient-hero border-t border-border/30">
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">Go from prompt to Ansys-ready part.</h2>
          <p className="text-muted-foreground mb-8">No CAD background required to start.</p>
          <Link to="/auth">
            <Button size="lg" className="gap-2 px-8">
              Create your account <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border/30 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Lumexa. All rights reserved.
      </footer>
    </div>
  );
}
