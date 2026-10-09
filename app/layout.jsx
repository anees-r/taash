import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/cards.css';
import '@/styles/screens.css';
import '@/styles/table.css';
import '@/styles/app.css';
import { Sprite } from '@/components/platform/Sprite';
import { Providers } from '@/components/platform/Providers';
import { getViewer } from '@/lib/auth/viewer';

export const metadata = {
  title: { default: 'Taash', template: '%s · Taash' },
  description: 'Taash — traditional card games with friends. First table: Thulla.',
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  icons: { icon: '/icon.svg' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#120e1f' };

export default async function RootLayout({ children }) {
  const viewer = await getViewer();
  const v = viewer.kind === 'anon' ? { kind: 'anon' } : { kind: viewer.kind, playerId: viewer.playerId, name: viewer.name, handle: viewer.handle };
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rozha+One&family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Libre+Caslon+Text:wght@400;700&display=swap" />
        {/* Only the glyphs for تاش and تھلا */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@500&text=%D8%AA%D8%A7%D8%B4%D8%AA%DA%BE%D9%84%D8%A7%20&display=swap" />
      </head>
      <body>
        <Sprite />
        <Providers viewer={v}>{children}</Providers>
        <div id="layer-modal" />
        <div id="layer-toast" className="toast-stack" role="status" aria-live="polite" />
        <div id="layer-fx" className="fx-layer" aria-hidden="true" />
      </body>
    </html>
  );
}
