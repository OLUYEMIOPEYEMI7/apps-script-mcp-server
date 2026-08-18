#!/usr/bin/env node
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppsScriptTools } from "./tools/apps-script-tools.js";
import { AUTH_TOKEN_ENV_VAR } from "./constants.js";

function buildServer(): McpServer {
  const server = new McpServer({
    name: "apps-script-mcp-server",
    version: "1.0.0",
  });
  registerAppsScriptTools(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("apps-script-mcp-server running on stdio");
}

async function runHttp(): Promise<void> {
  const requiredToken = process.env[AUTH_TOKEN_ENV_VAR];
  if (!requiredToken) {
    console.error(
      `Refusing to start HTTP transport: ${AUTH_TOKEN_ENV_VAR} is not set. ` +
        `Without a shared secret, anyone who finds this service's URL could push code into ` +
        `your Apps Script projects. Set ${AUTH_TOKEN_ENV_VAR} to a long random value and ` +
        `configure Claude to send it as 'Authorization: Bearer <value>'.`
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Unauthenticated health check for Render's health checks / uptime pings.
  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  app.post("/mcp", async (req, res) => {
    const authHeader = req.headers.authorization ?? "";
    const expected = `Bearer ${requiredToken}`;
    if (authHeader !== expected) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
        id: null,
      });
      return;
    }

    // Stateless: a fresh server + transport per request, as recommended for
    // streamable HTTP so concurrent requests never collide on request IDs.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`apps-script-mcp-server running on http://0.0.0.0:${port}/mcp`);
  });
}

const transportMode = process.env.TRANSPORT ?? "stdio";
const run = transportMode === "http" ? runHttp : runStdio;

run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
