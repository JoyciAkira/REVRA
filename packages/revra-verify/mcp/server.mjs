#!/usr/bin/env node
// MCP server (stdio, JSON-RPC 2.0, newline-delimited) — zero dependencies.
// Tools:
//   revra_verify — starts a verification job, returns a job id IMMEDIATELY
//                  (l'esecuzione dura minuti: pattern async, no timeout MCP)
//   revra_status — polling: running | done | failed, con risultato finale
//   revra_doctor — environment checks
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import fs from "node:fs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = path.join(PKG, "engine", "revra_verify.py");
const SERVER_INFO = { name: "revra-verify", version: "0.2.0" };

// ---- job registry (in-process; il CLI `revra verify` resta sincrono) ----
const JOBS = new Map();
let jobSeq = 0;

const TOOLS = [
  {
    name: "revra_verify",
    description: "Start multi-engine decompilation + verification of a function from an ELF binary (Ghidra + RetDec drafts, optional agentic repair with your model). Returns a job_id IMMEDIATELY — the job takes minutes (full Ghidra analysis on multi-MB binaries). Poll revra_status with the job_id until status=done. Lawful use required (owned binary, no output redistribution).",
    inputSchema: {
      type: "object",
      properties: {
        binary: { type: "string", description: "path to the ELF binary" },
        symbol: { type: "string", description: "function symbol to decompile" },
        test: { type: "string", description: "optional path to a C/C++ test harness defining main()" },
        link_lib: { type: "string", description: "optional original .so to resolve internal symbols at link/run time" },
        repair: { type: "boolean", description: "enable agentic repair (default true)" },
        rounds: { type: "integer", description: "max repair rounds (default 3)" },
      },
      required: ["binary", "symbol"],
    },
  },
  {
    name: "revra_status",
    description: "Poll a verification job. Returns status (running|done|failed), final compiles/passes when done, the evidence report path and its content summary.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "job id returned by revra_verify; omit to list all jobs" },
      },
    },
  },
  {
    name: "revra_doctor",
    description: "Check the local REVRA environment (docker, images, model config).",
    inputSchema: { type: "object", properties: {} },
  },
];

function doctorTool() {
  const checks = {
    docker: spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0,
    python3: spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0,
    engine_image: spawnSync("docker", ["image", "inspect", "revra-engine:0.1.0"], { stdio: "ignore" }).status === 0,
    judge_image: spawnSync("docker", ["image", "inspect", "revra-judge:0.1.0"], { stdio: "ignore" }).status === 0,
  };
  const ok = Object.values(checks).every(Boolean);
  return { text: JSON.stringify({ ok, checks, hint: ok ? undefined : "run: revra setup" }, null, 2) };
}

function startVerifyJob(args) {
  const { binary, symbol } = args || {};
  if (!binary || !symbol) throw new Error("binary and symbol are required");
  if (!fs.existsSync(binary)) throw new Error(`binary not found: ${binary}`);
  const job_id = `revra_${Date.now().toString(36)}_${++jobSeq}`;
  const out = args.out || `revra-evidence-report-${job_id}.md`;
  const jsonOut = path.join(path.dirname(path.resolve(out)), `${job_id}.result.json`);
  const pyArgs = [PY, "--binary", binary, "--symbol", symbol, "--out", out,
                  "--json", jsonOut, "--repair", "--rounds", String(args.rounds || 3)];
  if (args.test) pyArgs.push("--test", args.test);
  if (args.link_lib) pyArgs.push("--link-lib", args.link_lib);
  const child = spawn("python3", pyArgs, { stdio: ["ignore", "ignore", "pipe"] });
  let stderrTail = "";
  child.stderr.on("data", (d) => { stderrTail = (stderrTail + d).slice(-2000); });
  const job = {
    job_id, status: "running", started: new Date().toISOString(),
    binary, symbol, report: path.resolve(out), result_json: jsonOut,
    pid: child.pid, stderrTail: () => stderrTail,
  };
  child.on("exit", (code) => {
    job.status = code === 0 ? "done" : "failed";
    job.exit_code = code;
    job.finished = new Date().toISOString();
    try {
      const r = JSON.parse(fs.readFileSync(job.result_json, "utf8"));
      job.compiles = r.compiles; job.passes = r.passes; job.final_head = (r.final || "").slice(0, 1500);
    } catch {}
  });
  JOBS.set(job_id, job);
  return { job_id, status: job.status, poll: "revra_status", note: "la verifica completa richiede minuti (analisi Ghidra su binario intero)" };
}

function statusTool(args) {
  const id = args?.job_id;
  if (!id) {
    return { text: JSON.stringify(Object.fromEntries(
      [...JOBS.values()].map((j) => [j.job_id, { status: j.status, symbol: j.symbol, compiles: j.compiles, passes: j.passes }])), null, 2) };
  }
  const j = JOBS.get(id);
  if (!j) throw new Error(`job sconosciuto: ${id}`);
  const r = {
    job_id: id, status: j.status, symbol: j.symbol, binary: j.binary,
    compiles: j.compiles, passes: j.passes, report: j.report,
  };
  if (j.status === "done" && j.final_head !== undefined) r.final_head = j.final_head;
  if (j.stderrTail && j.status === "failed") r.stderr_tail = j.stderrTail();
  return { text: JSON.stringify(r, null, 2) };
}

function handleToolCall(name, args) {
  if (name === "revra_verify") {
    const job = startVerifyJob(args);
    return { text: JSON.stringify(job, null, 2) };
  }
  if (name === "revra_status") return statusTool(args);
  if (name === "revra_doctor") return doctorTool();
  throw new Error(`unknown tool: ${name}`);
}

function respond(msg, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // notification
  try {
    if (msg.method === "initialize") {
      respond(msg, {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    } else if (msg.method === "tools/list") {
      respond(msg, { tools: TOOLS });
    } else if (msg.method === "tools/call") {
      const { name, arguments: toolArgs } = msg.params || {};
      try {
        const content = handleToolCall(name, toolArgs);
        respond(msg, { content: [{ type: "text", text: content.text }], isError: false });
      } catch (e) {
        respond(msg, { content: [{ type: "text", text: String(e.message || e) }], isError: true });
      }
    } else if (msg.method === "ping") {
      respond(msg, {});
    } else {
      respond(msg, {});
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id,
      error: { code: -32603, message: String(e.message || e) } }) + "\n");
  }
});
