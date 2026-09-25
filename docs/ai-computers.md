# AI Virtual Computers

Every AI employee owns an isolated **virtual computer** (`ai_computers`) created through the
`ComputerProvider` abstraction (`apps/api/src/services/computer`).

| Provider | Status | Capabilities |
|---|---|---|
| `storage_workspace` | **Working** (default) | Isolated file explorer in private storage (`{org}/ai/{employee}/…`), reading permitted shared files, writing workspace files, creating documents and PPTX decks, session logs |
| `e2b` | Architecture only | Sandboxed browser + terminal. Selecting it fails loudly at boot until integrated |

Isolation rules (enforced in code and tested):
- No access to the host filesystem, environment variables or secrets — tools only call scoped services.
- Every query is scoped by `organization_id`; private manager files are unconditionally denied (`aiCanReadFile`).
- Terminal commands always require approval, even for autonomous employees; browser/terminal tools are
  hidden and denied while the provider lacks the capability.

Integration plan for a sandbox provider (E2B or similar):
1. `createSession` → ephemeral VM per work session (no host mounts, no credentials).
2. `terminalCommand` / `browserAction` → proxied with allow-lists, time and output limits.
3. File sync only with the employee workspace prefix.
4. `terminateSession` → destroy VM; usage seconds → `usage_counters('computer_seconds')`.
