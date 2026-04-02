import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Upload, FileInput, Search, Microscope, MessageSquare, Timer, LogOut, Menu, X, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import lumexaLogo from '@/assets/lumexa-logo.webp';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/upload', icon: Upload, label: 'Sensor Telemetry' },
  { to: '/import-design', icon: FileInput, label: 'Insert Design' },
  { to: '/assembly', icon: Search, label: 'Inspector' },
  { to: '/fea', icon: Microscope, label: 'FEA' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { to: '/design-generator', icon: Sparkles, label: 'Design Generator' },
  { to: '/lap-calculator', icon: Timer, label: 'Lap Calc' },
];

export default function AppLayout() {
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>

      {/* Hamburger Button — fixed bottom-left */}
      <button
        onClick={() => setMenuOpen(true)}
        className="fixed bottom-5 left-5 z-[60] w-12 h-12 rounded-lg flex items-center justify-center border border-primary/40 transition-all hover:border-primary"
        style={{ background: '#111111' }}
      >
        <Menu className="w-5 h-5 text-primary" />
      </button>

      {/* Overlay */}
      <div
        className={`fixed inset-0 z-[70] bg-black/60 transition-opacity duration-250 ${menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Slide-out Menu Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 left-0 z-[80] h-full w-[280px] flex flex-col transition-transform duration-250 ease-out border-r border-border/30`}
        style={{ background: '#0a0a0a', transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between p-5 border-b border-border/30">
          <div className="flex items-center gap-3">
            <img src={lumexaLogo} alt="Lumexa" className="w-10 h-10 rounded-lg object-cover" />
            <span className="text-lg font-bold tracking-tight font-display text-gradient">LUMEXA</span>
          </div>
          <button onClick={() => setMenuOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Sign Out */}
        <div className="p-4 border-t border-border/30">
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
