// TerminalShell.jsx — presentation boundary for product pages. The single active
// header/section navigation and bottom sport navigation are mounted globally by
// App.jsx; this wrapper prevents older page-local chrome from reappearing.

export default function TerminalShell({ children }) {
  return (
    <div className="wp-product-page">
      <style>{SHELL_CSS}</style>
      {children}
    </div>
  );
}

const SHELL_CSS = `
.wp-product-page{min-width:0;min-height:100vh;background:#090a0c;color:#f4f1e9}
.wp-product-page *{box-sizing:border-box}
.wp-product-page>.app{max-width:1180px!important;margin:0 auto!important}
.wp-product-page .hd,.wp-product-page .nav,.wp-product-page .wpbn,.wp-product-page .demobar,.wp-product-page .mrsb{display:none!important}
@media(max-width:767px){.wp-product-page>.app{max-width:100%!important}}
`;
