/** Site footer: copyright and credit. Shared by every page with the normal chrome. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        <span suppressHydrationWarning>© {new Date().getFullYear()}</span>{' '}
        <a href="https://nezden.com" target="_blank" rel="noopener">Nezden</a>
        <span className="sf-dot" aria-hidden="true">·</span>
        Built by <a href="https://dev.nezden.com" target="_blank" rel="noopener">Anees Rehman</a>
      </p>
    </footer>
  );
}
