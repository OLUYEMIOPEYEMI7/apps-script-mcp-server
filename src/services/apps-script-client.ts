import { google, script_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { loadSavedCredentialsIfExist } from "../auth.js";
import type {
  AppsScriptDeployment,
  AppsScriptFile,
  AppsScriptProjectContent,
  AppsScriptProjectMetadata,
  AppsScriptVersion,
} from "../types.js";

let cachedClient: OAuth2Client | null = null;

/**
 * Returns an authorized OAuth2Client, loading the cached token from disk.
 * Throws an actionable error if `npm run authorize` hasn't been run yet.
 */
async function getAuthorizedClient(): Promise<OAuth2Client> {
  if (cachedClient) return cachedClient;
  const client = await loadSavedCredentialsIfExist();
  if (!client) {
    throw new Error(
      "Not authorized yet. Locally: run `npm run authorize`, complete the Google sign-in, " +
        "then restart this server. On a hosted deployment (e.g. Render): set the " +
        "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN " +
        "environment variables (generate the refresh token locally first via `npm run authorize`, " +
        "then copy the values out of the generated token.json)."
    );
  }
  cachedClient = client;
  return client;
}

async function getScriptApi(): Promise<script_v1.Script> {
  const auth = await getAuthorizedClient();
  return google.script({ version: "v1", auth });
}

/** Maps common Apps Script API error shapes to actionable messages. */
function explainError(err: unknown, scriptId: string): Error {
  const anyErr = err as { code?: number; message?: string; errors?: unknown };
  const status = anyErr?.code;
  const message = anyErr?.message ?? String(err);

  if (status === 404) {
    return new Error(
      `Script project '${scriptId}' was not found, or this account doesn't have access to it. ` +
        `Double-check the script ID (from the URL: script.google.com/.../d/<scriptId>/edit) and ` +
        `that you authorized with the Google account that owns or has access to this project.`
    );
  }
  if (status === 403) {
    return new Error(
      `Permission denied for script '${scriptId}'. Likely causes: (1) the Apps Script API is not ` +
        `enabled at https://script.google.com/home/usersettings for this Google account, or ` +
        `(2) this account only has viewer access to the script. Original error: ${message}`
    );
  }
  if (status === 400) {
    return new Error(`Apps Script API rejected the request: ${message}`);
  }
  return new Error(`Apps Script API error for '${scriptId}': ${message}`);
}

/** Reads all files (.gs/.html/appsscript.json) currently in a script project. */
export async function getProjectContent(scriptId: string): Promise<AppsScriptProjectContent> {
  const api = await getScriptApi();
  try {
    const res = await api.projects.getContent({ scriptId });
    const files: AppsScriptFile[] = (res.data.files ?? []).map((f) => ({
      name: f.name ?? "",
      type: (f.type as AppsScriptFile["type"]) ?? "SERVER_JS",
      source: f.source ?? "",
      lastModifyUser: f.lastModifyUser
        ? { name: f.lastModifyUser.name ?? undefined, email: f.lastModifyUser.email ?? undefined }
        : undefined,
      createTime: f.createTime ?? undefined,
      updateTime: f.updateTime ?? undefined,
    }));
    return { scriptId, files };
  } catch (err) {
    throw explainError(err, scriptId);
  }
}

/**
 * Overwrites the full file set of a script project. The Apps Script API's
 * updateContent call replaces ALL files in one call — there is no partial
 * patch endpoint — so callers should fetch current content first with
 * getProjectContent, edit/add the files they need, and pass the complete set.
 */
export async function updateProjectContent(
  scriptId: string,
  files: AppsScriptFile[]
): Promise<AppsScriptProjectContent> {
  const api = await getScriptApi();
  try {
    const res = await api.projects.updateContent({
      scriptId,
      requestBody: {
        scriptId,
        files: files.map((f) => ({ name: f.name, type: f.type, source: f.source })),
      },
    });
    const updated: AppsScriptFile[] = (res.data.files ?? []).map((f) => ({
      name: f.name ?? "",
      type: (f.type as AppsScriptFile["type"]) ?? "SERVER_JS",
      source: f.source ?? "",
      updateTime: f.updateTime ?? undefined,
    }));
    return { scriptId, files: updated };
  } catch (err) {
    throw explainError(err, scriptId);
  }
}

export async function getProjectMetadata(scriptId: string): Promise<AppsScriptProjectMetadata> {
  const api = await getScriptApi();
  try {
    const res = await api.projects.get({ scriptId });
    return {
      scriptId,
      title: res.data.title ?? undefined,
      parentId: res.data.parentId ?? undefined,
      createTime: res.data.createTime ?? undefined,
      updateTime: res.data.updateTime ?? undefined,
    };
  } catch (err) {
    throw explainError(err, scriptId);
  }
}

export async function createVersion(
  scriptId: string,
  description: string
): Promise<AppsScriptVersion> {
  const api = await getScriptApi();
  try {
    const res = await api.projects.versions.create({
      scriptId,
      requestBody: { description },
    });
    return {
      scriptId,
      versionNumber: res.data.versionNumber ?? 0,
      description: res.data.description ?? undefined,
      createTime: res.data.createTime ?? undefined,
    };
  } catch (err) {
    throw explainError(err, scriptId);
  }
}

export async function listVersions(scriptId: string): Promise<AppsScriptVersion[]> {
  const api = await getScriptApi();
  try {
    const res = await api.projects.versions.list({ scriptId, pageSize: 50 });
    return (res.data.versions ?? []).map((v) => ({
      scriptId,
      versionNumber: v.versionNumber ?? 0,
      description: v.description ?? undefined,
      createTime: v.createTime ?? undefined,
    }));
  } catch (err) {
    throw explainError(err, scriptId);
  }
}

export async function listDeployments(scriptId: string): Promise<AppsScriptDeployment[]> {
  const api = await getScriptApi();
  try {
    const res = await api.projects.deployments.list({ scriptId });
    return (res.data.deployments ?? []).map((d) => ({
      deploymentId: d.deploymentId ?? "",
      versionNumber: d.deploymentConfig?.versionNumber ?? undefined,
      description: d.deploymentConfig?.description ?? undefined,
      updateTime: d.updateTime ?? undefined,
      entryPoints: d.entryPoints?.map((ep) => ({
        entryPointType: ep.entryPointType ?? null,
        webApp: ep.webApp ? { url: ep.webApp.url ?? null } : null,
      })),
    }));
  } catch (err) {
    throw explainError(err, scriptId);
  }
}
