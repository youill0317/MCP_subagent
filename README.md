# MCP Subagent Server

Multi-agent orchestration MCP server.

This server delegates tasks to configured agents and internally connects to:
- `mcp_search`
- `mcp_obsidian`
- `mcp_skills`

via `mcp-servers.json`.

## Install and Build

```bash
npm install
npm run build
```

## Run

```bash
npm start
```

## Client Configuration (Claude Code)

Add this server entry to Claude Code client JSON (`mcpServers`):

```json
{
  "mcpServers": {
    "mcp_subagent": {
      "command": "node",
      "args": [
        "C:/path/to/MCP/MCP_subagent/dist/index.js"
      ],
      "env": {
        "DEFAULT_PROVIDER": "anthropic",
        "DEFAULT_MODEL": "claude-sonnet-4-20250514",
        "ANTHROPIC_API_KEY": "your-anthropic-key",
        "MARKDOWN_BASE_DIR": "C:/path/to/your/ObsidianVault",
        "BRAVE_API_KEY": "your-brave-key",
        "TAVILY_API_KEY": "your-tavily-key",
        "EXA_API_KEY": "your-exa-key",
        "SEMANTIC_SCHOLAR_API_KEY": ""
      }
    }
  }
}
```

Notes:
- `.env` is not auto-loaded. Runtime values must come from `process.env` (for Claude Code, this means `mcpServers.<name>.env`).
- `mcp-servers.json` must use concrete paths (no `${VAR}` placeholders, no per-server `env` block).
- Choose one provider and set matching credentials:
  - `DEFAULT_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
  - `DEFAULT_PROVIDER=openai` + `OPENAI_API_KEY`
  - `DEFAULT_PROVIDER=google` + `GOOGLE_API_KEY`
  - `DEFAULT_PROVIDER=custom` + `CUSTOM_API_KEY` (+ optional `CUSTOM_BASE_URL`)
