import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Brindlewick Admin',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#1a1a24', color: '#e8e0d0', fontFamily: 'system-ui, sans-serif' }}
    >
      {children}
    </div>
  )
}
