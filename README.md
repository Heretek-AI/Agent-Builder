# Agent-Builder

A curated, machine-validated multi-harness AI Agent Registry & Awesome List — Plugins, Skills, MCP Servers, Prompts, `DESIGN.md` systems, and Agent Presets for OpenCode, Claude Code, Codex, and more.

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re) [![Registry JSON](https://img.shields.io/badge/registry-registry.json-blue)](https://heretek-ai.github.io/Agent-Builder/registry.json) [![WebUI](https://img.shields.io/badge/webui-agent--builder-green)](https://heretek-ai.github.io/Agent-Builder/) [![NPM](https://img.shields.io/npm/v/@heretek-ai/agent-builder)](https://www.npmjs.com/package/@heretek-ai/agent-builder)

## Quick Start

- 🌐 **Agent Builder WebUI:** https://heretek-ai.github.io/Agent-Builder/
- 💻 **CLI:** `npx @heretek-ai/agent-builder serve`
- 📦 **Machine-readable registry:** https://heretek-ai.github.io/Agent-Builder/registry.json ([repository](https://github.com/Heretek-AI/Agent-Builder))

```bash
npx @heretek-ai/agent-builder serve
# then open the printed local URL, or use the hosted WebUI above
```

**Registry stats:** 15 entries (1 agent, 1 design-md, 1 mcp-server, 2 plugin, 1 prompt, 9 skill) across the taxonomy below.

## Table of Contents

- [1. Plugins & Extensions (By Harness)](#1-plugins-extensions-by-harness)
  - [OpenCode Plugins](#opencode-plugins)
  - [Claude Code Plugins](#claude-code-plugins)
  - [Codex Plugins & Extensions](#codex-plugins-extensions)
  - [Gemini CLI Extensions](#gemini-cli-extensions)
  - [Cursor & Windsurf Extensions](#cursor-windsurf-extensions)
  - [Cross-Harness Bridges & Multiplexers](#cross-harness-bridges-multiplexers)
- [2. Agent Skills (By Subject & Domain)](#2-agent-skills-by-subject-domain)
  - [2.1 Coding & Programming Languages](#21-coding-programming-languages)
    - [C & C++](#c-c)
    - [Rust](#rust)
    - [Lua & Neovim / Game Scripting](#lua-neovim-game-scripting)
    - [Python](#python)
    - [TypeScript & JavaScript](#typescript-javascript)
    - [Go (Golang)](#go-golang)
    - [Zig & Low-Level Systems](#zig-low-level-systems)
    - [Java, Kotlin & C# (.NET)](#java-kotlin-c-net)
    - [SQL & Database Engineering](#sql-database-engineering)
    - [Shell, Bash & CLI Tooling](#shell-bash-cli-tooling)
  - [2.2 Design, UI/UX & Client Platforms](#22-design-uiux-client-platforms)
    - [WebUI & Frontend Frameworks](#webui-frontend-frameworks)
    - [Desktop Apps — Windows](#desktop-apps-windows)
    - [Desktop Apps — macOS](#desktop-apps-macos)
    - [Desktop Apps — Linux](#desktop-apps-linux)
    - [Desktop Apps — Cross-Platform](#desktop-apps-cross-platform)
    - [Mobile — Android](#mobile-android)
    - [Mobile — iOS & iPadOS](#mobile-ios-ipados)
    - [Mobile — Cross-Platform](#mobile-cross-platform)
  - [2.3 CyberSecurity & Assurance](#23-cybersecurity-assurance)
    - [Reverse Engineering](#reverse-engineering)
    - [Malware Analysis & Triage](#malware-analysis-triage)
    - [Security Auditing & Code Review](#security-auditing-code-review)
    - [Web, API & Network Pentesting](#web-api-network-pentesting)
    - [Cloud Security, Supply Chain & Hardening](#cloud-security-supply-chain-hardening)
    - [DFIR & Threat Intelligence](#dfir-threat-intelligence)
  - [2.4 DevOps, Cloud & Infrastructure](#24-devops-cloud-infrastructure)
    - [Docker, Kubernetes & Service Mesh](#docker-kubernetes-service-mesh)
    - [Terraform, OpenTofu & Cloud IaC](#terraform-opentofu-cloud-iac)
    - [CI/CD Pipelines & Observability](#cicd-pipelines-observability)
  - [2.5 AI Engineering, RAG & Data Science](#25-ai-engineering-rag-data-science)
    - [Agent Architecture & Orchestration](#agent-architecture-orchestration)
    - [RAG, Vector Search & Knowledge Graphs](#rag-vector-search-knowledge-graphs)
    - [ML Training, Fine-Tuning & Science](#ml-training-fine-tuning-science)
  - [2.6 Testing, QA & Verification](#26-testing-qa-verification)
    - [Browser & E2E Automation](#browser-e2e-automation)
    - [Unit, Integration & Property Testing](#unit-integration-property-testing)
- [3. MCP Tools & Servers](#3-mcp-tools-servers)
  - [Filesystem, Terminal & OS Automation](#filesystem-terminal-os-automation)
  - [Git, GitHub & Code Intelligence](#git-github-code-intelligence)
  - [Databases & Data Warehouses](#databases-data-warehouses)
  - [Browser Automation, Search & Scraping](#browser-automation-search-scraping)
  - [Security, Reverse Engineering & Analysis](#security-reverse-engineering-analysis)
  - [Design, Figma & UI Tooling](#design-figma-ui-tooling)
  - [Cloud, Containers & Observability](#cloud-containers-observability)
  - [Knowledge Bases, Docs & Comms](#knowledge-bases-docs-comms)
- [4. DESIGN.md Systems](#4-designmd-systems)
  - [AI Platforms & Developer Tools](#ai-platforms-developer-tools)
  - [SaaS, Dashboards & Productivity](#saas-dashboards-productivity)
  - [Fintech, Media & Consumer Brands](#fintech-media-consumer-brands)
- [5. System Prompts & Personas](#5-system-prompts-personas)
  - [Software Architecture & Code Review Prompts](#software-architecture-code-review-prompts)
  - [Security & Adversarial Audit Prompts](#security-adversarial-audit-prompts)
  - [Product, UI/UX & Technical Writing Prompts](#product-uiux-technical-writing-prompts)
- [6. Complete Agent Presets & Multi-Agent Teams](#6-complete-agent-presets-multi-agent-teams)
  - [Language & Stack Specialist Agents](#language-stack-specialist-agents)
  - [Security, RE & Malware Triage Agents](#security-re-malware-triage-agents)
  - [UI/UX & Cross-Platform Design Agents](#uiux-cross-platform-design-agents)
  - [DevOps, Database & Research Agents](#devops-database-research-agents)

## 1. Plugins & Extensions (By Harness)

`plugins`

Native harness plugins, lifecycle hooks, memory extensions, and statuslines.

### OpenCode Plugins

`plugins/opencode`

OpenCode v1 & v2 plugins, custom tools, and session hooks.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [OpenCode Session Hooks Plugin](https://github.com/example/opencode-session-hooks) | Session lifecycle hooks and custom tools for OpenCode. | [opencode] | — | — |

### Claude Code Plugins

`plugins/claude-code`

Claude Code slash-command bundles, hook scripts, and marketplace plugins.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Claude Code Slash Bundle](https://github.com/example/claude-slash-bundle) | Slash-command bundle and hook scripts for Claude Code. | [claude-code] | — | — |

### Codex Plugins & Extensions

`plugins/codex`

Codex CLI wrappers, sandbox profiles, and orchestration extensions.

_No entries yet — contributions welcome (see Contributing below)._

### Gemini CLI Extensions

`plugins/gemini-cli`

Extensions and tool bridges for Gemini CLI.

_No entries yet — contributions welcome (see Contributing below)._

### Cursor & Windsurf Extensions

`plugins/cursor-windsurf`

IDE-integrated agent plugins and rule packs.

_No entries yet — contributions welcome (see Contributing below)._

### Cross-Harness Bridges & Multiplexers

`plugins/cross-harness`

Multi-agent routers, harness adapters, and cross-provider bridges.

_No entries yet — contributions welcome (see Contributing below)._

## 2. Agent Skills (By Subject & Domain)

`skills`

Installable SKILL.md playbooks and domain-specific instruction bundles.

### 2.1 Coding & Programming Languages

`skills/coding`

#### C & C++

`skills/coding/c-cpp`

Modern C++20/23, CMake, embedded C, memory safety, and sanitizer workflows.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Modern C++ Playbook](https://github.com/example/modern-cpp-playbook) | Modern C++20/23, CMake, and sanitizer workflows. | [opencode] [claude-code] [universal] | cpp, c | — |

#### Rust

`skills/coding/rust`

Cargo workspaces, unsafe auditing, async Tokio, lifetime refactoring, and FFI.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Rust Secure Coding Skill](https://github.com/example/rust-secure-coding) | Cargo workspaces, unsafe auditing, and Tokio patterns. | [opencode] [claude-code] [universal] | rust | — |

#### Lua & Neovim / Game Scripting

`skills/coding/lua`

LuaJIT, Neovim plugin development, LÖVE2D, and embedded Lua scripting.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Lua and Neovim Scripting Skill](https://github.com/example/lua-neovim-scripting) | LuaJIT, Neovim plugins, and embedded Lua scripting. | [opencode] [universal] | lua | — |

#### Python

`skills/coding/python`

Asyncio, Pydantic, packaging (uv/poetry), type-checking, and FastAPI services.

_No entries yet — contributions welcome (see Contributing below)._

#### TypeScript & JavaScript

`skills/coding/typescript-js`

Node.js, Bun, Deno, strict TypeScript type-level programming, and ESM bundling.

_No entries yet — contributions welcome (see Contributing below)._

#### Go (Golang)

`skills/coding/go`

Concurrent Go services, gRPC, profiling, and zero-allocation patterns.

_No entries yet — contributions welcome (see Contributing below)._

#### Zig & Low-Level Systems

`skills/coding/zig-systems`

Zig build system, custom allocators, bare-metal, and OS kernel development.

_No entries yet — contributions welcome (see Contributing below)._

#### Java, Kotlin & C# (.NET)

`skills/coding/jvm-dotnet`

JVM performance, Spring/Ktor, .NET Core, and enterprise backend patterns.

_No entries yet — contributions welcome (see Contributing below)._

#### SQL & Database Engineering

`skills/coding/sql-databases`

PostgreSQL, ClickHouse, SQLite, query optimization, and schema migrations.

_No entries yet — contributions welcome (see Contributing below)._

#### Shell, Bash & CLI Tooling

`skills/coding/shell-cli`

POSIX shell, Zsh, PowerShell, and TUI/CLI ergonomics.

_No entries yet — contributions welcome (see Contributing below)._

### 2.2 Design, UI/UX & Client Platforms

`skills/design`

#### WebUI & Frontend Frameworks

`skills/design/webui`

React, Next.js, Vue, Svelte, Tailwind CSS, accessibility (WCAG), and motion design.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [WebUI Frontend Patterns](https://github.com/example/webui-frontend-patterns) | React, Tailwind, and accessible motion design patterns. | [opencode] [claude-code] [universal] | typescript, javascript | — |

#### Desktop Apps — Windows

`skills/design/desktop-windows`

WinUI 3, WPF, Win32 COM automation, and Windows installer packaging.

_No entries yet — contributions welcome (see Contributing below)._

#### Desktop Apps — macOS

`skills/design/desktop-macos`

AppKit, SwiftUI for macOS, AppleScript/JXA automation, and notarization.

_No entries yet — contributions welcome (see Contributing below)._

#### Desktop Apps — Linux

`skills/design/desktop-linux`

GTK4, Qt/QML, Wayland/X11 compositors, Flatpak, and systemd desktop integration.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Linux Desktop Patterns](https://github.com/example/linux-desktop-patterns) | GTK4, Qt/QML, Flatpak, and Wayland integration. | [opencode] [universal] | linux | — |

#### Desktop Apps — Cross-Platform

`skills/design/desktop-cross-platform`

Tauri, Electron, Flutter Desktop, and Dear ImGui.

_No entries yet — contributions welcome (see Contributing below)._

#### Mobile — Android

`skills/design/mobile-android`

Jetpack Compose, Kotlin Android SDK, ADB automation, and Gradle build tuning.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Android Compose Patterns](https://github.com/example/android-compose-patterns) | Jetpack Compose, ADB automation, and Gradle tuning. | [opencode] [universal] | kotlin, android | — |

#### Mobile — iOS & iPadOS

`skills/design/mobile-ios`

SwiftUI, UIKit, Xcode build pipelines, XCUITest, and TestFlight workflows.

_No entries yet — contributions welcome (see Contributing below)._

#### Mobile — Cross-Platform

`skills/design/mobile-cross-platform`

React Native, Expo, and Flutter mobile patterns.

_No entries yet — contributions welcome (see Contributing below)._

### 2.3 CyberSecurity & Assurance

`skills/cybersecurity`

#### Reverse Engineering

`skills/cybersecurity/reverse-engineering`

Ghidra, IDA Pro, Binary Ninja, radare2/rizin, firmware unpacking, and protocol decompilation.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Ghidra RE Workflows](https://github.com/example/ghidra-re-workflows) | Ghidra, rizin, and firmware unpacking workflows. | [opencode] [claude-code] [universal] | — | — |

#### Malware Analysis & Triage

`skills/cybersecurity/malware-analysis`

Static/dynamic binary triage, YARA rule authoring, deobfuscation, and sandbox detonation analysis.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Malware Triage Playbook](https://github.com/example/malware-triage-playbook) | Static/dynamic triage, YARA, and sandbox detonation. | [opencode] [universal] | — | — |

#### Security Auditing & Code Review

`skills/cybersecurity/security-auditing`

SAST/DAST triage, threat modeling, smart contract auditing, and differential vulnerability discovery.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Secure Code Audit Skill](https://github.com/example/secure-code-audit) | SAST/DAST triage, threat modeling, and audit checklists. | [opencode] [claude-code] [universal] | — | — |

#### Web, API & Network Pentesting

`skills/cybersecurity/web-network-pentesting`

Authorized offensive testing, Burp Suite workflows, SSRF/IDOR auditing, and protocol fuzzing.

_No entries yet — contributions welcome (see Contributing below)._

#### Cloud Security, Supply Chain & Hardening

`skills/cybersecurity/cloud-devsecops`

IAM least-privilege, container hardening, SBOM/cosign verification, and secret scanning.

_No entries yet — contributions welcome (see Contributing below)._

#### DFIR & Threat Intelligence

`skills/cybersecurity/dfir-threat-intel`

Log forensics, incident response playbooks, OSINT, and detection engineering.

_No entries yet — contributions welcome (see Contributing below)._

### 2.4 DevOps, Cloud & Infrastructure

`skills/devops-cloud`

#### Docker, Kubernetes & Service Mesh

`skills/devops-cloud/containers-k8s`

Container builds, Helm, Kubernetes operators, and cluster debugging.

_No entries yet — contributions welcome (see Contributing below)._

#### Terraform, OpenTofu & Cloud IaC

`skills/devops-cloud/iac-terraform`

AWS, GCP, Azure, Cloudflare Workers, and declarative infrastructure modules.

_No entries yet — contributions welcome (see Contributing below)._

#### CI/CD Pipelines & Observability

`skills/devops-cloud/ci-cd-observability`

GitHub Actions, GitLab CI, OpenTelemetry, Prometheus, and incident runbooks.

_No entries yet — contributions welcome (see Contributing below)._

### 2.5 AI Engineering, RAG & Data Science

`skills/data-ai`

#### Agent Architecture & Orchestration

`skills/data-ai/agent-orchestration`

Subagent planning, context compaction, evaluation harnesses, and MCP authoring.

_No entries yet — contributions welcome (see Contributing below)._

#### RAG, Vector Search & Knowledge Graphs

`skills/data-ai/rag-memory`

Hybrid retrieval, chunking, embeddings, and persistent agent memory.

_No entries yet — contributions welcome (see Contributing below)._

#### ML Training, Fine-Tuning & Science

`skills/data-ai/ml-scientific`

LoRA/TRL fine-tuning, benchmark evaluation, bioinformatics, and geospatial analysis.

_No entries yet — contributions welcome (see Contributing below)._

### 2.6 Testing, QA & Verification

`skills/testing-qa`

#### Browser & E2E Automation

`skills/testing-qa/browser-e2e`

Playwright, Cypress, Selenium, and visual regression verification.

_No entries yet — contributions welcome (see Contributing below)._

#### Unit, Integration & Property Testing

`skills/testing-qa/unit-property`

Test generation, mutation testing, fuzzing, and deterministic fixtures.

_No entries yet — contributions welcome (see Contributing below)._

## 3. MCP Tools & Servers

`mcp-servers`

Model Context Protocol servers with introspected tool names for fine-grained per-agent scoping.

### Filesystem, Terminal & OS Automation

`mcp-servers/filesystem-shell`

Local file operations, sandboxed command execution, and desktop automation.

_No entries yet — contributions welcome (see Contributing below)._

### Git, GitHub & Code Intelligence

`mcp-servers/git-repos`

Repository management, PR workflows, AST search, and LSP bridges.

_No entries yet — contributions welcome (see Contributing below)._

### Databases & Data Warehouses

`mcp-servers/databases`

PostgreSQL, SQLite, ClickHouse, Supabase, Neon, and Redis MCP connectors.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Postgres MCP Connector](https://github.com/example/postgres-mcp-connector) | Read-only Postgres MCP server with audited tools. | [opencode] [claude-code] | — | 3 tools |

### Browser Automation, Search & Scraping

`mcp-servers/browser-web`

Playwright, Chrome CDP, Firecrawl, Crawlbase, and SerpApi MCP servers.

_No entries yet — contributions welcome (see Contributing below)._

### Security, Reverse Engineering & Analysis

`mcp-servers/security-re`

Ghidra MCP, binary analysis, vulnerability scanners, and log auditing servers.

_No entries yet — contributions welcome (see Contributing below)._

### Design, Figma & UI Tooling

`mcp-servers/design-ui`

Figma, Stitch, Storybook, and screenshot diffing MCP servers.

_No entries yet — contributions welcome (see Contributing below)._

### Cloud, Containers & Observability

`mcp-servers/cloud-devops`

Cloudflare, Kubernetes, Docker, Sentry, and Datadog MCP servers.

_No entries yet — contributions welcome (see Contributing below)._

### Knowledge Bases, Docs & Comms

`mcp-servers/knowledge-productivity`

Obsidian, Notion, NotebookLM, Slack, and Google Workspace MCP servers.

_No entries yet — contributions welcome (see Contributing below)._

## 4. DESIGN.md Systems

`design-md`

Drop-in DESIGN.md brand and UI system specs (inspired by Google Stitch & VoltAgent/awesome-design-md).

### AI Platforms & Developer Tools

`design-md/ai-dev-tools`

Terminal-first, dark-mode, and high-contrast engineering design systems.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Terminal Dev Design System](https://github.com/example/terminal-dev-design) | Terminal-first dark-mode DESIGN.md for dev tools. | [universal] | — | — |

### SaaS, Dashboards & Productivity

`design-md/saas-productivity`

Clean editorial workspaces, data-dense analytics, and collaborative UI systems.

_No entries yet — contributions welcome (see Contributing below)._

### Fintech, Media & Consumer Brands

`design-md/fintech-consumer`

High-trust financial interfaces, editorial media, and consumer web aesthetics.

_No entries yet — contributions welcome (see Contributing below)._

## 5. System Prompts & Personas

`prompts`

Curated system prompts, meta-prompts, and reasoning workflows.

### Software Architecture & Code Review Prompts

`prompts/coding-architecture`

System prompts for refactoring, architecture critique, and spec authoring.

_No entries yet — contributions welcome (see Contributing below)._

### Security & Adversarial Audit Prompts

`prompts/security-research`

Red-team, threat-modeling, and multi-subagent code audit prompts.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Adversarial Audit Prompt](https://github.com/example/adversarial-audit-prompt) | Red-team multi-subagent code audit prompt. | [opencode] [claude-code] [universal] | — | — |

### Product, UI/UX & Technical Writing Prompts

`prompts/product-design`

Design critique, documentation, and specification interview prompts.

_No entries yet — contributions welcome (see Contributing below)._

## 6. Complete Agent Presets & Multi-Agent Teams

`agents`

Ready-to-run scoped agent configurations combining a prompt, allowed skills, and scoped MCP tools.

### Language & Stack Specialist Agents

`agents/coding-specialists`

Pre-scoped Rust, C++, Python, and Full-Stack subagents.

_No entries yet — contributions welcome (see Contributing below)._

### Security, RE & Malware Triage Agents

`agents/security-auditors`

Least-privilege security auditing and reverse-engineering agents.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [DB Security Auditor Agent](https://github.com/example/db-security-auditor) | Least-privilege database security auditor agent. | [opencode] | — | — |

### UI/UX & Cross-Platform Design Agents

`agents/design-frontend`

Frontend, desktop, and mobile UI builder agents paired with DESIGN.md specs.

_No entries yet — contributions welcome (see Contributing below)._

### DevOps, Database & Research Agents

`agents/devops-data`

Read-only database auditors, SRE responders, and deep-research teams.

_No entries yet — contributions welcome (see Contributing below)._

## Per-Agent Skill & MCP Scoping

Every agent compiled by the Agent Builder WebUI and CLI follows **deny-first context hygiene**: permissions start by denying everything (`deny "*"` first), then explicitly allow only the skills and MCP tools that agent needs. OpenCode evaluates permission rules in order and **the last matching rule wins**, so the deny-all rule must come first.

```json
{
  "agents": {
    "my-agent": {
      "permissions": [
        { "action": "skill", "resource": "*", "effect": "deny" },
        { "action": "skill", "resource": "rust-secure-coding", "effect": "allow" },
        { "action": "postgres_prod_*", "resource": "*", "effect": "deny" },
        { "action": "postgres_prod_query", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

MCP tool names are normalized as `<serverName>_<toolName>` with all non-alphanumeric characters converted to `_` (e.g. server `postgres-prod` + tool `list-tables` → `postgres_prod_list_tables`).

## Contributing

1. Scaffold a new entry:
   ```bash
   node scripts/new-entry.js --id my-skill --name "My Skill" --kind skill --category skills/coding/rust --repo https://github.com/org/repo --tagline "Short summary"
   ```
2. Validate, export, and regenerate docs:
   ```bash
   npm run validate
   npm run export
   npm run generate
   ```
3. Normalize YAML formatting with `npm run fmt` and open a pull request.

_This README is generated from `data/taxonomy.json` + `data/**/*.yaml` — do not edit by hand; run `npm run generate`._
