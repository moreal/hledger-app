import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { tokens } from '../../../packages/design-tokens/src/index';
import '../../../packages/ui-web/src/styles.css';
import { Gallery } from './Gallery';
import { App } from './App';
import { i18n, activateLocale } from '../../../packages/i18n/src/index';
import { I18nProvider } from '../../../packages/i18n/src/react';
import { readLocale } from './locale';

const rootStyle = document.documentElement.style;
for (const [name, value] of Object.entries(tokens.colors)) rootStyle.setProperty(`--color-${name}`, value);
for (const [name, value] of Object.entries(tokens.space)) rootStyle.setProperty(`--space-${name}`, `${value}px`);
for (const [name, value] of Object.entries(tokens.radius)) rootStyle.setProperty(`--radius-${name}`, `${value}px`);
for (const [name, value] of Object.entries(tokens.fontSize)) rootStyle.setProperty(`--font-${name}`, `${value / 16}rem`);
for (const [name, role] of Object.entries(tokens.typography)) {
  rootStyle.setProperty(`--type-${name}-size`, `${role.fontSize / 16}rem`);
  rootStyle.setProperty(`--type-${name}-line`, String(role.lineHeight / role.fontSize));
  rootStyle.setProperty(`--type-${name}-weight`, String(role.fontWeight));
}
rootStyle.setProperty('--font-family', tokens.fontFamily.web);
rootStyle.setProperty('--control-min', `${tokens.size.controlMin}px`);
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.colors.background);

activateLocale(readLocale());
const isGallery = window.location.pathname.replace(/\/$/, '') === '/gallery';
function updateDocumentLocale() {
  document.documentElement.lang = i18n.locale;
  document.title = i18n._(isGallery
    ? /* i18n */ { id: 'document.gallery', message: 'hledger — 디자인 갤러리' }
    : /* i18n */ { id: 'document.ledger', message: 'hledger — 개인 원장' });
}
updateDocumentLocale();
i18n.on('change', updateDocumentLocale);
createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider i18n={i18n}>{isGallery ? <Gallery /> : <App />}</I18nProvider></StrictMode>);
