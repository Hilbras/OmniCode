import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'mock-list-changed', version: '0.0.1' });

server.registerTool(
  'trigger',
  {
    description: 'Registers a second tool and announces the change',
    inputSchema: {},
  },
  async () => {
    server.registerTool(
      'late',
      {
        description: 'Registered after the client connected',
        inputSchema: {},
      },
      () => ({ content: [{ type: 'text', text: 'late' }] }),
    );
    server.sendToolListChanged();
    return { content: [{ type: 'text', text: 'done' }] };
  },
);

await server.connect(new StdioServerTransport());
