# Security Policy

## Supported Versions

Norevinq is currently a pre-1.0 preview. Security fixes are applied to the latest `main` branch and the most recent published preview release. Older snapshots are not maintained separately.

## System and Scope

Norevinq is a local desktop coding-agent client for macOS and Windows. This policy covers application source, preload/IPC contracts, local persistence, app-server and Codex Security adapters, Git/worktree operations, the integrated terminal, file/media preview, and the isolated local-web preview.

The product is not an internet service. Remote model responses, MCP servers, repository contents, Git metadata, terminal output, local web pages, filenames, generated patches, Security artifacts, and all Renderer-originated IPC payloads are untrusted inputs.

## Threat Model and Trust Boundaries

Protected assets include provider credentials, ChatGPT/Codex authentication state, files outside an explicitly opened project or managed worktree, scan outputs, terminal contents, Git integrity, approval decisions, and operating-system capabilities.

The Electron main process, bundled preload, and explicitly discovered Codex/Codex Security binaries are trusted components. The main Renderer is less privileged and may request only the typed IPC capabilities exposed by preload. Local preview WebContents, repository files, agents, tools, MCP servers, and model output are never trusted as authority.

An attacker may control a repository and its filenames, symlinks, Git data, diffs, media, local preview page, MCP/tool result, model event stream, or malformed IPC/protocol payload. Same-user direct modification of application code or the operating-system credential store is not assumed preventable, but such access does not make cross-project reads, silent credential disclosure, or privilege expansion acceptable.

## Security Invariants

- Only the current main-window top frame may invoke Norevinq IPC handlers; preview and future auxiliary WebContents fail closed.
- Renderer payloads are schema-validated and cannot supply executable shell strings or arbitrary local paths to privileged operations.
- Project, worktree, scan-artifact, diff, and preview paths remain inside their authorized canonical root. Symbolic links and file replacement cannot turn a valid token into an out-of-root read.
- Child processes use argument arrays, bounded output/time, noninteractive credentials, and a minimal environment. Provider secrets are never persisted in source, SQLite, logs, or Renderer-readable state.
- Agent command/file changes, MCP calls, external file opening, destructive diff operations, and Security patching require the documented approval or confirmation policy. A crash must never replay a side-effecting active turn.
- Main Renderer and local preview content have no Node integration. Navigation, permissions, downloads, popups, and protocols are allowlisted; public pages are opened only in the system browser.
- Untrusted streams, logs, files, diffs, terminal output, protocol lines, tasks, and scan artifacts have explicit size/count/time budgets.
- Completed Security results must satisfy the sealed SDK contract. Partial, cancelled, over-budget, or unauthorized scans are not imported as findings.

## Reportable Findings and Severity Context

Report concrete violations of the invariants above with an attacker-controlled entry point, reachable sensitive operation, and meaningful confidentiality, integrity, availability, or authorization impact. Cross-project file access, credential exposure, silent execution, approval bypass, Renderer-to-main privilege escalation, local-preview escape, unsafe update/package execution, and repeatable resource exhaustion are reportable.

Severity must reflect the local desktop boundary and prerequisites. A repository-triggered main-process compromise or credential theft can be high severity. A same-user-only behavior without privilege gain is normally low or non-reportable unless it crosses an explicit project, approval, or secret boundary.

## Out of Scope and Limitations

- Vulnerabilities in OpenAI, DeepSeek, Git, Electron, operating-system, or MCP services with no Norevinq-specific vulnerable integration path belong upstream.
- Model prompt injection without a bypass of Norevinq approval, sandbox, project-root, or credential controls is not by itself a product vulnerability.
- Code signing, notarization, and Windows signing cannot be fully verified without external certificates and target-platform release infrastructure; configuration errors in Norevinq's release scripts remain in scope.
- Denial of service requiring the user to intentionally run an unrestricted command is not reportable unless Norevinq silently expands that authority or fails a documented resource boundary.

## Reporting

Do not publish suspected vulnerabilities or secrets in public issues. Use the repository Security page and select **Report a vulnerability** to create a private GitHub Security Advisory:

https://github.com/xingchen20lj/norevinq-desktop/security/advisories/new

Include the affected version, attacker prerequisites, minimal reproduction, expected security boundary, actual result, impact, and any proposed remediation. Use synthetic data wherever possible. Never include real API keys, authentication databases, unrelated user files, private repository content, or destructive proof-of-concept steps.

If private vulnerability reporting is temporarily unavailable while the repository visibility is being changed, keep the report private and retry after the repository owner enables the Security Advisory endpoint. Do not fall back to a public Issue.
