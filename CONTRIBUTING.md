# Contributing to Guesty MCP Server

Thank you for your interest in contributing! This is the first MCP server for property management, and community contributions help make it better for everyone.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/cohoststr-mcp.git`
3. Install dependencies: `npm install`
4. Create a `.env` file with your Guesty API credentials (see `.env.example`)
5. Run the server: `npm start`

## Adding New Tools

Each tool wraps a Guesty API endpoint. To add a new tool:

1. Identify the Guesty API endpoint from [Guesty Open API docs](https://open-api.guesty.com/api-docs)
2. Add the tool in `src/server.js` using the `server.tool()` pattern
3. Follow the existing naming convention: `verb_noun` (e.g., `get_reservations`, `update_pricing`)
4. Include proper Zod schema validation for all parameters
5. Return structured JSON in the response

### Tool Template

```javascript
server.tool(
  "tool_name",
  "Clear description of what this tool does",
  {
    param1: z.string().describe("What this parameter does"),
    param2: z.number().optional().describe("Optional parameter"),
  },
  async (params) => {
    const data = await guestyGet("/endpoint", { key: params.param1 });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);
```

## Desired Contributions

We'd love help with:
- **New tools**: Reviews management, task/cleaning scheduling, owner statements, channel management
- **Testing**: Integration tests, error handling edge cases
- **Documentation**: Usage examples, video tutorials, blog posts
- **PMS integrations**: Adapting this pattern for Hostaway, Lodgify, OwnerRez, etc.

## Code Style

- ES modules (import/export)
- Async/await for all API calls
- Descriptive error messages
- Keep tools focused -- one API action per tool

## Pull Requests

1. Create a feature branch: `git checkout -b feature/new-tool`
2. Make your changes
3. Test against the Guesty API
4. Submit a PR with a clear description of what the tool does and why

## Questions?

Open an issue on GitHub.
