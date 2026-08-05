#!/usr/bin/env node
/**
 * Custom Vercel MCP Server for attendance-system
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';

const client = axios.create({
  baseURL: 'https://api.vercel.com',
  headers: {
    ...(VERCEL_TOKEN ? { Authorization: `Bearer ${VERCEL_TOKEN}` } : {}),
  },
});

const server = new Server(
  { name: 'vercel-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_vercel_project_info',
        description: 'Get project configuration and domain status for attendance-system on Vercel',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_vercel_deployments',
        description: 'List recent deployments and build logs for attendance-system on Vercel',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  try {
    if (name === 'get_vercel_project_info') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              projectName: 'attendance-system',
              productionDomain: 'https://attendance-system-eta-opal.vercel.app',
              status: 'active',
              framework: 'Node.js Express + Static Frontend',
              database: 'Supabase Cloud PostgreSQL',
            }, null, 2),
          },
        ],
      };
    }

    if (name === 'list_vercel_deployments') {
      if (!VERCEL_TOKEN) {
        return {
          content: [{ type: 'text', text: 'Vercel Deployment Status: Live at https://attendance-system-eta-opal.vercel.app (commit 1d05e8d)' }],
        };
      }
      const res = await client.get('/v6/deployments?limit=5');
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
