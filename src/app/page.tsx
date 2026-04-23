import { DashboardProvider } from '@/components/providers/DashboardProvider';
import { DashboardShell } from '@/components/features/DashboardShell';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Subtle grid overlay — accent-tinted */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in srgb, var(--accent-primary) 3%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--accent-primary) 3%, transparent) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }}
        aria-hidden="true"
      />
      <div className="relative z-10 h-screen">
        <DashboardProvider>
          <DashboardShell />
        </DashboardProvider>
      </div>
    </main>
  );
}
