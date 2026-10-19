// node --import ./ts-extensionless.mjs --test *.unit.ts
// The guard modules import each other without extensions (what Playwright's TypeScript loader wants); plain Node needs ".ts".
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw error;
  }
}`), import.meta.url);
