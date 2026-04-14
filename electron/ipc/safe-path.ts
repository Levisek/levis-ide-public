import * as path from 'path';
import { store } from '../store';

// Validuje, ze cesta lezi uvnitr nektereho z povolenych rootu.
// Brani path traversal utokum z rendereru (napr. ../../../etc/passwd).
export function isPathAllowed(targetPath: string): boolean {
  if (!targetPath || typeof targetPath !== 'string') return false;
  let resolved: string;
  try {
    resolved = path.resolve(targetPath);
  } catch {
    return false;
  }
  const roots = getAllowedRoots();
  return roots.some(root => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

export function getAllowedRoots(): string[] {
  const scanPath = (store.get('scanPath', '') as string) || '';
  const home = process.env.USERPROFILE || process.env.HOME;
  // Fail-secure: bez HOME jen scanPath, ne relativní cesty (jinak by '../' atak.)
  const roots: string[] = [];
  if (scanPath && path.isAbsolute(scanPath)) roots.push(scanPath);
  if (home && path.isAbsolute(home)) {
    roots.push(path.join(home, 'dev'));
    roots.push(path.join(home, 'Documents'));
    roots.push(path.join(home, 'Desktop'));
  }
  return roots;
}

export function assertPathAllowed(targetPath: string): void {
  if (!isPathAllowed(targetPath)) {
    throw new Error(`Path not allowed: ${targetPath}`);
  }
}
