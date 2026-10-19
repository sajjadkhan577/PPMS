# PPMS Offline and Electron Production Audit

**Audit date:** 2026-10-03

## Architecture Found

Electron and electron-builder were already configured. `electron/main.cjs` already launched `server.mjs` through Electron's bundled `utilityProcess`, and the server served the built Vite files and local SQLite API. The production path and lifecycle handling were incomplete: the database used Electron's default roaming `userData` directory, backups went to Documents, the server listened on all interfaces, and readiness accepted any HTTP response on the fixed port.

| Area | Production behavior |
| --- | --- |
| UI | Built React/Vite assets from the packaged `dist` directory |
| Local API | Electron starts bundled `server.mjs`; loopback only, fixed port `127.0.0.1:8787` |
| Database | `%LOCALAPPDATA%\PPMS\data\ppms.sqlite` |
| Backups | `%LOCALAPPDATA%\PPMS\backups\Daily`, `Monthly`, and `Safety` |
| Logs | `%LOCALAPPDATA%\PPMS\logs` |
| Login | Existing SQLite users and scrypt hashes; Electron opens the Login view first |
| Packaged runtime | Electron's embedded Node runtime; no system Node/npm required |

Development retains the project-local `data`, `backups`, and `logs` folders. Production does not use `process.cwd()` for application or business-data paths.

## Network Dependencies

| Dependency | Location | Purpose | Required for core PPMS? | Offline replacement / status |
| --- | --- | --- | --- | --- |
| `fetch` to `http://127.0.0.1:8787` | `src/App.tsx` | Existing local authentication, state sync, status, and backup APIs | Yes | Remains local; packaged Electron starts the API automatically |
| Health `fetch` to `http://127.0.0.1:8787/api/health` | `electron/main.cjs` | Verify that this Electron instance's local server is ready before opening the window | Yes | Loopback-only handshake includes a per-launch token |
| Local HTTP listener | `server.mjs` | Serves PPMS assets and the SQLite API | Yes | Binds to `127.0.0.1`, not a public interface |
| `http://` / `https://` package registry URLs | `package-lock.json` | Dependency retrieval during development/build installation | Build-time only | Not present in the packaged runtime; `npm ci` may require network/cache |
| `http://www.w3.org/...` SVG namespace identifiers | Local SVG assets | XML namespace declarations | No network request | Local files; not fetched URLs |

No app runtime `axios`, `XMLHttpRequest`, WebSocket, CDN script/style, remote font/image, cloud database, analytics, telemetry, or external authentication dependency was found in shipped source. The UI font stack uses installed system fonts. Generated browser profiles, `node_modules`, `dist`, and hidden worktrees are not application runtime dependencies.

## Database Safety

- Existing database files are never copied over an existing LocalAppData database.
- On first packaged startup, if the target database does not exist, the server searches supported prior-install database locations. New releases do not package a database seed.
- Migration uses SQLite's online backup API so committed WAL content is included. It verifies integrity and required tables before opening the migrated target; the source remains intact.
- If no target or prior-install database exists, PPMS initializes an empty local database and provides a one-time administrator setup flow. Register data is never seeded with sample or developer records.
- Windows package creation builds the UI and packages the whitelisted application files only. It does not inspect, snapshot, or include `data/ppms.sqlite`, its sidecars, backups, or the ignored `build-seed` folder.

The Windows package contains application code only. Each installation creates or migrates its own database under `%LOCALAPPDATA%\PPMS\data`; different installations do not share data.

## Startup, Port, and Security

- Electron enforces one app instance, starts the local server, waits for the exact per-launch health token, and then opens PPMS.
- Port `8787` is fixed because the current React API client uses that port. If another process owns it, PPMS reports startup failure rather than connecting to that process.
- Server startup/database errors are recorded under the PPMS logs directory; the GUI shows a user-friendly error and log path, not a stack trace.
- The local server is not exposed to the LAN. Existing login and role checks remain in SQLite-backed server routes.
- Closing PPMS requests graceful server shutdown; the main process also has a bounded cleanup timeout.

## Build-Time and Runtime Distinction

The end-user application does not require VS Code, Node.js, npm, source code, Git, a web server installation, or internet. `electron-builder`/Electron downloads and npm registry access can be required on the developer/build machine unless dependencies and Electron binaries are cached. The app itself uses local packaged UI assets, the bundled Electron Node runtime, and local SQLite.

## Verification Status

The source audit confirms the application runtime uses only loopback requests and local assets.

- `npm test`: passed (64 Vitest tests, 4 Electron runtime-path tests, desktop-server migration/restart and clean-install setup smoke test, security API tests, and fleet-credit API tests). The desktop smoke test uses a temporary fixture database, not the project database.
- `npx tsc --noEmit` and `npm run build`: passed.
- `npm run dist:win`: built `release-build/PPMS Setup 1.0.0.exe` for Windows x64 using the configured NSIS target. The installer was 90,251,667 bytes and was not digitally signed.
- The unpacked packaged app and release output were checked for `.sqlite`, `.db`, WAL, and SHM files; none were found. The installer was not launched.
- The isolated desktop-server test verified an empty database starts without seeded users or register state, supports one-time administrator setup, rejects repeated setup, and then allows login.
- The Electron GUI itself and an installed Windows session were not launched or visually tested. Offline Windows GUI operation remains supported by source/configuration and local API tests, but has not been verified by an actual GUI session in this task.
