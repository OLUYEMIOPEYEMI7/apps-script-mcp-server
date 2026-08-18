import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root of the project (one level up from dist/ or src/)
export const PROJECT_ROOT = path.resolve(__dirname, "..");

// Where the downloaded OAuth client file must be placed by the user.
export const CREDENTIALS_PATH = path.join(PROJECT_ROOT, "credentials.json");

// Where the resulting user access/refresh token is cached after `npm run authorize`.
export const TOKEN_PATH = path.join(PROJECT_ROOT, "token.json");

// Scopes requested. Kept to the minimum needed to read/write script project
// content and inspect deployments/versions.
export const SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
];

// Loopback redirect port used during the one-time interactive authorization.
export const OAUTH_LOOPBACK_PORT = 42813;

// Environment variable name for the shared secret required on every request
// to the HTTP transport. Required whenever TRANSPORT=http (i.e. on Render).
export const AUTH_TOKEN_ENV_VAR = "MCP_SERVER_TOKEN";

// Character limit applied to any single tool response before truncation.
export const CHARACTER_LIMIT = 25000;
