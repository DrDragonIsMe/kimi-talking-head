# Project Principles

## Core Rule

All changes to video generation, rendering, subtitles, talking points, visuals, title/end cards, remote jobs, and pipeline behavior should default to a fully engineered, reusable standard.

## What That Means

- Prefer configuration-driven behavior over one-off hardcoded tweaks.
- Prefer reusable scripts, components, and pipeline steps over case-specific patches.
- Add validation, health checks, and output verification for every critical stage when practical.
- Preserve resume/retry capability and stable automation for long-running jobs.
- When a request starts as a one-off adjustment, look for the right reusable abstraction before shipping it.
- Keep server-side code in this repo (`server/`) so a fresh GPU box can be deployed automatically.
- Keep docs (`README.md`, `RELIABILITY.md`, `.kimi/kimi_pipeline.md`, `server/*.md`) in sync with code changes.

## Anti-Pattern

Avoid solving project requests with temporary single-video hacks unless the user explicitly asks for a disposable experiment.
