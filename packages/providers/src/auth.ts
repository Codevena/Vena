import type { AuthConfig } from '@vena/shared';
import { ProviderError } from '@vena/shared';

/**
 * Token state for OAuth providers. Tracks the current access token
 * and handles automatic refresh when tokens expire.
 */
export interface TokenState {
  accessToken: string;
  expiresAt: number | null;
  refreshToken: string | null;
}

/**
 * Resolve authentication to an API key or bearer token.
 * Supports: api_key, oauth_token, bearer_token.
 * For OAuth tokens with refresh, automatically refreshes when expired.
 */
export async function resolveAuth(
  auth: AuthConfig | undefined,
  legacyApiKey: string | undefined,
  providerName: string,
): Promise<string> {
  // Legacy: plain apiKey field (backwards compatible)
  if (!auth && legacyApiKey) {
    return legacyApiKey;
  }

  if (!auth) {
    throw new ProviderError(`No authentication configured for ${providerName}`, providerName);
  }

  switch (auth.type) {
    case 'api_key':
      if (!auth.apiKey) {
        throw new ProviderError(`API key not provided for ${providerName}`, providerName);
      }
      return auth.apiKey;

    case 'bearer_token':
    case 'oauth_token': {
      if (auth.oauthToken) {
        // Check if token is expired and we have refresh capability
        if (auth.expiresAt && auth.refreshToken && Date.now() > auth.expiresAt) {
          return await refreshOAuthToken(auth, providerName);
        }
        return auth.oauthToken;
      }
      throw new ProviderError(`OAuth/bearer token not provided for ${providerName}`, providerName);
    }

    default:
      throw new ProviderError(`Unknown auth type for ${providerName}`, providerName);
  }
}

/**
 * Refresh an expired OAuth token using the refresh token.
 */
async function refreshOAuthToken(auth: AuthConfig, providerName: string): Promise<string> {
  if (!auth.refreshToken || !auth.tokenUrl) {
    throw new ProviderError(
      `Cannot refresh token for ${providerName}: missing refreshToken or tokenUrl`,
      providerName,
    );
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    ...(auth.clientId ? { client_id: auth.clientId } : {}),
    ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
  });

  const response = await fetch(auth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ProviderError(
      `Token refresh failed for ${providerName}: ${response.status} ${text}`,
      providerName,
    );
  }

  const data = await response.json() as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };

  // Update auth config in-place for subsequent calls
  auth.oauthToken = data.access_token;
  if (data.expires_in) {
    auth.expiresAt = Date.now() + data.expires_in * 1000;
  }
  if (data.refresh_token) {
    auth.refreshToken = data.refresh_token;
  }

  return data.access_token;
}

/**
 * Create provider-specific auth headers for APIs that need Bearer tokens.
 */
export function authHeaders(token: string, type: 'api_key' | 'bearer' = 'api_key'): Record<string, string> {
  if (type === 'bearer') {
    return { Authorization: `Bearer ${token}` };
  }
  return { Authorization: `Bearer ${token}` }; // Most APIs use Bearer for API keys too
}
