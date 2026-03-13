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
