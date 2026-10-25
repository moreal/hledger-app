import { defineConfig } from '@lingui/conf';
import { formatter } from '@lingui/format-po';

export default defineConfig({
  sourceLocale: 'ko',
  locales: ['ko', 'en'],
  fallbackLocales: { default: 'ko' },
  catalogs: [{
    path: '<rootDir>/packages/i18n/locales/{locale}/messages',
    include: ['<rootDir>/apps', '<rootDir>/packages/ui-*', '<rootDir>/packages/i18n/src'],
    exclude: ['**/node_modules/**', '**/*.test.*', '**/dist/**', '**/build/**', '**/locales/**'],
  }],
  format: formatter({ lineNumbers: false }),
  compileNamespace: 'es',
});
