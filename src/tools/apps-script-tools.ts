import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createVersion,
  getProjectContent,
  getProjectMetadata,
  listDeployments,
  listVersions,
  updateProjectContent,
} from "../services/apps-script-client.js";
import type { AppsScriptFile, AppsScriptFileType } from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";

const FileTypeEnum = z.enum(["SERVER_JS", "HTML", "JSON"]);

const ScriptIdSchema = z
  .string()
  .min(20, "Script IDs are long alphanumeric strings copied from the Apps Script editor URL.")
  .describe(
    "The Apps Script project ID, found in the editor URL: " +
      "https://script.google.com/.../d/<scriptId>/edit"
  );

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[...truncated, ${text.length - CHARACTER_LIMIT} more characters. Use file_name to fetch a single file instead.]`
  );
}

export function registerAppsScriptTools(server: McpServer): void {
  // ---------------------------------------------------------------------
  // Read tools
  // ---------------------------------------------------------------------

  server.registerTool(
    "apps_script_get_project_info",
    {
      title: "Get Apps Script Project Info",
      description: `Get metadata for an Apps Script project: title, parent (bound spreadsheet/doc, if any), and timestamps.

Args:
  - script_id (string): The Apps Script project ID from the editor URL.

Returns JSON: { scriptId, title, parentId, createTime, updateTime }

