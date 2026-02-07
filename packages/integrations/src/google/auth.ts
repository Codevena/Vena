import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { IntegrationError } from '@vena/shared';

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  tokenPath?: string;
}

export class GoogleAuth {
  private oauth2Client: OAuth2Client;
  private tokenPath: string;

  constructor(config: GoogleAuthConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri ?? 'http://localhost:3000/oauth2callback',
    );
    this.tokenPath = config.tokenPath ?? resolve(homedir(), '.vena', 'google-tokens.json');

    const tokens = this.loadTokens();
    if (tokens) {
      this.oauth2Client.setCredentials(tokens);
    }

    this.oauth2Client.on('tokens', (newTokens: Credentials) => {
      const existing = this.loadTokens();
      const merged = { ...existing, ...newTokens };
      this.saveTokens(merged);
    });
  }

  getAuthUrl(scopes: string[]): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  async exchangeCode(code: string): Promise<Credentials> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      this.saveTokens(tokens);
      return tokens;
    } catch (error) {
      throw new IntegrationError(
        `Failed to exchange authorization code: ${error instanceof Error ? error.message : String(error)}`,
        'google-auth',
      );
    }
  }

  getClient(): OAuth2Client {
    return this.oauth2Client;
  }

  saveTokens(tokens: Credentials): void {
    try {
      const dir = dirname(this.tokenPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');
    } catch (error) {
      throw new IntegrationError(
        `Failed to save tokens: ${error instanceof Error ? error.message : String(error)}`,
        'google-auth',
      );
    }
  }

  loadTokens(): Credentials | null {
    try {
      if (!existsSync(this.tokenPath)) {
        return null;
      }
      const data = readFileSync(this.tokenPath, 'utf-8');
      return JSON.parse(data) as Credentials;
    } catch {
      return null;
    }
  }
}
