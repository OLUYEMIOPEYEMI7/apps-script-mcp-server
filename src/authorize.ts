import http from "node:http";
import { URL } from "node:url";
import open from "open";
import { loadClientSecrets, saveCredentials, SCOPES } from "./auth.js";
import { OAUTH_LOOPBACK_PORT } from "./constants.js";

async function waitForAuthorizationCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://localhost:${OAUTH_LOOPBACK_PORT}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`Google returned an error: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid or missing authorization response. You can close this tab.");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Authorization complete. You can close this tab and return to the terminal.");
      server.close();
      resolve(code);
    });

    server.listen(OAUTH_LOOPBACK_PORT, () => {
      console.error(`Waiting for Google authorization on http://localhost:${OAUTH_LOOPBACK_PORT} ...`);
    });

    server.on("error", (err) => reject(err));
  });
}

async function main(): Promise<void> {
  const { client } = await loadClientSecrets();

  const state = Math.random().toString(36).slice(2);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });

  console.error("Opening browser for Google authorization...");
  console.error(`If it doesn't open automatically, visit:\n${authUrl}\n`);
  await open(authUrl).catch(() => {
    /* headless environment — the user will click the printed link instead */
  });

  const code = await waitForAuthorizationCode(state);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  await saveCredentials(client);
  console.error("\n✅ Authorization saved to token.json. You can now run: npm start");
}

main().catch((err) => {
  console.error("Authorization failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
