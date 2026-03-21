# 🐣 AgentPack — Backup, clone, and migrate AI agents of any kind like OpenClaw, Hermes & more

<p align="center">
    <img width="500" height="113" alt="AgentPack" src="https://github.com/user-attachments/assets/a2e6ab50-072c-4fda-acb5-ccf8a3197df1" />
</p>

<p align="center">
  Migrate. Snapshot. Restore. Clone AI agent of any kind, everywhere.
</p>

<p align="center"> 
  <img src="https://img.shields.io/badge/RELEASE-V2026.3.21-blue" alt="Release" />
  <a target="_blank" href="https://abestai.com/discord"><img src="https://img.shields.io/badge/DISCORD-12K%20ONLINE-5865F2?logo=discord&logoColor=white&style=flat-square" alt="Discord" /></a>
  <img src="https://img.shields.io/badge/LICENSE-APACHE2.0-blue" alt="License" />
  <a target="_blank"href="https://instagram.com/jericbook"><img src="https://img.shields.io/badge/BUILT%20BY-@jerictan-blueviolet?style=flat-square" alt="Built By" /></a>
</p>

<p align="center">
  

</p>

**AgentPack** is a *AI agent packager*. Backup, clone, and migrate AI agents with "DNA" between OpenClaw, Hermes, and AI agents of any kind. 

It is a local-first toolkit for detecting, inspecting, packaging, restoring, and converting AI agents through a canonical intermediate model.

