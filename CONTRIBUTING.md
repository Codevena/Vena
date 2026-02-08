# Contributing to Vena

Thanks for your interest in contributing to Vena! Here's how to get started.

## Development Setup

```bash
# Prerequisites: Node.js >= 20, pnpm >= 9
git clone https://github.com/Codevena/Vena.git
cd Vena
pnpm install
pnpm -r build
pnpm test
```

## Code Style

- **ESM only** — All packages use `"type": "module"`
- **Strict TypeScript** — No `any`, no implicit returns
- **pnpm** — Never use npm or yarn
- **Monorepo** — Changes to `@vena/shared` require rebuilding downstream packages

## Project Structure

The monorepo has 12 packages under `packages/` and one CLI app under `apps/cli/`. Each package is independently buildable and testable.

## Making Changes

1. **Fork and clone** the repository
2. **Create a branch** from `master`: `git checkout -b feat/my-feature`
3. **Make your changes** — keep commits focused and atomic
4. **Write tests** — new features need tests, bug fixes need regression tests
5. **Build and test**: `pnpm -r build && pnpm test`
6. **Open a PR** against `master`

## Commit Messages

- Describe the **why**, not the what
- Keep the first line under 72 characters
- Use imperative mood: "Add feature" not "Added feature"

## Testing

Run the full test suite:

```bash
pnpm test
```

Run tests for a specific package:

```bash
pnpm --filter @vena/core test
```

All PRs must pass the existing 67+ tests. New code should include tests where applicable.

## Package Guidelines

- All packages export from `src/index.ts`
- All packages compile to `dist/` via `tsc`
- Workspace dependencies use `workspace:*`
- Avoid circular dependencies between packages

## Security

If you discover a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/Codevena/Vena/security/advisories) rather than opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
