# Agent to Brokerage Resolver MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-agent-brokerage-resolver)](https://smithery.ai/servers/mambabuilt/mcp-agent-brokerage-resolver) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-agent-brokerage-resolver/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-agent-brokerage-resolver) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-agent-brokerage-resolver%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-agent-brokerage-resolver&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-agent-brokerage-resolver)](https://www.npmjs.com/package/@mambalabsdev/mcp-agent-brokerage-resolver) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-agent-brokerage-resolver)](https://www.npmjs.com/package/@mambalabsdev/mcp-agent-brokerage-resolver) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-agent-brokerage-resolver)](https://github.com/mambalabsdev/mcp-agent-brokerage-resolver/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-agent-brokerage-resolver)

An MCP server for the Mamba Labs Agent to Brokerage Resolver actor on Apify. Give it a licensed US real estate agent, by license number or by name and state, and get the brokerage of record from the official state license register, that brokerage's active agent count and size band, and the agent's license status and expiry. It can also list every active agent at a brokerage, or every brokerage office in a zip code.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool](#tool)
- [Inputs](#inputs)
- [Pricing](#pricing)
- [Your keys](#your-keys)
- [Full actor documentation](#full-actor-documentation)
- [License](#license)

## What it does

Look up a licensed US real estate agent on the official state license register and get the brokerage of record, the brokerage's active agent count and size band (1, 2-15, 16-50, 51+), and the agent's license status and expiry. Covers 19 states; brokerage data in CA, IA, MO, NV, NY, OH, OR, TX, and VT. Three modes: lookup (one agent or a list, by license number or by name), roster_firm (active agents at one brokerage), and roster_zip (brokerage offices in a zip code, NY, MO, OR, and VT). Returns no emails, phone numbers, or home addresses. Ambiguous or unmatched inputs return a free row with row_status explaining why. A run that does not succeed is returned as an error with its run ID.

All of the work runs on Apify. This package is a thin client that starts the actor run, waits for it, and hands back the dataset rows.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config (`claude_desktop_config.json`), Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "mamba-agent-brokerage-resolver": {
      "command": "npx",
      "args": [
        "-y",
        "@mambalabsdev/mcp-agent-brokerage-resolver"
      ],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Restart the client. The `resolve_agent_brokerage` tool appears.

## Prerequisites

- Node.js 18 or newer.
- An Apify API token from [console.apify.com/account/integrations](https://console.apify.com/account/integrations), set as `APIFY_TOKEN`. The server lists its tool without a token; a call needs one.

## Example prompts

- "Which brokerage is Texas agent 134224-SA with, and how big is it?"
- "List the active agents at the brokerage with Texas license 566433-BB."
- "Which real estate brokerages have an office in zip 14201, and how many agents does each have?"

## Tool

`resolve_agent_brokerage`. One tool. Example arguments:

```json
{ "mode": "lookup", "state": "TX", "license_number": "134224-SA" }
```

## Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `mode` | string | no | lookup, roster_firm, or roster_zip. Default lookup. |
| `state` | string | no | Two letter licensing state, for example TX. |
| `license_number` | string | no | Lookup mode. The agent's license number as the register prints it. |
| `agent_name` | string | no | Lookup mode, when there is no license number. First and last name. |
| `brokerage_name` | string | no | Narrows a name match; names the firm in roster_firm mode. |
| `city` | string | no | Narrows a name match by office city or license county. |
| `licenses` | string | no | Lookup batch, one per line: state then license number. |
| `agents` | string | no | Lookup batch, one per line: state, name, brokerage, city, separated by a vertical bar. |
| `brokerage_license_number` | string | no | roster_firm mode. The brokerage's license number. |
| `zip` | string | no | roster_zip mode. A five digit zip code. |
| `zips` | string | no | roster_zip batch, one zip per line. |
| `include_agents` | string | no | roster_zip mode. true also lists each office's active agents. |
| `active_only` | string | no | Roster modes. Active licenses only. Default true. |
| `max_results` | string | no | Roster modes. Rows per brokerage or zip, 1 to 1000. Default 100. |
| `max_charge_usd` | string | no | Optional. The run stops before the row that would take its charges over this amount. |

## Pricing

Pay per event on Apify, billed to your Apify account. Prices in USD. Proposed launch prices, not yet live.

| Event | Free plan | Bronze | Silver | Gold |
|---|---|---|---|---|
| `agent-resolved`, per matched lookup row | $0.005 | $0.00475 | $0.0045 | $0.00425 |
| `roster-row`, per roster row | $0.002 | $0.0019 | $0.0018 | $0.0017 |
| `apify-actor-start`, per run start | $0.0005 | $0.000475 | $0.00045 | $0.000425 |

Ambiguous, not found, unsupported state, and capped rows are never charged.

## Your keys

The actor needs no provider key. It reads MMG's own index of the state license registers through a private service and holds no key of its own.

## Full actor documentation

[apify.com/mambalabs/agent-brokerage-resolver](https://apify.com/mambalabs/agent-brokerage-resolver)

## License

MIT. See [LICENSE](LICENSE).
