import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Upload, BarChart3, MessageSquare, Timer, Activity } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/upload', icon: Upload, label: 'Upload' },
  { to: '/analysis', icon: BarChart3, label: 'Analysis' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { to: '/lap-calculator', icon: Timer, label: 'Lap Calc' },
];

export default function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar */}
      <header className="h-14 border-b border-border flex items-center px-4 md:px-6 gap-3 shrink-0 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <Activity className="w-6 h-6 text-primary" />
        <h1 className="text-lg font-bold tracking-tight">
          Formula<span className="text-primary">Acc</span>
        </h1>
        <span className="hidden sm:inline text-xs text-muted-foreground ml-1 border border-border rounded px-1.5 py-0.5">
          TELEMETRY
        </span>
        <nav className="ml-auto flex items-center gap-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Page Content */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
