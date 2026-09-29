import type { Metadata } from 'next';
import '../styles/globals.css';
import Shell from '@/components/layout/Shell';
import { AuthProvider } from '@/lib/auth';
import { AppProvider } from '@/lib/store';

export const metadata: Metadata = { title: 'FlowPay', description: 'Payment infrastructure for a multi-currency world.' };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppProvider>
            <Shell>{children}</Shell>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
