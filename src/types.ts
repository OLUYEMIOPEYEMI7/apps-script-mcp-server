export type AppsScriptFileType = "SERVER_JS" | "HTML" | "JSON";

export interface AppsScriptFile {
  name: string;
  type: AppsScriptFileType;
  source: string;
  lastModifyUser?: { name?: string; email?: string };
  createTime?: string;
  updateTime?: string;
}

export interface AppsScriptProjectContent {
  scriptId: string;
  files: AppsScriptFile[];
}

export interface AppsScriptVersion {
  scriptId: string;
  versionNumber: number;
  description?: string;
  createTime?: string;
  [key: string]: unknown;
}

export interface AppsScriptDeployment {
  deploymentId: string;
  versionNumber?: number;
  description?: string;
  updateTime?: string;
  entryPoints?: Array<{ entryPointType?: string | null; webApp?: { url?: string | null } | null }>;
}

export interface AppsScriptProjectMetadata {
  scriptId: string;
  title?: string;
  parentId?: string;
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}
