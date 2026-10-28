import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VetCred — Your service. Your story. Your next chapter.',
  description: 'Turn military experience into a civilian career portfolio, with your story and supporting evidence connected.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
