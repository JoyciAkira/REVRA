#!/usr/bin/env node
// revra — CLI: setup | verify | mcp | connect | doctor
// Zero runtime dependencies. Node >= 18.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const require = createRequire(import.meta.url);
const PKG = path.dirname(require.resolve("../package.json"));
const ENGINE = path.join(PKG, "engine");
const PY = path.join(ENGINE, "revra_verify.py");
const CONFIG_DIR = path.join(os.homedir(), ".revra");
const CONFIG = path.join(CONFIG_DIR, "config.json");

const [cmd, ...args] = process.argv.slice(2);
const docker = () => spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0;
const readConfig = () => {
  try { return JSON.parse(readFileSync(CONFIG, "utf8")); } catch { return {}; }
};

function run(cmd, opts = {}) {
  const p = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", ...opts });
  return new Promise((res) => p.on("exit", res));
}

async function setup() {
  if (!docker()) { console.error("docker non disponibile — requisito #1."); process.exit(1); }
  console.log("[setup] 1/3 artifact engine (SHA-256 verificati)...");
  await run(["bash", path.join(ENGINE, "setup_assets.sh")]);
  console.log("[setup] 2/3 build revra-engine:0.1.0 (Ghidra + RetDec)...");
  await run(["docker", "build", "--platform", "linux/amd64", "-t", "revra-engine:0.1.0",
             "-f", path.join(ENGINE, "Dockerfile.engine"), ENGINE]);
  console.log("[setup] 3/3 build revra-judge:0.1.0 (giudice calibrato gcc-11)...");
  await run(["docker", "build", "--platform", "linux/amd64", "-t", "revra-judge:0.1.0",
             "-f", path.join(ENGINE, "Dockerfile.judge"), ENGINE]);
  if (!existsSync(CONFIG)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG, JSON.stringify({
      protocol: "anthropic",
      base_url: "https://api.anthropic.com",
      api_key_env: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-5",
    }, null, 2) + "\n");
  }
  console.log(`[setup] ✅ pronto. Config modello: ${CONFIG} (BYOM — ADR-0003)`);
  console.log("Prossimo passo: revra connect <claude|codex|cursor|opencode|generic>");
}

async function verify() {
  const get = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
  };
  const has = (name) => process.argv.includes(name);
  if (!docker()) { console.error("docker non disponibile."); process.exit(1); }
  const cfg = readConfig();
  const env = {
    ...process.env,
    REVRA_LLM_PROTOCOL: process.env.REVRA_LLM_PROTOCOL || cfg.protocol || "anthropic",
    REVRA_LLM_BASE_URL: process.env.REVRA_LLM_BASE_URL || cfg.base_url || "",
    REVRA_LLM_API_KEY: process.env.REVRA_LLM_API_KEY ||
      (cfg.api_key_env ? process.env[cfg.api_key_env] || "" : ""),
    REVRA_LLM_MODEL: process.env.REVRA_LLM_MODEL || cfg.model || "claude-sonnet-5",
  };
  const binary = get("--binary");
  const symbol = get("--symbol");
  if (!binary || !symbol) { console.error("servono --binary e --symbol"); process.exit(1); }
  const pyArgs = ["--binary", binary, "--symbol", symbol];
  if (has("--test")) pyArgs.push("--test", get("--test"));
  if (has("--language")) pyArgs.push("--language", get("--language"));
  if (has("--out")) pyArgs.push("--out", get("--out"));
  if (has("--repair")) pyArgs.push("--repair", "--rounds", String(Number(get("--rounds", "3"))));
  await run(["python3", PY, ...pyArgs], { env });
}


async function connect(client) {
  const nodeBin = process.execPath;
  const mcpCmd = [nodeBin, path.join(PKG, "bin", "revra.mjs"), "mcp"];
  const jsonEntry = { command: mcpCmd[0], args: mcpCmd.slice(1) };
  const home = os.homedir();
  if (client === "claude") {
    console.log("[connect] nota: per tool lunghi imposta MCP_TOOL_TIMEOUT=1800000 nell'ambiente di claude, oppure usa il CLI (revra verify).");
    if (!spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0) {
      console.error("claude CLI non trovato."); process.exit(1);
    }
    await run(["claude", "mcp", "add", "revra", "--", ...mcpCmd]);
  } else if (client === "codex") {
    const f = path.join(home, ".codex", "config.toml");
    mkdirSync(path.dirname(f), { recursive: true });
    if (!existsSync(f) || !readFileSync(f, "utf8").includes("[mcp_servers.revra]")) {
      appendFileSync(f, `\n[mcp_servers.revra]\ncommand = "${mcpCmd[0]}"\nargs = [${mcpCmd.slice(1).map((a) => JSON.stringify(a)).join(", ")}]\n`);
    }
    console.log(`[connect] codex configurato: ${f}`);
  } else if (client === "cursor" || client === "windsurf") {
    const f = client === "cursor"
      ? path.join(home, ".cursor", "mcp.json")
      : path.join(home, ".codeium", "windsurf", "mcp_config.json");
    mkdirSync(path.dirname(f), { recursive: true });
    let j = {}; try { j = JSON.parse(readFileSync(f, "utf8")); } catch {}
    j.mcpServers = j.mcpServers || {};
    j.mcpServers.revra = jsonEntry;
    writeFileSync(f, JSON.stringify(j, null, 2));
    console.log(`[connect] ${client} configurato: ${f}`);
  } else if (client === "opencode") {
    const f = path.join(home, ".config", "opencode", "opencode.json");
    mkdirSync(path.dirname(f), { recursive: true });
    let j = {}; try { j = JSON.parse(readFileSync(f, "utf8")); } catch {}
    j.mcp = j.mcp || {}; j.mcp.revra = { type: "local", command: [mcpCmd[0], ...mcpCmd.slice(1)] };
    writeFileSync(f, JSON.stringify(j, null, 2));
    console.log(`[connect] opencode configurato: ${f}`);
  } else {
    console.log("Config MCP generica:\n" + JSON.stringify({ mcpServers: { revra: jsonEntry } }, null, 2));
  }
}

async function doctor() {
  const checks = {
    docker: docker(),
    python3: spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0,
    engine_image: spawnSync("docker", ["image", "inspect", "revra-engine:0.1.0"], { stdio: "ignore" }).status === 0,
    judge_image: spawnSync("docker", ["image", "inspect", "revra-judge:0.1.0"], { stdio: "ignore" }).status === 0,
    model_config: existsSync(CONFIG) || !!process.env.REVRA_LLM_API_KEY || !!process.env.ANTHROPIC_API_KEY,
  };
  console.log(JSON.stringify(checks, null, 2));
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
}

const handlers = { setup, verify, mcp: () => run(["node", path.join(PKG, "mcp", "server.mjs")]), connect, doctor };
if (!cmd || !handlers[cmd]) {
  console.log(`Uso: revra <setup|verify|mcp|connect|doctor> [args]
  setup                     scarica artifact pinnati e costruisce le immagini docker
  verify --binary F --symbol S [--test T] [--repair] [--rounds N] [--out R]
  mcp                       avvia il server MCP (stdio)
  connect <client>          claude | codex | cursor | windsurf | opencode | generic
  doctor                    verifica ambiente`);
  process.exit(cmd ? 1 : 0);
}
await handlers[cmd](...args);