Use when: confirming you're pointed at the right script project before pushing code.
Don't use when: you need the actual file contents (use apps_script_get_content instead).`,
      inputSchema: { script_id: ScriptIdSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ script_id }: { script_id: string }) => {
      try {
        const meta = await getProjectMetadata(script_id);
        return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }], structuredContent: meta };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "apps_script_get_content",
    {
      title: "Get Apps Script Project Content",
      description: `Read every file (.gs, .html, appsscript.json) currently in an Apps Script project.

Args:
  - script_id (string): The Apps Script project ID from the editor URL.
  - file_name (string, optional): If given, only that file's source is returned (matches the
    file name without extension, e.g. "Code" for Code.gs). Use this for large projects to
    avoid pulling every file at once.

Returns JSON: { scriptId, files: [{ name, type, source, updateTime }] }

Use when: you need to see current code before editing it, or to confirm a push landed.
Don't use when: you already have the file list and just want to overwrite one file — go
straight to apps_script_update_file.`,
      inputSchema: {
        script_id: ScriptIdSchema,
        file_name: z.string().optional().describe("Optional: return only this file's source."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ script_id, file_name }: { script_id: string; file_name?: string }) => {
      try {
        const content = await getProjectContent(script_id);
        const files = file_name
          ? content.files.filter((f) => f.name === file_name)
          : content.files;

        if (file_name && files.length === 0) {
          const available = content.files.map((f) => f.name).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `No file named '${file_name}' in this project. Available files: ${available}`,
              },
            ],
            isError: true,
          };
        }

        const output = { scriptId: script_id, files };
        return {
          content: [{ type: "text", text: truncate(JSON.stringify(output, null, 2)) }],
          structuredContent: output,
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "apps_script_list_versions",
    {
      title: "List Apps Script Versions",
      description: `List saved versions (snapshots) of an Apps Script project, newest activity first.

Args:
  - script_id (string): The Apps Script project ID.

Returns JSON: { versions: [{ versionNumber, description, createTime }] }

Use when: checking version history before deciding whether to create a new version.`,
      inputSchema: { script_id: ScriptIdSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ script_id }: { script_id: string }) => {
      try {
        const versions = await listVersions(script_id);
        const output = { scriptId: script_id, versions };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "apps_script_list_deployments",
    {
      title: "List Apps Script Deployments",
      description: `List deployments (e.g. web app / API executable deployments) for an Apps Script project.

Args:
  - script_id (string): The Apps Script project ID.

Returns JSON: { deployments: [{ deploymentId, versionNumber, description, entryPoints }] }

Use when: you need a deployed web app URL, or need to confirm which version is live.
Note: pushing new code with apps_script_update_file does NOT update existing deployments —
deployments are pinned to a version. Create a new version and redeploy in the Apps Script
editor (or via the Apps Script API's deployments.update, not exposed by this server) to
push changes live.`,
      inputSchema: { script_id: ScriptIdSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ script_id }: { script_id: string }) => {
      try {
        const deployments = await listDeployments(script_id);
        const output = { scriptId: script_id, deployments };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------
  // Write tools
  // ---------------------------------------------------------------------

  server.registerTool(
    "apps_script_update_file",
    {
      title: "Push One File's Code to Apps Script",
      description: `Push (create or overwrite) a single .gs, .html, or appsscript.json file's source
code in an Apps Script project. This is the main tool for "post this code into Apps Script."

Internally this fetches the project's current file set, replaces (or adds) the one named
file, and calls the Apps Script API's updateContent — because that API only supports
replacing the full file set in one call, never a partial patch. Every other existing file
is preserved unchanged.

Args:
  - script_id (string): The Apps Script project ID.
  - file_name (string): File name WITHOUT extension (e.g. "Code" for Code.gs, "Index" for
    Index.html). Apps Script derives the extension from file_type.
  - source (string): The full file contents to write. This replaces the entire file — it is
    not a diff or patch.
  - file_type ('SERVER_JS' | 'HTML' | 'JSON', default 'SERVER_JS'): SERVER_JS for .gs files,
    HTML for .html files, JSON only for the appsscript.json manifest.

Returns JSON: { scriptId, updatedFile: { name, type, updateTime }, totalFiles }

Use when: "add this function to Code.gs", "update the doGet function", "create a new .gs
file called Utils with this code".
Don't use when: you need to change several files atomically — use apps_script_update_content
with the full file array instead, to avoid multiple round-trips each overwriting the others'
view of "current state".

Error Handling:
  - Returns an error if the account isn't authorized yet (run `npm run authorize` first).
  - Returns an error naming the script_id if the project isn't found or isn't accessible.`,
      inputSchema: {
        script_id: ScriptIdSchema,
        file_name: z.string().min(1).describe("File name without extension, e.g. 'Code'."),
        source: z.string().describe("Full source code for the file (replaces existing content)."),
        file_type: FileTypeEnum.default("SERVER_JS").describe(
          "SERVER_JS for .gs files, HTML for .html files, JSON only for appsscript.json."
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({
      script_id,
      file_name,
      source,
      file_type,
    }: {
      script_id: string;
      file_name: string;
      source: string;
      file_type: AppsScriptFileType;
    }) => {
      try {
        const current = await getProjectContent(script_id);
        const nextFiles: AppsScriptFile[] = [...current.files];
        const idx = nextFiles.findIndex((f) => f.name === file_name);
        const entry: AppsScriptFile = { name: file_name, type: file_type, source };
        if (idx >= 0) {
          nextFiles[idx] = entry;
        } else {
          nextFiles.push(entry);
        }

        const result = await updateProjectContent(script_id, nextFiles);
        const updatedFile = result.files.find((f) => f.name === file_name);
        const output = {
          scriptId: script_id,
          updatedFile: updatedFile
            ? { name: updatedFile.name, type: updatedFile.type, updateTime: updatedFile.updateTime }
            : null,
          totalFiles: result.files.length,
        };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "apps_script_update_content",
    {
      title: "Replace Full Apps Script File Set",
      description: `Overwrite the ENTIRE file set of an Apps Script project in one atomic call. Any
existing file not included in 'files' is effectively removed from the project (this mirrors
the underlying Apps Script API behavior — it always replaces the complete set, never patches).

Args:
  - script_id (string): The Apps Script project ID.
  - files (array): Every file the project should contain after this call. Each item:
      - name (string): file name without extension
      - type ('SERVER_JS' | 'HTML' | 'JSON')
      - source (string): full file contents

Returns JSON: { scriptId, files: [{ name, type, updateTime }] }

Use when: restructuring a project, renaming/removing files, or pushing several files that
must land together.
Don't use when: you're changing just one file — call apps_script_get_content first to see
what would be dropped, or use apps_script_update_file which preserves other files for you.

Error Handling:
  - If 'files' omits an existing file the caller wanted to keep, that file is deleted from
    the project. Always fetch current content first with apps_script_get_content if unsure.`,
      inputSchema: {
        script_id: ScriptIdSchema,
        files: z
          .array(
            z.object({
              name: z.string().min(1),
              type: FileTypeEnum,
              source: z.string(),
            })
          )
          .min(1)
          .describe("Complete file set the project should contain after this call."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ script_id, files }: { script_id: string; files: AppsScriptFile[] }) => {
      try {
        const result = await updateProjectContent(script_id, files);
        const output = {
          scriptId: script_id,
          files: result.files.map((f) => ({ name: f.name, type: f.type, updateTime: f.updateTime })),
        };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "apps_script_create_version",
    {
      title: "Create Apps Script Version",
      description: `Save a new version (immutable snapshot) of the current project content. Versions
are what deployments point to — pushing files with apps_script_update_file/update_content
changes the editable "HEAD" but does not affect anything already deployed until a new
version is created and a deployment is pointed at it.

Args:
  - script_id (string): The Apps Script project ID.
  - description (string): Short human-readable note for this version, e.g. "Add AFP EPID
    auto-compose logic".

Returns JSON: { scriptId, versionNumber, description, createTime }

Use when: you've finished pushing file changes and want a durable checkpoint or are about
to redeploy.
Don't use when: you're still iterating on file content — creating a version per small edit
clutters the version history; batch related changes first.`,
      inputSchema: {
        script_id: ScriptIdSchema,
        description: z.string().min(1).max(500).describe("Short description of this version's changes."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ script_id, description }: { script_id: string; description: string }) => {
      try {
        const version = await createVersion(script_id, description);
        return { content: [{ type: "text", text: JSON.stringify(version, null, 2) }], structuredContent: version };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
