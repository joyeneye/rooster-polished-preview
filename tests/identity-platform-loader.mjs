// Run the real Identity SDK while keeping unrelated databases/storage offline.
import {resolve as offlineResolve} from './offline-platform-loader.mjs';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@netlify/identity') return nextResolve(specifier, context);
  return offlineResolve(specifier, context, nextResolve);
}
