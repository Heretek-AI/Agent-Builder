# Agent-Builder

A curated, machine-validated multi-harness AI Agent Registry & Awesome List — Plugins, Skills, MCP Servers, Prompts, `DESIGN.md` systems, and Agent Presets for OpenCode, Claude Code, Codex, and more.

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re) [![Registry JSON](https://img.shields.io/badge/registry-registry.json-blue)](https://heretek-ai.github.io/Agent-Builder/registry.json) [![WebUI](https://img.shields.io/badge/webui-agent--builder-green)](https://heretek-ai.github.io/Agent-Builder/) [![NPM](https://img.shields.io/npm/v/@heretek-ai/agent-builder)](https://www.npmjs.com/package/@heretek-ai/agent-builder)

## Quick Start

- 🌐 **Agent Builder WebUI:** https://heretek-ai.github.io/Agent-Builder/
- 💻 **CLI:** `node bin/agent-builder.js serve` (from a local checkout; `npm pack` for a tarball — the package is not published to npm yet, see note below)
- 📦 **Machine-readable registry:** https://heretek-ai.github.io/Agent-Builder/registry.json ([repository](https://github.com/Heretek-AI/Agent-Builder))

```bash
node bin/agent-builder.js serve
# then open the printed local URL, or use the hosted WebUI above
```

> **Note:** `@heretek-ai/agent-builder` is not published on the npm registry yet (`npm view` still 404s — a known gap, AB-6.1). Do not use `npx @heretek-ai/agent-builder`; run from source as above or `npm pack` until `npm publish` lands.

**Registry stats:** 66 entries (4 agent, 3 design-md, 8 mcp-server, 15 plugin, 3 prompt, 33 skill) across the taxonomy below.

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
| [Awesome OpenCode Catalog](https://github.com/Heretek-AI/awesome-opencode) | Upstream awesome list of OpenCode plugins, agents, and configs. | [opencode] | — | — |
| [OpenCode Native Toolchain](https://github.com/anomalyco/opencode) | Official OpenCode runtime: custom tools, hooks, and plugin API. | [opencode] | — | — |
| [OpenCode Session Hooks Plugin](https://github.com/Heretek-AI/Agent-Builder) | Session lifecycle hooks and custom tools for OpenCode. | [opencode] | — | — |
| [pi-weave](https://github.com/EranYonai/pi-weave) | Local-first Markdown memory and knowledge graph for Pi and OpenCode: preserve decisions, recall sessions, and explore… | [opencode] | — | — |

### Claude Code Plugins

`plugins/claude-code`

Claude Code slash-command bundles, hook scripts, and marketplace plugins.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Awesome Claude Code Resources](https://github.com/hesreallyhim/awesome-claude-code) | Community catalog of Claude Code commands, agents, and hooks. | [claude-code] | — | — |
| [Claude Code Runtime](https://github.com/anthropics/claude-code) | Official Claude Code CLI: slash commands, hooks, and MCP support. | [claude-code] | — | — |
| [Claude Code Slash Bundle](https://github.com/Heretek-AI/Agent-Builder) | Slash-command bundle and hook scripts for Claude Code. | [claude-code] | — | — |

### Codex Plugins & Extensions

`plugins/codex`

Codex CLI wrappers, sandbox profiles, and orchestration extensions.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Codex CLI Runtime](https://github.com/openai/codex) | Official Codex CLI: sandbox profiles and skill wiring. | [codex] | — | — |
| [Codex Orchestrator Extension](https://github.com/openai/codex) | Multi-step orchestration profiles for Codex CLI sessions. | [codex] | — | — |

### Gemini CLI Extensions

`plugins/gemini-cli`

Extensions and tool bridges for Gemini CLI.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Gemini CLI Extension Bridge](https://github.com/google-gemini/gemini-cli) | Extensions and tool bridges for Gemini CLI agents. | [gemini-cli] | — | — |

### Cursor & Windsurf Extensions

`plugins/cursor-windsurf`

IDE-integrated agent plugins and rule packs.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Cursor Rules Pack](https://github.com/PatrickJS/awesome-cursorrules) | Community rule packs and IDE agent plugins for Cursor. | [cursor] [windsurf] | — | — |

### Cross-Harness Bridges & Multiplexers

`plugins/cross-harness`

Multi-agent routers, harness adapters, and cross-provider bridges.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Harness Adapter Kit](https://github.com/anomalyco/opencode) | Adapter patterns for running one agent across harnesses. | [opencode] [claude-code] [codex] [universal] | — | — |
| [LiteLLM Router Bridge](https://github.com/BerriAI/litellm) | Multi-provider LLM router bridging harnesses to 100+ models. | [opencode] [claude-code] [codex] [universal] | — | — |
| [Pi Coding Agent Harness](https://github.com/earendil-works/pi) | Minimal, extensible terminal AI coding agent harness with Codemode & MCP. | [opencode] [claude-code] [codex] [universal] | typescript, linux, macos, windows | — |
| [Pi Code Review Extension](https://github.com/earendil-works/pi-review) | Practical /review and /end-review workflow extension for Pi. | [universal] | typescript, linux, macos, windows | — |

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
| [Modern C++ Playbook](https://github.com/Heretek-AI/Agent-Builder) | Modern C++20/23, CMake, and sanitizer workflows. | [opencode] [claude-code] [universal] | cpp, c | — |

#### Rust

`skills/coding/rust`

Cargo workspaces, unsafe auditing, async Tokio, lifetime refactoring, and FFI.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Rust Secure Coding Skill](https://github.com/Heretek-AI/Agent-Builder) | Cargo workspaces, unsafe auditing, and Tokio patterns. | [opencode] [claude-code] [universal] | rust | — |

#### Lua & Neovim / Game Scripting

`skills/coding/lua`

LuaJIT, Neovim plugin development, LÖVE2D, and embedded Lua scripting.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Lua and Neovim Scripting Skill](https://github.com/Heretek-AI/Agent-Builder) | LuaJIT, Neovim plugins, and embedded Lua scripting. | [opencode] [universal] | lua | — |

#### Python

`skills/coding/python`

Asyncio, Pydantic, packaging (uv/poetry), type-checking, and FastAPI services.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Python FastAPI Service Skill](https://github.com/tiangolo/fastapi) | Asyncio, Pydantic v2, and FastAPI service patterns. | [opencode] [claude-code] [codex] [universal] | python | — |
| [Python Packaging with uv Skill](https://github.com/astral-sh/uv) | Modern Python packaging, workspaces, and type-checking with uv. | [opencode] [universal] | python | — |

#### TypeScript & JavaScript

`skills/coding/typescript-js`

Node.js, Bun, Deno, strict TypeScript type-level programming, and ESM bundling.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Strict TypeScript Patterns Skill](https://github.com/microsoft/TypeScript) | Strict type-level TypeScript, ESM bundling, and Bun/Node APIs. | [opencode] [claude-code] [universal] | typescript, javascript | — |

#### Go (Golang)

`skills/coding/go`

Concurrent Go services, gRPC, profiling, and zero-allocation patterns.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Go Concurrent Services Skill](https://github.com/golang/go) | Concurrent Go services, gRPC, profiling, and zero-alloc patterns. | [opencode] [claude-code] [universal] | go | — |

#### Zig & Low-Level Systems

`skills/coding/zig-systems`

Zig build system, custom allocators, bare-metal, and OS kernel development.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Zig Systems Playbook Skill](https://github.com/ziglang/zig) | Zig build system, custom allocators, and bare-metal patterns. | [opencode] [universal] | zig | — |

#### Java, Kotlin & C# (.NET)

`skills/coding/jvm-dotnet`

JVM performance, Spring/Ktor, .NET Core, and enterprise backend patterns.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [JVM Spring Patterns Skill](https://github.com/spring-projects/spring-boot) | Spring Boot services, JVM tuning, and enterprise backend patterns. | [opencode] [universal] | java, kotlin | — |

#### SQL & Database Engineering

`skills/coding/sql-databases`

PostgreSQL, ClickHouse, SQLite, query optimization, and schema migrations.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [SQL Query Optimization Skill](https://github.com/postgres/postgres) | PostgreSQL tuning, EXPLAIN plans, and schema migrations. | [opencode] [universal] | sql | — |

#### Shell, Bash & CLI Tooling

`skills/coding/shell-cli`

POSIX shell, Zsh, PowerShell, and TUI/CLI ergonomics.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Shell & CLI Ergonomics Skill](https://github.com/mvdan/sh) | POSIX shell, formatting, and TUI/CLI design patterns. | [opencode] [universal] | shell, bash, linux, macos | — |

### 2.2 Design, UI/UX & Client Platforms

`skills/design`

#### WebUI & Frontend Frameworks

`skills/design/webui`

React, Next.js, Vue, Svelte, Tailwind CSS, accessibility (WCAG), and motion design.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [WebUI Frontend Patterns](https://github.com/Heretek-AI/Agent-Builder) | React, Tailwind, and accessible motion design patterns. | [opencode] [claude-code] [universal] | typescript, javascript | — |

#### Desktop Apps — Windows

`skills/design/desktop-windows`

WinUI 3, WPF, Win32 COM automation, and Windows installer packaging.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Windows Desktop Patterns Skill](https://github.com/microsoft/WinUI-Gallery) | WinUI 3, WPF, and Windows packaging workflows. | [opencode] [universal] | windows | — |

#### Desktop Apps — macOS

`skills/design/desktop-macos`

AppKit, SwiftUI for macOS, AppleScript/JXA automation, and notarization.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [macOS SwiftUI Patterns Skill](https://github.com/apple/swift) | AppKit, SwiftUI for macOS, and notarization pipelines. | [opencode] [universal] | swift, macos | — |

#### Desktop Apps — Linux

`skills/design/desktop-linux`

GTK4, Qt/QML, Wayland/X11 compositors, Flatpak, and systemd desktop integration.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Linux Desktop Patterns](https://github.com/Heretek-AI/Agent-Builder) | GTK4, Qt/QML, Flatpak, and Wayland integration. | [opencode] [universal] | linux | — |

#### Desktop Apps — Cross-Platform

`skills/design/desktop-cross-platform`

Tauri, Electron, Flutter Desktop, and Dear ImGui.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Tauri Cross-Platform Desktop Skill](https://github.com/tauri-apps/tauri) | Tauri, IPC bridges, and cross-platform desktop builds. | [opencode] [universal] | rust, typescript, windows, macos, linux | — |

#### Mobile — Android

`skills/design/mobile-android`

Jetpack Compose, Kotlin Android SDK, ADB automation, and Gradle build tuning.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Android Compose Patterns](https://github.com/Heretek-AI/Agent-Builder) | Jetpack Compose, ADB automation, and Gradle tuning. | [opencode] [universal] | kotlin, android | — |

#### Mobile — iOS & iPadOS

`skills/design/mobile-ios`

SwiftUI, UIKit, Xcode build pipelines, XCUITest, and TestFlight workflows.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [iOS SwiftUI Pipelines Skill](https://github.com/Alamofire/Alamofire) | SwiftUI, networking layers, and Xcode/TestFlight workflows. | [opencode] [universal] | swift, ios | — |

#### Mobile — Cross-Platform

`skills/design/mobile-cross-platform`

React Native, Expo, and Flutter mobile patterns.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Flutter Cross-Platform Mobile Skill](https://github.com/flutter/flutter) | Flutter widgets, state management, and store releases. | [opencode] [universal] | dart, android, ios | — |

### 2.3 CyberSecurity & Assurance

`skills/cybersecurity`

#### Reverse Engineering

`skills/cybersecurity/reverse-engineering`

Ghidra, IDA Pro, Binary Ninja, radare2/rizin, firmware unpacking, and protocol decompilation.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Ghidra RE Workflows](https://github.com/Heretek-AI/Agent-Builder) | Ghidra, rizin, and firmware unpacking workflows. | [opencode] [claude-code] [universal] | — | — |

#### Malware Analysis & Triage

`skills/cybersecurity/malware-analysis`

Static/dynamic binary triage, YARA rule authoring, deobfuscation, and sandbox detonation analysis.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Malware Triage Playbook](https://github.com/Heretek-AI/Agent-Builder) | Static/dynamic triage, YARA, and sandbox detonation. | [opencode] [universal] | — | — |

#### Security Auditing & Code Review

`skills/cybersecurity/security-auditing`

SAST/DAST triage, threat modeling, smart contract auditing, and differential vulnerability discovery.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Secure Code Audit Skill](https://github.com/Heretek-AI/Agent-Builder) | SAST/DAST triage, threat modeling, and audit checklists. | [opencode] [claude-code] [universal] | — | — |

#### Web, API & Network Pentesting

`skills/cybersecurity/web-network-pentesting`

Authorized offensive testing, Burp Suite workflows, SSRF/IDOR auditing, and protocol fuzzing.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Web & API Pentesting Skill](https://github.com/OWASP/wstg) | Authorized web/API testing: SSRF, IDOR, and Burp workflows. | [opencode] [universal] | — | — |

#### Cloud Security, Supply Chain & Hardening

`skills/cybersecurity/cloud-devsecops`

IAM least-privilege, container hardening, SBOM/cosign verification, and secret scanning.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Cloud & Supply-Chain Hardening Skill](https://github.com/sigstore/cosign) | IAM least-privilege, cosign verification, and secret scanning. | [opencode] [universal] | — | — |

#### DFIR & Threat Intelligence

`skills/cybersecurity/dfir-threat-intel`

Log forensics, incident response playbooks, OSINT, and detection engineering.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [DFIR & Incident Playbooks Skill](https://github.com/Velocidex/velociraptor) | Log forensics, IR playbooks, and detection engineering. | [opencode] [universal] | — | — |

### 2.4 DevOps, Cloud & Infrastructure

`skills/devops-cloud`

#### Docker, Kubernetes & Service Mesh

`skills/devops-cloud/containers-k8s`

Container builds, Helm, Kubernetes operators, and cluster debugging.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Kubernetes Debugging Skill](https://github.com/kubernetes/kubernetes) | Cluster debugging, Helm releases, and operator patterns. | [opencode] [universal] | linux | — |

#### Terraform, OpenTofu & Cloud IaC

`skills/devops-cloud/iac-terraform`

AWS, GCP, Azure, Cloudflare Workers, and declarative infrastructure modules.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Terraform IaC Modules Skill](https://github.com/hashicorp/terraform) | Terraform/OpenTofu modules for AWS, GCP, and Azure. | [opencode] [universal] | — | — |

#### CI/CD Pipelines & Observability

`skills/devops-cloud/ci-cd-observability`

GitHub Actions, GitLab CI, OpenTelemetry, Prometheus, and incident runbooks.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [CI/CD & Observability Skill](https://github.com/open-telemetry/opentelemetry-collector) | GitHub Actions pipelines, OpenTelemetry, and incident runbooks. | [opencode] [universal] | — | — |

### 2.5 AI Engineering, RAG & Data Science

`skills/data-ai`

#### Agent Architecture & Orchestration

`skills/data-ai/agent-orchestration`

Subagent planning, context compaction, evaluation harnesses, and MCP authoring.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Agent Orchestration Patterns Skill](https://github.com/VoltAgent/awesome-agent-skills) | Subagent planning, compaction, evals, and MCP authoring. | [opencode] [claude-code] [codex] [universal] | — | — |

#### RAG, Vector Search & Knowledge Graphs

`skills/data-ai/rag-memory`

Hybrid retrieval, chunking, embeddings, and persistent agent memory.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [RAG & Vector Search Playbook Skill](https://github.com/qdrant/qdrant) | Hybrid retrieval, chunking, embeddings, and agent memory. | [opencode] [universal] | python | — |

#### ML Training, Fine-Tuning & Science

`skills/data-ai/ml-scientific`

LoRA/TRL fine-tuning, benchmark evaluation, bioinformatics, and geospatial analysis.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [ML Fine-Tuning & Evals Skill](https://github.com/huggingface/transformers) | LoRA fine-tuning, benchmark evals, and scientific ML. | [opencode] [universal] | python | — |

### 2.6 Testing, QA & Verification

`skills/testing-qa`

#### Browser & E2E Automation

`skills/testing-qa/browser-e2e`

Playwright, Cypress, Selenium, and visual regression verification.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Playwright E2E Patterns Skill](https://github.com/microsoft/playwright) | Browser automation, fixtures, and visual regression checks. | [opencode] [claude-code] [universal] | typescript | — |

#### Unit, Integration & Property Testing

`skills/testing-qa/unit-property`

Test generation, mutation testing, fuzzing, and deterministic fixtures.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Property & Fuzz Testing Skill](https://github.com/AltSysrq/proptest) | Property tests, mutation testing, and deterministic fixtures. | [opencode] [universal] | rust | — |

## 3. MCP Tools & Servers

`mcp-servers`

Model Context Protocol servers with introspected tool names for fine-grained per-agent scoping.

### Filesystem, Terminal & OS Automation

`mcp-servers/filesystem-shell`

Local file operations, sandboxed command execution, and desktop automation.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Filesystem & Shell MCP Server](https://github.com/modelcontextprotocol/servers) | Sandboxed file operations and command execution over MCP. | [opencode] [claude-code] [codex] | — | 3 tools |

### Git, GitHub & Code Intelligence

`mcp-servers/git-repos`

Repository management, PR workflows, AST search, and LSP bridges.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [GitHub Code Intelligence MCP Server](https://github.com/modelcontextprotocol/servers) | Repo, PR, and issue workflows over MCP with real tool names. | [opencode] [claude-code] | — | 4 tools |

### Databases & Data Warehouses

`mcp-servers/databases`

PostgreSQL, SQLite, ClickHouse, Supabase, Neon, and Redis MCP connectors.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Postgres MCP Connector](https://github.com/kristofer84/mcp-postgres) | Read-only Postgres MCP server with audited tools. | [opencode] [claude-code] | — | 3 tools |

### Browser Automation, Search & Scraping

`mcp-servers/browser-web`

Playwright, Chrome CDP, Firecrawl, Crawlbase, and SerpApi MCP servers.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Firecrawl Scrape MCP Server](https://github.com/mendableai/firecrawl-mcp-server) | Search, scrape, and crawl the web from agents via MCP. | [opencode] [claude-code] | — | 3 tools |

### Security, Reverse Engineering & Analysis

`mcp-servers/security-re`

Ghidra MCP, binary analysis, vulnerability scanners, and log auditing servers.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Ghidra RE MCP Server](https://github.com/LaurieWired/GhidraMCP) | Binary analysis via Ghidra: functions, strings, decompilation. | [opencode] [claude-code] | — | 3 tools |

### Design, Figma & UI Tooling

`mcp-servers/design-ui`

Figma, Stitch, Storybook, and screenshot diffing MCP servers.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Figma Design MCP Server](https://github.com/planetabhi/figma-mcp-server) | Design context, components, and screenshots from Figma. | [opencode] [claude-code] | — | 3 tools |

### Cloud, Containers & Observability

`mcp-servers/cloud-devops`

Cloudflare, Kubernetes, Docker, Sentry, and Datadog MCP servers.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Kubernetes Observability MCP Server](https://github.com/Flux159/mcp-server-kubernetes) | Cluster inspection: pods, deployments, and logs over MCP. | [opencode] [claude-code] | — | 3 tools |

### Knowledge Bases, Docs & Comms

`mcp-servers/knowledge-productivity`

Obsidian, Notion, NotebookLM, Slack, and Google Workspace MCP servers.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Notion Knowledge MCP Server](https://github.com/makenotion/notion-mcp-server) | Docs and knowledge-base search over MCP. | [opencode] [claude-code] | — | 3 tools |

## 4. DESIGN.md Systems

`design-md`

Drop-in DESIGN.md brand and UI system specs (inspired by Google Stitch & VoltAgent/awesome-design-md).

### AI Platforms & Developer Tools

`design-md/ai-dev-tools`

Terminal-first, dark-mode, and high-contrast engineering design systems.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Terminal Dev Design System](https://github.com/Heretek-AI/Agent-Builder) | Terminal-first dark-mode DESIGN.md for dev tools. | [universal] | — | — |

### SaaS, Dashboards & Productivity

`design-md/saas-productivity`

Clean editorial workspaces, data-dense analytics, and collaborative UI systems.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [SaaS Dashboard DESIGN.md](https://github.com/VoltAgent/awesome-design-md) | Clean editorial dashboards and analytics workspace specs. | [universal] | — | — |

### Fintech, Media & Consumer Brands

`design-md/fintech-consumer`

High-trust financial interfaces, editorial media, and consumer web aesthetics.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Fintech Editorial DESIGN.md](https://github.com/VoltAgent/awesome-design-md) | High-trust financial interfaces and editorial media specs. | [universal] | — | — |

## 5. System Prompts & Personas

`prompts`

Curated system prompts, meta-prompts, and reasoning workflows.

### Software Architecture & Code Review Prompts

`prompts/coding-architecture`

System prompts for refactoring, architecture critique, and spec authoring.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Architecture Review Prompt](https://github.com/f/prompts.chat) | Refactoring, architecture critique, and spec authoring prompts. | [universal] [opencode] [claude-code] | — | — |

### Security & Adversarial Audit Prompts

`prompts/security-research`

Red-team, threat-modeling, and multi-subagent code audit prompts.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Adversarial Audit Prompt](https://github.com/Heretek-AI/Agent-Builder) | Red-team multi-subagent code audit prompt. | [opencode] [claude-code] [universal] | — | — |

### Product, UI/UX & Technical Writing Prompts

`prompts/product-design`

Design critique, documentation, and specification interview prompts.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Design Critique Prompt](https://github.com/f/prompts.chat) | Design critique, documentation, and spec-interview prompts. | [universal] | — | — |

## 6. Complete Agent Presets & Multi-Agent Teams

`agents`

Ready-to-run scoped agent configurations combining a prompt, allowed skills, and scoped MCP tools.

### Language & Stack Specialist Agents

`agents/coding-specialists`

Pre-scoped Rust, C++, Python, and Full-Stack subagents.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Full-Stack Polyglot Agent](https://github.com/Shubhamsaboo/awesome-llm-apps) | Pre-scoped Python/TS/Go coding specialist with GitHub MCP. | [opencode] | — | — |

### Security, RE & Malware Triage Agents

`agents/security-auditors`

Least-privilege security auditing and reverse-engineering agents.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [DB Security Auditor Agent](https://github.com/Heretek-AI/Agent-Builder) | Least-privilege database security auditor agent. | [opencode] | — | — |

### UI/UX & Cross-Platform Design Agents

`agents/design-frontend`

Frontend, desktop, and mobile UI builder agents paired with DESIGN.md specs.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [Frontend Design Agent](https://github.com/VoltAgent/awesome-design-md) | UI builder agent pairing WebUI skills with Figma MCP. | [opencode] | — | — |

### DevOps, Database & Research Agents

`agents/devops-data`

Read-only database auditors, SRE responders, and deep-research teams.

| Name | Tagline | Harnesses | Languages/Platforms | Tools |
| --- | --- | --- | --- | --- |
| [SRE Database Responder Agent](https://github.com/open-telemetry/opentelemetry-collector) | Read-only K8s and Postgres responder with SQL audit skills. | [opencode] | — | — |

## Per-Agent Skill & MCP Scoping

Every agent compiled by the Agent Builder WebUI and CLI follows **deny-first context hygiene**: permissions start by denying everything (`deny "*"` first), then explicitly allow only the skills and MCP tools that agent needs. OpenCode evaluates permission rules in order and **the last matching rule wins**, so the deny-all rule must come first.

```json
{
  "agents": {
    "my-agent": {
      "permissions": [
        { "action": "skill", "resource": "*", "effect": "deny" },
        { "action": "skill", "resource": "rust-secure-coding", "effect": "allow" },
        { "action": "postgres-prod_*", "resource": "*", "effect": "deny" },
        { "action": "postgres-prod_execute_query", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

MCP tool names are normalized as `<serverName>_<toolName>` preserving hyphens and underscores (matching upstream OpenCode/Claude Code `mcp__plugin_my-plugin_database-tools__query` style); every other run of non-alphanumeric characters becomes `_` (e.g. server `postgres-prod` + tool `execute_query` → `postgres-prod_execute_query`).

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
