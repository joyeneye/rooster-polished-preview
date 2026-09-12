// Test-only loader. Actual handlers are exercised with injected in-memory stores.
// No production adapter, identity call, or moderation provider is simulated as live.
import { existsSync } from 'node:fs';

const sources = {
  '@netlify/blobs': `export const getStore=()=>{throw new Error('Cloud storage is unavailable in offline tests')};export const getDeployStore=getStore;`,
  '@netlify/identity': `export const getUser=async()=>{throw new Error('Identity must be injected for offline tests')};`,
  // The opportunities module holds a module-scope client. It has to import
  // cleanly offline, and any query through it has to fail loudly.
  'drizzle-orm/netlify-db': `export const drizzle=()=>new Proxy({},{get(){throw new Error('The database is unavailable in offline tests')}});`,
};
export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(sources, specifier)) return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  // The database modules are TypeScript but are imported with the ".js"
  // specifier TypeScript itself expects. The bundler rewrites that; node's
  // type stripping does not, so point it at the file that is really there.
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(candidate)) return {url:candidate.href, format:'module-typescript', shortCircuit:true};
  }
  return nextResolve(specifier, context);
}
