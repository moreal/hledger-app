import { readFile } from 'node:fs/promises';
import { assertValidSchema, buildASTSchema, parse, validate } from 'graphql';

try {
  const schemaSource = await readFile(new URL('./schema.graphql', import.meta.url), 'utf8');
  const operationSource = await readFile(new URL('./operations.graphql', import.meta.url), 'utf8');
  const schema = buildASTSchema(parse(schemaSource));
  assertValidSchema(schema);
  const errors = validate(schema, parse(operationSource));
  if (errors.length > 0) {
    for (const error of errors) console.error(error.toString());
    process.exitCode = 1;
  } else {
    console.log('GraphQL schema and shared operations are valid.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
