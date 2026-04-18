# AGENTS.md

## Project Snapshot
- This repository is a desktop app with a React renderer and an Electron shell.
- Renderer entry points live in `src/`, starting from `src/main.tsx` and `src/App.tsx`.
- Electron-specific code lives in `electron/`, with the main process in `electron/main.ts`.
- The preload and bridge layers live in `electron/preload.ts` and `electron/bridge.ts`.

## Default Commands
- Install dependencies with `npm install`.
- Start local development with `npm run dev`.
- Build the renderer and Electron bundles with `npm run build`.
- Use `npm run build` as the default verification step because there is no test suite yet.

## Working Rules
- Keep browser-safe UI code in `src/`.
- Keep Node and Electron APIs inside `electron/`.
- Prefer small, focused edits over broad refactors.
- Do not add dependencies unless they are necessary for the task.
- Preserve the existing Vite and Electron structure unless the task requires changing it.

## Delivery Expectations
- Run `npm run build` after meaningful code changes when possible.
- Call out any manual verification steps for Electron behavior that the build does not cover.
- Keep docs and scripts in sync with the current repo layout.

## OpenAI Docs
- Always use the OpenAI developer documentation MCP server if you need to work with the OpenAI API, ChatGPT Apps SDK, Codex, or related docs without me having to explicitly ask.
