import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'packages/api-contract/schema.graphql',
  documents: 'packages/api-contract/operations.graphql',
  ignoreNoDocuments: false,
  config: {
    useTypeImports: true,
    strictScalars: true,
    defaultScalarType: 'never',
    scalars: {
      Decimal: { input: 'string', output: 'string' },
      Date: { input: 'string', output: 'string' },
      DateTime: { input: 'string', output: 'string' },
      JSONObject: { input: '../../json#JsonObject', output: '../../json#JsonObject' },
    },
  },
  generates: {
    'packages/api-contract/generated/client/': { preset: 'client', presetConfig: { fragmentMasking: false } },
    'packages/api-contract/generated/server/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
    },
  },
};

export default config;
