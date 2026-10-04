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
- On first packaged startup, if the target database does not exist, the server searches the prior Electron roaming `userData` location and then the verified package snapshot.
- Migration uses SQLite's online backup API so committed WAL content is included. It verifies integrity and required tables before opening the migrated target; the source remains intact.
- If an existing target is invalid, or no usable packaged/legacy database is found, startup fails clearly instead of silently presenting a new empty database.
- Windows package creation snapshots `data/ppms.sqlite` read-only into an ignored build staging directory, checks integrity and the presence of at least one login account, then includes the snapshot as a resource. The live database and its WAL are not placed in the writable install directory.

The Windows package is intended to carry the station's existing database snapshot. Treat the resulting installer as containing business data and distribute it only through the station's approved secure process.

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

- `npm test`: 44 Vitest tests, 4 runtime-path tests, and the desktop-server migration/restart smoke test passed.
- `npm run build`: passed.
- `npm run dist:win`: produced `dist/PPMS Setup 1.0.0.exe` and `dist/win-unpacked/PPMS.exe` with the verified database resource.
- The extracted packaged server was launched from a working directory outside its install tree using a temporary LocalAppData substitute. Migration, the exact health token, local UI serving, SQLite integrity, graceful stop/restart, and record counts passed.
- Electron's embedded Node 22.19.0 exposes `node:sqlite` `DatabaseSync` and `backup`.
- The GUI executable was not launched because an existing `node server.mjs` process owns fixed port 8787; it was not stopped. A physical Wi-Fi-disconnected Login-to-module session was not performed.

These limits mean that offline runtime behavior is supported by source audit and local-server tests, but an actual disconnected Electron GUI session remains to be verified when port 8787 is available.
