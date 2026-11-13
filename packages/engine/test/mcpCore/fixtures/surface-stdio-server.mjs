import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const RESOURCE_PAGES = {
  '': {
    resources: [
      {
        uri: 'fixture://alpha',
        name: 'alpha',
        description: 'First page resource',
        mimeType: 'text/plain',
      },
      {
        uri: 'fixture://beta',
        name: 'beta',
        description: 'Also on the first page',
        mimeType: 'text/plain',
      },
    ],
    nextCursor: 'page-2',
  },
  'page-2': {
    resources: [{ uri: 'fixture://huge', name: 'huge', mimeType: 'text/plain' }],
  },
};

const server = new Server(
  { name: 'mock-surface-stdio', version: '0.0.1' },
  { capabilities: { resources: {}, prompts: {} } },
);

server.setRequestHandler(ListResourcesRequestSchema, (request) => {
  const page = RESOURCE_PAGES[request.params?.cursor ?? ''];
  if (page === undefined) {
    return {
      isError: true,
      content: [{ type: 'text', text: `unknown cursor: ${String(request.params?.cursor)}` }],
    };
  }
  return page;
});

server.setRequestHandler(ReadResourceRequestSchema, (request) => {
  const uri = request.params?.uri ?? '';
  if (uri === 'fixture://binary') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/octet-stream',
          blob: Buffer.from([0, 1, 2, 3]).toString('base64'),
        },
      ],
    };
  }
  if (uri === 'fixture://huge') {
    return { contents: [{ uri, mimeType: 'text/plain', text: 'x'.repeat(500) }] };
  }
  return { contents: [{ uri, mimeType: 'text/plain', text: `body of ${uri}` }] };
});

server.setRequestHandler(ListPromptsRequestSchema, () => ({
  prompts: [
    {
      name: 'greet',
      description: 'Greets someone',
      arguments: [{ name: 'who', description: 'Who to greet', required: true }],
    },
    { name: 'bare', description: 'Takes no arguments' },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, (request) => ({
  messages: [
    {
      role: 'user',
      content: { type: 'text', text: `Hello ${request.params?.arguments?.who ?? 'world'}` },
    },
    { role: 'assistant', content: { type: 'image', data: 'aGk=', mimeType: 'image/png' } },
  ],
}));

await server.connect(new StdioServerTransport());
