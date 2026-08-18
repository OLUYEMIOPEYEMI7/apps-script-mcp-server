import fs from "node:fs/promises";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { CREDENTIALS_PATH, OAUTH_LOOPBACK_PORT, SCOPES, TOKEN_PATH } from "./constants.js";

interface StoredCredentials {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface ClientSecretFile {
  installed?: { client_id: string; client_secret: string; redirect_uris: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris: string[] };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Builds an OAuth2Client from credentials, preferring environment variables
 * (used on headless deployments like Render, where there's no local browser
 * and no writable place to keep a long-lived token.json), and falling back
 * to the local token.json file (used for local/desktop development).
 *
 * Returns null if neither source has credentials yet.
 */
export async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
  const envClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const envRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (envClientId && envClientSecret && envRefreshToken) {
    const client = new google.auth.OAuth2(envClientId, envClientSecret);
    client.setCredentials({ refresh_token: envRefreshToken });
    return client;
  }

  const token = await readJson<StoredCredentials>(TOKEN_PATH);
  if (!token) return null;

  const client = new google.auth.OAuth2(token.client_id, token.client_secret);
  client.setCredentials({ refresh_token: token.refresh_token });
  return client;
}

/**
 * Reads the user-downloaded OAuth client (credentials.json) and returns
 * a fresh, unauthenticated OAuth2Client plus the redirect URI to use.
 */
export async function loadClientSecrets(): Promise<{
  client: OAuth2Client;
  redirectUri: string;
}> {
  const raw = await readJson<ClientSecretFile>(CREDENTIALS_PATH);
  if (!raw) {
    throw new Error(
      `Could not find ${CREDENTIALS_PATH}. Download an OAuth client (type: Desktop app) ` +
        `from Google Cloud Console > APIs & Services > Credentials, save it as credentials.json ` +
        `in the project root, then run: npm run authorize`
    );
  }
  const config = raw.installed ?? raw.web;
  if (!config) {
    throw new Error(
      "credentials.json is not a recognized OAuth client file (expected an 'installed' or 'web' key)."
    );
  }
  // Desktop-app OAuth clients accept any loopback port at consent time (RFC 8252),
  // so we always target our fixed local port regardless of what's in the file.
  const redirectUri = `http://localhost:${OAUTH_LOOPBACK_PORT}`;
  const client = new google.auth.OAuth2(config.client_id, config.client_secret, redirectUri);
  return { client, redirectUri };
}

/**
 * Persists the authorized client's refresh token to disk so future server
 * runs don't require re-authorizing in a browser.
 */
export async function saveCredentials(client: OAuth2Client): Promise<void> {
  const raw = await readJson<ClientSecretFile>(CREDENTIALS_PATH);
  const config = raw?.installed ?? raw?.web;
  if (!config) {
    throw new Error(`Could not read client_id/client_secret from ${CREDENTIALS_PATH}.`);
  }
  const refreshToken = client.credentials.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "No refresh_token was returned. Revoke prior access at " +
        "https://myaccount.google.com/permissions and re-run `npm run authorize`."
    );
  }
  const payload: StoredCredentials = {
    type: "authorized_user",
    client_id: config.client_id,
    client_secret: config.client_secret,
    refresh_token: refreshToken,
  };
  await fs.writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export { SCOPES };
