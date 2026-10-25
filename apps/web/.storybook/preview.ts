import type { Preview } from '@storybook/react-vite';
import { createElement, useEffect, type ReactNode } from 'react';
import { activateLocale, i18n, resolveLocale, type AppLocale } from '../../../packages/i18n/src/index.ts';
import { I18nProvider } from '../../../packages/i18n/src/react.tsx';
import { tokens } from '../../../packages/design-tokens/src/index';
import '../../../packages/ui-web/src/styles.css';
import '../src/app.css';

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

function LocalePreview({ locale, children }: { locale: AppLocale; children?: ReactNode }) {
  useEffect(() => { activateLocale(locale); }, [locale]);
  return createElement(I18nProvider, { i18n }, children);
}

const preview: Preview = {
  parameters: { layout: 'padded', controls: { expanded: true } },
  initialGlobals: { locale: 'ko' },
  globalTypes: {
    locale: {
      description: 'Preview language',
      toolbar: {
        icon: 'globe',
        items: [{ value: 'ko', title: '한국어' }, { value: 'en', title: 'English' }],
        dynamicTitle: true,
      },
    },
  },
  decorators: [(Story, context) => createElement(
    LocalePreview,
    { locale: resolveLocale(context.globals.locale) },
    createElement(Story),
  )],
};
export default preview;
