export const DEFAULT_GOOGLE_SCOPE_KEYS = ['gmail', 'docs', 'sheets', 'calendar', 'drive'] as const;

export const GOOGLE_SCOPE_MAP: Record<string, string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  drive: ['https://www.googleapis.com/auth/drive'],
  docs: ['https://www.googleapis.com/auth/documents'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
};

export function normalizeGoogleScopes(scopes?: string[]): { scopeKeys: string[]; oauthScopes: string[] } {
  const raw = (scopes && scopes.length > 0) ? scopes : [...DEFAULT_GOOGLE_SCOPE_KEYS];
  const oauthScopes: string[] = [];

  for (const scope of raw) {
    if (scope.startsWith('http://') || scope.startsWith('https://')) {
      oauthScopes.push(scope);
      continue;
    }
    const mapped = GOOGLE_SCOPE_MAP[scope];
    if (mapped) {
      oauthScopes.push(...mapped);
      continue;
    }
    oauthScopes.push(scope);
  }

  const unique = Array.from(new Set(oauthScopes));
  return { scopeKeys: raw, oauthScopes: unique };
}
