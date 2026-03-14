import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DetectionEvidence } from "../../../domain/src/index.js";

interface WorkspaceCandidate {
  path: string;
  source: string;
}

export interface OpenClawConfigAnalysis {
  customConfig: boolean;
  explicitAgentIds: string[];
  defaultImplicitAgent: boolean;
  workspaceCandidates: WorkspaceCandidate[];
  hasModelsSignal: boolean;
  hasToolsSignal: boolean;
  hasMemorySignal: boolean;
  hasPluginsSignal: boolean;
  hasChannelsSignal: boolean;
}

export interface OpenClawStateProbe {
  stateDir?: string;
  configPath?: string;
  configFound: boolean;
  customConfig?: boolean;
  agentCount?: number;
  defaultImplicitAgent?: boolean;
  agentIds: string[];
  workspaceDirs: string[];
  workspaceSources: string[];
  managedSkillsDir?: string;
  extensionsDir?: string;
  credentialsDir?: string;
  sessionsRoots: string[];
  analysis?: OpenClawConfigAnalysis;
  warnings: string[];
  evidence: DetectionEvidence[];
}

const LEGACY_STATE_DIRS = [".clawdbot", ".moldbot", ".moltbot"] as const;
const WORKSPACE_DISCOVERY_KEYS = [
  "workspace",
  "workspaces",
  "workspaceDir",
  "workspaceDirs",
  "workspacePath",
  "workspacePaths"
] as const;

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(targetPath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function stripComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function parseQuotedAgentIds(configText: string) {
  const ids = new Set<string>();
  const patterns = [/"id"\s*:\s*"([^"]+)"/g, /'id'\s*:\s*'([^']+)'/g];

  for (const pattern of patterns) {
    for (const match of configText.matchAll(pattern)) {
      const id = match[1]?.trim().toLowerCase();
      if (id) {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

function hasSignal(configText: string, signal: string) {
  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(["']?${escaped}["']?\\s*:)`, "i");
  return pattern.test(configText);
}

function toWorkspaceCandidates(
  value: unknown,
  source: string,
  output: WorkspaceCandidate[]
): void {
  if (typeof value === "string" && value.trim()) {
    output.push({
      path: value.trim(),
      source
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => toWorkspaceCandidates(item, `${source}[${index}]`, output));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (key === "path" || key === "dir" || key === "root") {
      toWorkspaceCandidates(nested, `${source}.${key}`, output);
    }
  }
}

function collectWorkspaceCandidates(value: unknown, currentPath = "$", output: WorkspaceCandidate[] = []) {
  if (!value || typeof value !== "object") {
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectWorkspaceCandidates(item, `${currentPath}[${index}]`, output));
    return output;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    const nextPath = currentPath === "$" ? key : `${currentPath}.${key}`;
    if (WORKSPACE_DISCOVERY_KEYS.includes(key as (typeof WORKSPACE_DISCOVERY_KEYS)[number])) {
      toWorkspaceCandidates(nested, nextPath, output);
    }

    collectWorkspaceCandidates(nested, nextPath, output);
  }

  return output;
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function analyzeConfigText(configText: string): OpenClawConfigAnalysis {
  const cleaned = stripComments(configText);
  const explicitAgentIds = parseQuotedAgentIds(cleaned);
  const workspaceCandidates = collectWorkspaceCandidates(tryParseJson(cleaned));
  const hasModelsSignal = hasSignal(cleaned, "models");
  const hasToolsSignal = hasSignal(cleaned, "tools");
  const hasMemorySignal = hasSignal(cleaned, "memory");
  const hasPluginsSignal = hasSignal(cleaned, "plugins");
  const hasChannelsSignal = hasSignal(cleaned, "channels");
  const customConfig =
    explicitAgentIds.length > 0 ||
    hasSignal(cleaned, "bindings") ||
    hasChannelsSignal ||
    hasModelsSignal ||
    hasSignal(cleaned, "skills") ||
    hasPluginsSignal ||
    hasToolsSignal ||
    hasMemorySignal ||
    hasSignal(cleaned, "wizard");

  return {
    customConfig,
    explicitAgentIds,
    defaultImplicitAgent: explicitAgentIds.length === 0,
    workspaceCandidates,
    hasModelsSignal,
    hasToolsSignal,
    hasMemorySignal,
    hasPluginsSignal,
    hasChannelsSignal
  };
}

async function countAgentDirectories(stateDir: string) {
  const agentsRoot = path.join(stateDir, "agents");
  if (!(await pathExists(agentsRoot))) {
    return [];
  }

  const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function resolveWorkspaceCandidate(candidatePath: string, stateDir: string) {
  return path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(stateDir, candidatePath);
}

export async function resolveOpenClawStateProbe(): Promise<OpenClawStateProbe> {
  const warnings: string[] = [];
  const evidence: DetectionEvidence[] = [];
  const homeDir = os.homedir();
  const envConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  const envStateDir = process.env.OPENCLAW_STATE_DIR;

  const configCandidates: string[] = [];
  if (envConfigPath) {
    configCandidates.push(envConfigPath);
  }

  const stateDirCandidates = [
    envStateDir,
    path.join(homeDir, ".openclaw"),
    ...LEGACY_STATE_DIRS.map((legacyDir) => path.join(homeDir, legacyDir))
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const stateDir of stateDirCandidates) {
    const configNames = [
      "openclaw.json",
      "clawdbot.json",
      "moldbot.json",
      "moltbot.json"
    ];

    for (const configName of configNames) {
      configCandidates.push(path.join(stateDir, configName));
    }
  }

  for (const configPath of configCandidates) {
    if (!(await pathExists(configPath))) {
      continue;
    }

    const stateDir = path.dirname(configPath);
    const configText = await fs.readFile(configPath, "utf8");
    const analysis = analyzeConfigText(configText);
    const diskAgentIds = await countAgentDirectories(stateDir);
    const agentIds =
      analysis.explicitAgentIds.length > 0 ? analysis.explicitAgentIds : diskAgentIds;
    const agentCount = agentIds.length > 0 ? agentIds.length : 1;
    const workspaceDirs = new Map<string, string>();
    const defaultWorkspaceDir = path.join(stateDir, "workspace");

    if (await pathExists(defaultWorkspaceDir)) {
      workspaceDirs.set(defaultWorkspaceDir, "default-state-workspace");
    }

    for (const candidate of analysis.workspaceCandidates) {
      const resolvedPath = resolveWorkspaceCandidate(candidate.path, stateDir);
      if (await pathExists(resolvedPath)) {
        workspaceDirs.set(resolvedPath, candidate.source);
      } else {
        warnings.push(`Configured OpenClaw workspace path was not found: ${resolvedPath}`);
      }
    }

    const managedSkillsDir = path.join(stateDir, "skills");
    const extensionsDir = path.join(stateDir, "extensions");
    const credentialsDir = path.join(stateDir, "credentials");
    const sessionsRoots = agentIds.map((agentId) =>
      path.join(stateDir, "agents", agentId, "sessions")
    );

    evidence.push({
      kind: "file",
      path: configPath,
      message: "OpenClaw state config file found",
      weight: 0.02
    });

    if (analysis.customConfig) {
      evidence.push({
        kind: "content",
        path: configPath,
        message: `OpenClaw custom configuration detected for ${agentCount} agent${agentCount === 1 ? "" : "s"}`,
        weight: 0.03
      });
    }

    if (diskAgentIds.length > 0 && analysis.explicitAgentIds.length > 0 && diskAgentIds.length !== analysis.explicitAgentIds.length) {
      warnings.push(
        `OpenClaw config lists ${analysis.explicitAgentIds.length} agent(s) but disk state contains ${diskAgentIds.length} agent folder(s).`
      );
    }

    if (workspaceDirs.size === 0) {
      warnings.push("No OpenClaw workspace directory was resolved from state/config.");
    }

    return {
      stateDir,
      configPath,
      configFound: true,
      customConfig: analysis.customConfig,
      agentCount,
      defaultImplicitAgent: analysis.defaultImplicitAgent,
      agentIds,
      workspaceDirs: [...workspaceDirs.keys()].sort(),
      workspaceSources: [...workspaceDirs.values()],
      managedSkillsDir: (await pathExists(managedSkillsDir)) ? managedSkillsDir : undefined,
      extensionsDir: (await pathExists(extensionsDir)) ? extensionsDir : undefined,
      credentialsDir: (await pathExists(credentialsDir)) ? credentialsDir : undefined,
      sessionsRoots,
      analysis,
      warnings,
      evidence
    };
  }

  warnings.push("No OpenClaw state/config directory was found, so agent count is unknown.");
  return {
    configFound: false,
    agentIds: [],
    workspaceDirs: [],
    workspaceSources: [],
    sessionsRoots: [],
    warnings,
    evidence
  };
}
