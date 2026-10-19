#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. The suite's
// slowest measured run on 2026-09-22 was 152 s on a seven platform search, so
// 1800 s is roughly twelve times that: headroom for a slow day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-agent-brokerage-resolver",
  version: pkg.version,
});

// Agent to Brokerage Resolver (immutable actor ID ePRRGLxOGyaVHO4dI). Every buyer facing input of the
// actor is exposed. The actor takes every input as a string, so the tool does too.
server.registerTool(
  "resolve_agent_brokerage",
  {
    title: "Resolve agent brokerage",
    description:
      "Look up a licensed US real estate agent on the official state license register and get the brokerage of record, the brokerage's active agent count and size band (1, 2-15, 16-50, 51+), and the agent's license status and expiry. Covers 19 states; brokerage data in CA, IA, MO, NV, NY, OH, OR, TX, and VT. Three modes: lookup (one agent or a list, by license number or by name), roster_firm (active agents at one brokerage), and roster_zip (brokerage offices in a zip code, NY, MO, OR, and VT). Returns no emails, phone numbers, or home addresses. Ambiguous or unmatched inputs return a free row with row_status explaining why. A run that does not succeed is returned as an error with its run ID. Read-only; requires an APIFY_TOKEN and consumes Apify credits per matched row.",
    annotations: {
      title: "Resolve agent brokerage",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      mode: z.enum(["lookup", "roster_firm", "roster_zip"])
        .optional()
        .describe("lookup finds one agent or a list. roster_firm lists the active agents at one brokerage. roster_zip lists brokerage offices in a zip code (NY, MO, OR, VT). Default lookup."),
      state: z.string()
        .optional()
        .describe("Two letter licensing state, for example TX. Used with license_number, agent_name, or the brokerage fields."),
      license_number: z.string()
        .optional()
        .describe("Lookup mode. The agent's license number as the state register prints it, for example 134224-SA. The most reliable lookup."),
      agent_name: z.string()
        .optional()
        .describe("Lookup mode, when there is no license number. First and last name. Add brokerage_name or city to narrow a common name."),
      brokerage_name: z.string()
        .optional()
        .describe("Lookup mode: narrows a name match. roster_firm mode: the brokerage to list, by its exact registered name."),
      city: z.string()
        .optional()
        .describe("Lookup mode: narrows a name match by the brokerage office city or the license county."),
      licenses: z.string()
        .optional()
        .describe("Lookup mode, many at once. One per line: state then license number, for example TX 0123456."),
      agents: z.string()
        .optional()
        .describe("Lookup mode, many at once. One per line: state | name | brokerage (optional) | city (optional)."),
      brokerage_license_number: z.string()
        .optional()
        .describe("roster_firm mode. The brokerage's license number."),
      zip: z.string()
        .optional()
        .describe("roster_zip mode. A five digit zip code."),
      zips: z.string()
        .optional()
        .describe("roster_zip mode, many at once. One zip code per line."),
      include_agents: z.enum(["true", "false"])
        .optional()
        .describe("roster_zip mode. true also lists the active agents at each office. Default false."),
      active_only: z.enum(["true", "false"])
        .optional()
        .describe("Roster modes. List only agents with an active license. Default true."),
      max_results: z.string()
        .optional()
        .describe("Roster modes. Most rows one brokerage or zip returns, 1 to 1000. Default 100."),
      max_charge_usd: z.string()
        .optional()
        .describe("Optional. The run stops before the row that would take its charges over this amount."),
    },
  },
  async (args) => runActor("ePRRGLxOGyaVHO4dI", "Agent to Brokerage Resolver", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
