<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

# ReplyPilot — Agent Instructions

## Product goal

ReplyPilot is an AI-assisted lead-management tool for small service businesses, initially event photographers and event vendors. The MVP should help a business owner record enquiries, identify missing information, draft replies from the business's real service details, and manage follow-up reminders. The owner remains in control of customer-facing actions.

Build a small, reliable product that can be validated with real users. Do not add complex agent frameworks or broad features before the core workflow works.

## Current project context

- The project was created with Next.js, React, TypeScript, Tailwind CSS, and the App Router.
- The home-page dashboard is in `src/app/page.tsx`.
- The current dashboard uses sample leads and React state. Data does not persist after a reload.
- Treat the API, database, AI provider, authentication, and WhatsApp integration as unimplemented until repository inspection proves otherwise.
- The intended future backend is Node.js + Express, with PostgreSQL for persistent data. Inspect the repository before choosing where or how to add it.

## Required workflow

1. **Inspect before editing.** Check the current directory, `git status`, `package.json`, project structure, configuration, existing tests, and relevant files. Read existing instructions before changing anything.
2. **Plan the smallest useful change.** State the intended steps briefly. Keep each task focused; do not attempt to build the entire product in one pass.
3. **Preserve working behaviour.** Reuse existing patterns, styling, and dependencies where reasonable. Do not rewrite files or restructure the repository without a clear need.
4. **Implement, then verify.** Run the relevant lint, type-check, test, or build commands that actually exist in `package.json`. If a command is unavailable, inspect the scripts and report that fact rather than silently changing project configuration.
5. **Review the diff.** Check `git diff` and `git status` for unintended changes, exposed secrets, incomplete code, and generated files.
6. **Report honestly.** Summarize changed files, behaviour added, checks run and their results, known limitations, and anything not tested. Never claim a feature or test works without verifying it.

## Coding conventions

- Use TypeScript for application and backend code; avoid `any` unless there is a justified, documented reason.
- Keep components and modules focused. Extract reusable code when doing so genuinely improves clarity.
- Follow the installed framework versions and the repository's existing conventions. Consult current official documentation when behaviour depends on a version-specific API.
- Validate external input at system boundaries. If Zod is already installed, use it consistently; otherwise assess whether adding it is warranted before installing anything.
- Keep secrets and API keys on the server. Never put private credentials in client components, source files, logs, or committed environment files. Use placeholder values in `.env.example` only.
- Prefer accessible controls, semantic HTML, clear loading/error/empty states, and responsive layouts.
- Avoid unnecessary dependencies. Ask before introducing paid services, usage-based APIs, major infrastructure, or substantial new frameworks.

## AI and automation safety

- AI output is untrusted input. Validate its structure and values before storing or using it.
- Use deterministic application code—not an LLM—for authentication, authorization, tenant isolation, price calculations, approval checks, and message sending rules.
- Never invent a business's service, price, availability, policy, or booking confirmation. Use saved business data; ask a clarifying question when required information is missing.
- Keep human approval before sending customer-facing messages or performing other consequential external actions in the MVP.
- Clearly label sample data, mocks, and development-only integrations. Never present a stub as a completed AI, WhatsApp, database, or scheduling integration.
- For multi-business data, scope every relevant read and write to the authenticated business/organization. Do not rely only on frontend filtering for access control.
- Avoid logging unnecessary customer personal information. Use fictional data during early development.
- Before implementing WhatsApp messaging, review current official platform policies, opt-in rules, template requirements, webhook verification, duplicate webhook handling, and delivery failures.

## Architecture guidance

- Keep the current Next.js app working while extending it incrementally.
- When adding Express, separate request handling, validation, business logic, and database access where that separation remains practical at this project's size.
- Use PostgreSQL for durable application records; introduce migrations or another explicit, repeatable schema-management method rather than relying on ad hoc production schema changes.
- Make webhook processing idempotent where retries could otherwise create duplicate records or messages.
- Do not add Redis, a vector database, multi-agent orchestration, or a queue until a measured requirement justifies it.
- Keep external side effects behind clear server-side functions with authorization, validation, error handling, and audit-friendly outcomes.

## Scope and approval boundaries

- Do not silently change the product direction, rename the project, replace the UI wholesale, or introduce speculative features.
- Do not delete user data, overwrite unrelated work, rotate credentials, push commits, deploy services, or run destructive commands without explicit approval.
- Do not install packages or run migrations just because they might be useful; first explain why they are needed and prefer existing tools where sufficient.
- If an important requirement is unclear, inspect the project and make a conservative choice. Ask only when the uncertainty materially blocks a safe implementation.

## Verification baseline

Before running checks, inspect the project's actual scripts. Use applicable checks such as:

- `npm run lint` (if defined)
- `npx tsc --noEmit` (if applicable to the current TypeScript setup)
- the project's existing test command (if present)
- `npm run build` (when appropriate and feasible)

Do not claim the app is production-ready solely because it compiles. Distinguish automated checks from manual browser testing and untested external integrations.

<!-- END:nextjs-agent-rules -->