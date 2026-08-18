# apps-script-mcp-server

An MCP server that lets Claude read and push Google Apps Script (`.gs`, `.html`,
`appsscript.json`) code directly into a script project — no more copy-pasting code into
the Apps Script editor by hand.

Built for the **Kwara disease surveillance system** (KWARAB dashboard), but works with any
Apps Script project you have edit access to.

## What it can do

| Tool | What it does |
|---|---|
| `apps_script_get_project_info` | Confirm you're pointed at the right project |
| `apps_script_get_content` | Read all (or one) file's current source |
| `apps_script_update_file` | Push/overwrite **one** file's code (the main "post .gs code" tool) |
| `apps_script_update_content` | Replace the entire file set atomically |
| `apps_script_list_versions` | See saved version history |
| `apps_script_create_version` | Snapshot the current code as a new version |
| `apps_script_list_deployments` | See existing web app / deployment info |

**Important limitation to know up front:** pushing code with `apps_script_update_file` /
`apps_script_update_content` updates the *editable* project, the same as typing in the
script editor and saving. It does **not** automatically update anything already deployed
(e.g. a live web app URL, or triggers bound to a specific deployed version). To go live
with changes, create a version (`apps_script_create_version`) and then redeploy from the
Apps Script editor — this server doesn't touch deployment publishing, on purpose, since
that's a more consequential action worth doing by hand the first few times.

---

## 1. One-time Google Cloud setup (do this first)

You need a Google Cloud project with the Apps Script API enabled and an OAuth client. This
takes about 5 minutes.

1. **Create or pick a Google Cloud project**
   Go to https://console.cloud.google.com/projectcreate and create a project (any name is
   fine — e.g. "kwarab-apps-script-mcp"). If you already have a GCP project you use for
   other Kwara/Ekiti work, you can reuse it.

2. **Enable the Apps Script API on the project**
   Go to https://console.cloud.google.com/apis/library/script.googleapis.com, select your
   project, and click **Enable**.

3. **Configure the OAuth consent screen**
   Go to https://console.cloud.google.com/apis/credentials/consent
   - User type: **External** (unless you have a Google Workspace org, then Internal is fine)
   - Fill in app name (e.g. "Apps Script MCP"), your email as support contact
   - Scopes: you can skip adding scopes here — the server requests them directly
   - Test users: **add your own Google account email** (required while the app is in
     "Testing" status, which is fine for personal/internal use)

4. **Create an OAuth client**
   Go to https://console.cloud.google.com/apis/credentials
   - Click **Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Name it anything (e.g. "Apps Script MCP Desktop")
   - Click **Create**, then **Download JSON**

5. **Save the downloaded file** as `credentials.json` in this project's root folder
   (same folder as this README). Do not commit or share this file — it identifies your
   OAuth client (not your personal account, but still keep it private).

6. **Enable the Apps Script API for your own Google account**
   This is separate from step 2 (that enables the API for the *project*; this enables it
   for the *Google account* that owns/edits the script). Go to
   https://script.google.com/home/usersettings and turn on
   **"Google Apps Script API"**.

---

## 2. Install and authorize

```bash
npm install
npm run build
npm run authorize
```

`npm run authorize` opens your browser, asks you to sign in with the Google account that
has access to the Kwara disease surveillance Apps Script project, and asks you to approve
access. After approving, it saves a refresh token to `token.json` in this folder — you
only need to do this once (re-run it if you ever revoke access or switch Google accounts).

**If nothing opens automatically:** the terminal will print a URL — copy-paste it into any
browser, approve, and you'll be redirected back to `localhost` where the script is
listening; the terminal will confirm success.

---

## 3. Connect it to Claude

### Option A: Local (stdio) — Claude Code / Claude Desktop

Add to your MCP config (e.g. `claude_desktop_config.json` or your Claude Code MCP settings):

```json
{
  "mcpServers": {
    "apps-script": {
      "command": "node",
      "args": ["/absolute/path/to/apps-script-mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop / Claude Code after adding this. You should see `apps-script`
listed among connected MCP servers, with tools like `apps_script_update_file` available.

### Option B: Remote (HTTP), e.g. hosted on Render

The server also runs as a standalone HTTP service — set `TRANSPORT=http`. This is what
`render.yaml` in this repo configures automatically. See **Deploying to Render** below.

A remote server is reachable by anyone who has its URL, so every request to `/mcp` must
include a bearer token matching the `MCP_SERVER_TOKEN` environment variable you set:

```
Authorization: Bearer <your MCP_SERVER_TOKEN value>
```

In Claude's remote MCP connector settings, add the server URL
(`https://<your-service>.onrender.com/mcp`) and set that header. `/healthz` is
intentionally unauthenticated so Render's health checks can reach it.

---

## Deploying to Render

This repo includes a `render.yaml` Blueprint, so Render can create the service with most
settings pre-filled.

1. In the Render dashboard: **New → Blueprint**, connect your GitHub account if you
   haven't already, and select this repository. Render will read `render.yaml`.
2. Render will prompt you for the environment variables marked `sync: false`:
   - `MCP_SERVER_TOKEN` — make up a long random string (e.g. `openssl rand -hex 32`).
     This is what Claude must send as the bearer token.
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`
     — generate these **locally first** (steps 1–2 above, including `npm run authorize`),
     then open the resulting `token.json` and copy `client_id`, `client_secret`, and
     `refresh_token` into Render's environment variable fields. Render never gets a
     browser, so this headless-credential path replaces the local `npm run authorize` step.
3. Deploy. Once live, the MCP endpoint is `https://<your-service>.onrender.com/mcp`.
4. On the free plan, Render spins the service down after inactivity — the first request
   after idling will be slow (cold start) while it spins back up.

---

## 4. Using it

You'll need the **script ID** of the Kwara disease surveillance Apps Script project. Find
it by opening the project at https://script.google.com, and copying the ID out of the URL:

```
https://script.google.com/home/projects/<THIS_IS_THE_SCRIPT_ID>/edit
```

(If the Apps Script is bound to the KWARAB Google Sheet rather than standalone, open the
sheet → **Extensions → Apps Script** to get to the same editor and URL.)

Then, in a Claude conversation with this MCP server connected, you can say things like:

- "Show me the current `Code.gs` in script `<scriptId>`"
- "Update the `sendAlertEmail` function in `Code.gs` to also CC the DSNO supervisor"
- "Push this new `Utils.gs` file with these helper functions: ..."
- "Create a new version called 'Add AFP EPID auto-compose logic'"

---

## Security notes

- `credentials.json` and `token.json` both grant access to Apps Script projects you can
  edit. Keep them out of version control (a `.gitignore` is included) and don't share them.
- The OAuth scopes requested (`script.projects`, `script.deployments`) do **not** include
  Gmail, Sheets, or Drive access beyond what's needed to read/write script project content
  and inspect deployments.
- To revoke access at any time: https://myaccount.google.com/permissions → find the OAuth
  client name you set in step 4 above → Remove Access. Delete `token.json` afterward.

## Troubleshooting

| Error | Fix |
|---|---|
| "Not authorized yet" | Run `npm run authorize` |
| 403 permission denied | Confirm the Apps Script API is enabled at script.google.com/home/usersettings for the account you authorized with |
| 404 script not found | Double-check the script ID; confirm the authorized account has at least edit access to that project |
| Browser doesn't open during authorize | Copy the printed URL manually into any browser |
