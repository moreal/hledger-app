import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../../../packages/ui-web/src/**/*.stories.tsx', '../src/I18n.stories.tsx'],
  // Scraped previews are local review data, never part of a deployable build.
  staticDirs: (_dirs, { configType }) => configType === 'DEVELOPMENT' ? ['./public'] : [],
  async viteFinal(config, { configType }) {
    if (configType === 'PRODUCTION') config.publicDir = false;
    return config;
  },
  core: { disableTelemetry: true },
};
export default config;