[Website](#) · [Docs](#) · [Getting Started](#) · [Updating](#) · [Showcase](#) · [FAQ](#) · [Onboarding](#) · [Discord](https://abestai.com/discord)

Preferred guide: run `agentpack --help` in your terminal. AgentPack guides you step by step through setting packing and hatching your AGENT Eggs (package, image). It works on **macOS, Linux, and Windows**. Works with npm, pnpm, and AI Agents of any kind. New? Start here: [Getting started](#)

## Quick start

```bash
pnpm install
pnpm build
pnpm schemas
pnpm validate:cam
pnpm test
```

`npm install` also works because the repo uses standard workspaces and local scripts:

```bash
npm install
npm run build
npm run schemas
npm run test
```


Quickly pack an AGENT1 here, and quickly restore it as AGENT2 elsewhere.

```bash
node dist/apps/cli/src/index.js pack C:\AGENT1\.openclaw
node dist/apps/cli/src/index.js hatch C:\AGENT1\openclaw-agent-standard.aegg C:\AGENT2\.openclaw --force --confirm-stepbystep --log-undo
```

Other non-destructive commands:

```bash
node dist/apps/cli/src/index.js inspect C:\AGENT1\.openclaw
node dist/apps/cli/src/index.js inspect C:\AGENT1\openclaw-agent-standard.aegg
node dist/apps/cli/src/index.js detect C:\AGENT1\.openclaw
```


Everything useful for the MVP is above.

## Quotes

“The goal is not to replace humans, but to create AI agents that work and grow with us.” - Jeric T.
“If you can inspect an agent, you should be able to package it.” - Jeric T.
"Portability over framework lock-in." - Jeric T.
"Agents should work anywhere. No need to recreate by hand." - Jeric T.
"When I adopt a new machine or environment, I want to hatch the same agent there, good things should be repeatable." - Jeric T.
"When something breaks, Agents should be able to restore a known-good version safely, quickly." - Jeric T.



## More Advanced complex boring stuffs below




On Windows PowerShell with script execution disabled, use `cmd /c npm ...` instead of `npm ...`:

```powershell
cmd /c npm install
cmd /c npm run build
cmd /c npm run test
```

If you switch package managers in the same checkout, clear the previous install first. In particular, running `npm install` on top of a `pnpm`-generated `node_modules` tree can trigger Arborist errors on Windows.

Recommended recovery:

```bash
Remove-Item -Recurse -Force node_modules, dist, .pnpm-store
npm install
```

## Current implemented scope

- workspace layout aligned to the architecture docs
- `packages/domain` runtime contracts and defaults
- `packages/schemas` Zod-backed validation for CAM and `.aegg` documents
- detection engine with OpenClaw code, state, workspace, and nested-path recognition
- OpenClaw inspect flow for flexible input paths
- local `.aegg` directory packaging via `agentpack pack` / `snapshot`
- multi-agent detection and per-agent packaging (one `.aegg` per agent by default)
- package extraction and restoration into working directories via `agentpack hatch`, `unpack`, or `restore`
- bundle packaging via `--bundle` flag producing a single `.bundle.aegg`
- mode-aware OpenClaw packaging for `minimal`, `standard`, and `full`
- `.aegg` package inspection and checksum document validation
- bundle-aware inspect with per-agent display
- fixture-backed integration tests for detect, inspect, pack, verify, and validation

## CLI commands

Current working commands:

```bash
agentpack detect <path>
agentpack inspect <path-or-aegg>
agentpack pack <openclaw-path> [--bundle] [--split] [--agent <id>]
agentpack snapshot <openclaw-path> [--bundle] [--split] [--agent <id>]
agentpack hatch <aegg-path> <target-path> [--target <framework>] [--dry-run] [--force]
agentpack restore <aegg-path> <target-path>
agentpack unpack <aegg-path> <target-path>
agentpack verify <package-path>
agentpack validate <file>
agentpack schemas
agentpack adapters list
```

## Inspect an OpenClaw target

`agentpack inspect` accepts any OpenClaw-related path:

- repo / install root
- state dir such as `~/.openclaw`
- workspace dir such as `~/.openclaw/workspace`
- nested path under any of those

Examples:

```bash
node dist/apps/cli/src/index.js inspect packages/test-fixtures/fixtures/openclaw-repo --json
node dist/apps/cli/src/index.js inspect S:\GITHUB\openclaw
node dist/apps/cli/src/index.js inspect C:\Users\You\.openclaw
node dist/apps/cli/src/index.js inspect C:\Users\You\.openclaw\workspace
```

`inspect` now normalizes the input into the resolved OpenClaw surfaces it can find, including:

- code folder
- state dir
- config path
- workspace dirs
- managed skills / extensions / credentials when available

## Pack / Snapshot an OpenClaw target

The current packaging path is OpenClaw to local `.aegg` directory artifact.

`pack` and `snapshot` accept the same flexible OpenClaw-related inputs as `inspect`.

### Multi-agent packaging

By default, `pack` detects all agents in the target folder and produces **one `.aegg` per agent**. When multiple agents are detected, a `.snapshot.json` sidecar index is generated alongside the packages.

Flags:

- `--bundle` — package all detected agents into a single `.bundle.aegg`
- `--split` — force one `.aegg` per agent (default behavior, for forward compatibility)
- `--agent <id>` — pack only the specified agent

### Supported modes

- `minimal`: includes core workspace DNA, skills, plugins, and sanitized config; excludes memory and secrets  (for friends, sales, strangers, office)
- `standard`: includes `minimal` plus memory and broader non-secret workspace/state artifacts; excludes secrets (default - for personal copies)
- `full`: includes credentials, sessions, and broader workspace/state payloads (for full enterprise backups)

[minimal]
Lowest viable capture.
Focused on core agent DNA and required package files only: manifest, metadata, compatibility/checksums, basic config, secret references but not secrets.
“minimum useful configuration.”
Should INCLUDE Skills, plugins.
Should NOT INCLUDE memory, memories.
Should NOT INCLUDE LLM AI provider settings.
Should NOT INCLUDE channel, gateway, or any communications settings.
Should NOT INCLUDE secrets.


[standard]
The normal/default balanced capture mode.
Includes the common behavior-defining parts users expect in a practical backup: prompts, model/provider settings, tools, workflows, memory references, env schema, framework metadata.
Should INCLUDE Skills, plugins.
Should INCLUDE memory, memories. 
Should INCLUDE LLM AI provider settings.
Should INCLUDE channel, gateway, or any communications settings.
Should NOT INCLUDE secrets.

[full]
The richest full-secret capture mode. MUST include all MEMORY, MEMORIES.
Includes more optional package content such as additional config artifacts, preview/assets, or broader framework-specific metadata where honest and supported.
Not meant to become a raw filesystem/runtime dump, because the docs explicitly reject that model.
Should INCLUDE Skills, plugins.
Should INCLUDE memory, memories. 
Should INCLUDE LLM AI provider settings.
Should INCLUDE channel, gateway, or any communications settings.
Should INCLUDE secrets.


### Examples

```bash
# Standard per-agent pack
node dist/apps/cli/src/index.js pack packages/test-fixtures/fixtures/openclaw-repo --mode standard --output .codex-tmp-dist/openclaw-standard.aegg --message "Fixture package" --tag fixture

# Pack from a workspace path
node dist/apps/cli/src/index.js pack C:\AGENT1\.openclaw\workspace --mode minimal --output .\temp_deleteme\openclaw-minimal.aegg

# Full snapshot
node dist/apps/cli/src/index.js snapshot S:\GITHUB\openclaw --mode full --output .\temp_deleteme\openclaw-full.aegg

# Bundle all agents into one package
node dist/apps/cli/src/index.js pack S:\GITHUB\openclaw --bundle --mode standard
```

### Agent package layout (default)

This writes a directory ending in `.aegg` containing:

```text
openclaw-fixture.aegg/
├── manifest.json      # package_type: "agent"
├── cam.json
├── metadata.json
├── compatibility.json
├── checksums.json
└── assets/
```

### Bundle package layout (`--bundle`)

With `--bundle`, a single `.bundle.aegg` directory is created:

```text
openclaw-fixture.bundle.aegg/
├── manifest.json          # package_type: "bundle", agents: [...]
├── relationships.json
├── checksums.json
├── shared_resources/
└── agents/
    └── <agent-id>/
        ├── cam.json
        ├── metadata.json
        ├── compatibility.json
        └── assets/
```

The `assets/` tree varies by mode:

- `minimal`: sanitized config, managed skills, extensions, workspace DNA, workspace skills
- `standard`: `minimal` plus `MEMORY.md`, `memory.md`, `memory/`, and `canvas/` when present
- `full`: `standard` plus credentials and session payloads

`snapshot` is an alias for `pack`:

```bash
node dist/apps/cli/src/index.js snapshot packages/test-fixtures/fixtures/openclaw-repo --mode standard --output .codex-tmp-dist/openclaw-standard.aegg
```

## Hatch / Restore a package

Once an agent is packed into an `.aegg` or `.bundle.aegg`, you can extract it back into a working local directory using `hatch`.

`unpack` and `restore` are supported aliases.

### Commands

```bash
# Restore a standard agent egg into a target directory
node dist/apps/cli/src/index.js hatch .codex-tmp-dist/openclaw-standard.aegg ./restored-agent

# Restore all agents from a bundle into a target directory
node dist/apps/cli/src/index.js hatch .\temp_deleteme\openclaw-fixture.bundle.aegg ./workspace-restored

# Preview restoration operations without writing any files
node dist/apps/cli/src/index.js hatch .codex-tmp-dist/openclaw-standard.aegg ./restored-agent --dry-run
```

### Safety Options

AgentPack validates the contents of your destination folder to prevent data loss. You can adjust this behavior using:
- `--dry-run`: Evaluate execution without writing to the disk.
- `--force`: Ignore safety checks and overwrite colliding files in the target directory.
- `--target <framework>`: Force decoding through a specific framework adapter (e.g. `openclaw`) instead of inferring from the artifact's metadata.

When extracting `.bundle.aegg` packages, AgentPack automatically expands the nested structures and extracts every bundled agent into separate internal folders within the target directory. Alternatively, use `--agent <id>` to retrieve exclusively one nested agent from the bundle.

## Inspect and validate a package

Inspect the generated package:

```bash
node dist/apps/cli/src/index.js inspect .codex-tmp-dist/openclaw-standard.aegg --json
node dist/apps/cli/src/index.js inspect .\temp_deleteme\openclaw-full.aegg
```

For bundle packages, `inspect` displays the `package_type` in the Provenance section and lists the bundled agents in Feature Hints.

Validate individual package documents:

```bash
node dist/apps/cli/src/index.js validate .codex-tmp-dist/openclaw-standard.aegg/manifest.json --json
node dist/apps/cli/src/index.js validate .codex-tmp-dist/openclaw-standard.aegg/cam.json --json
node dist/apps/cli/src/index.js validate .codex-tmp-dist/openclaw-standard.aegg/checksums.json --json
```

## Verify package integrity

Use `verify` to check that a `.aegg` package has not been corrupted or tampered with:

```bash
node dist/apps/cli/src/index.js verify .codex-tmp-dist/openclaw-standard.aegg
node dist/apps/cli/src/index.js verify .\temp_deleteme\openclaw-full.aegg --json
```

The verify command:

- Reads `checksums.json` from the package
- Verifies each file's SHA-256 digest matches
- Reports any corrupted files (checksum mismatch)
- Reports any missing files
- Reports any extra files not in the checksums
- Returns exit code 0 if valid, non-zero if corrupted

You can also point directly to `manifest.json`:

```bash
node dist/apps/cli/src/index.js verify .codex-tmp-dist/openclaw-standard.aegg/manifest.json --json
```

## Verify inspect and pack locally

1. Install dependencies.
2. Build the TypeScript output.
3. Run the full test suite.
4. Run `inspect` against an OpenClaw repo, state dir, or workspace dir.
5. Run `pack` in one or more modes.
6. Run `inspect`, `validate`, and `verify` against the generated `.aegg`.
7. Run `hatch` to restore the agent back to your system.

Example on Windows:

```powershell
cmd /c npm install
cmd /c npm run build
cmd /c npm run test
node dist/apps/cli/src/index.js inspect S:\BACKUPABLE\AIProjects\GITHUB\openclaw
node dist/apps/cli/src/index.js pack S:\BACKUPABLE\AIProjects\GITHUB\openclaw --mode standard --output .\temp_deleteme\openclaw-standard.aegg --json
node dist/apps/cli/src/index.js inspect .\temp_deleteme\openclaw-standard.aegg --json
node dist/apps/cli/src/index.js verify .\temp_deleteme\openclaw-standard.aegg --json
node dist/apps/cli/src/index.js validate .\temp_deleteme\openclaw-standard.aegg\checksums.json --json
node dist/apps/cli/src/index.js hatch .\temp_deleteme\openclaw-standard.aegg .\temp_deleteme\restored-agent --json
```

The automated suite now covers:

- schema validation
- OpenClaw detection from repo, state, and workspace inputs
- OpenClaw inspect from repo and workspace inputs
- service-level package creation across `minimal`, `standard`, and `full`
- CLI `pack`
- CLI inspect of generated `.aegg`
- inferred validation of `checksums.json`
