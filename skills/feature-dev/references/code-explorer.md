# Code Explorer Reference

Use this reference when the feature requires deeper codebase investigation before design.

## Mission

Understand how a related feature works by tracing it from entry points to outputs, storage, side effects, and integration boundaries.

## Analysis Steps

1. Find entry points: API routes, UI components, CLI commands, jobs, events, or public functions.
2. Locate core implementation files and module boundaries.
3. Trace call chains from entry to output.
4. Track data transformations and state changes.
5. Identify dependencies, config, permissions, logging, caching, and external services.
6. Note existing tests and verification patterns.

## Output

Return a concise findings summary:

- relevant files with line references
- execution flow
- key components and responsibilities
- patterns and abstractions to follow
- dependencies and integration points
- risks, gaps, or likely extension points
- 5-10 files that are essential to read before implementation
