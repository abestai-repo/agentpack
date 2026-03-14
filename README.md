# agentpack

AgentPack is a local-first toolkit for detecting, inspecting, packaging, restoring, and converting AI agents through a canonical intermediate model.

This repository now uses a standard install-first developer flow so cloning from GitHub feels like a normal application checkout rather than a zero-dependency script drop.

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

If you switch package managers in the same checkout, clear the previous install first. In particular, running `npm install` on top of a `pnpm`-generated `node_modules` tree can trigger Arborist errors on Windows.

Recommended recovery:

```bash
Remove-Item -Recurse -Force node_modules, dist, .pnpm-store
npm install
```

## Current Phase 1 scope

- workspace layout aligned to the architecture docs
- `packages/domain` runtime contracts and defaults
- `packages/schemas` Zod-backed validation for CAM and `.aegg` documents
- `apps/cli` thin Commander-based CLI with `validate` and `schemas`
- fixture-backed tests with Vitest

Detection engines, adapters, pack/restore flows, and image assembly come next.


## Quotes

“The goal is not to replace humans, but to create AI agents that work and grow with us.” - Jeric T.
“If you can inspect an agent, you should be able to package it.” - Jeric T.
"Portability over framework lock-in." - Jeric T.
"Agents should work anywhere. No need to recreate by hand." - Jeric T.
"When I adopt a new machine or environment, I want to hatch the same agent there, good things should be repeatable." - Jeric T.
"When something breaks, Agents should be able to restore a known-good version safely, quickly." - Jeric T.