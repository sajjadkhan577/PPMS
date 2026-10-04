# PPMS

## Development

Install dependencies, then run the Vite client and local API in separate terminals:

```powershell
npm install
npm run dev
$env:PPMS_ADMIN_PASSWORD = 'use-a-strong-password'
npm run server
```

The development client runs at `http://localhost:5173/`; the SQLite API listens on loopback at `http://127.0.0.1:8787/`.

In development, SQLite data stays in `data\ppms.sqlite`, backups stay under `backups\Daily`, `backups\Monthly`, and `backups\Safety`, and logs stay under `logs`. Set `PPMS_ADMIN_PASSWORD` before the first `npm run server` if creating a new development database; there is no built-in default password. Existing databases and user accounts are retained.

The Settings screen creates verified SQLite backups. Daily backups use unique timestamped names. Administrators can create a month-end restore point, delete backups with confirmation, and restore a valid backup; every restore first creates a safety backup. Monthly creation never removes daily backups automatically.

## Windows Desktop

Electron starts the bundled local server and opens the built UI at Login. No system Node.js, npm, web server, or internet connection is needed at runtime. The server is bound to `127.0.0.1:8787`; PPMS intentionally uses this fixed local port and reports a startup error if it is unavailable.

Production data is kept separately from the install directory:

```text
%LOCALAPPDATA%\PPMS\data\ppms.sqlite
%LOCALAPPDATA%\PPMS\backups\Daily
%LOCALAPPDATA%\PPMS\backups\Monthly
%LOCALAPPDATA%\PPMS\backups\Safety
%LOCALAPPDATA%\PPMS\logs
```

An existing roaming Electron database or the verified package seed is migrated only when the LocalAppData database does not exist. Migration uses SQLite's online backup operation and does not replace an existing target. `npm run dist:win` builds the existing Windows Electron package from a consistent snapshot of the current database; the generated staging snapshot is removed after packaging. Treat the resulting installer as containing station business data and distribute it accordingly.

`OFFLINE_AUDIT.md` records runtime network dependencies and offline behavior.

## Validation

```powershell
npx tsc --noEmit
npm test
npm run build
npm run dist:win
```

`npm run dist:win` snapshots the existing database through SQLite's online backup API, builds the app, creates the existing Windows NSIS target, and removes the temporary source-tree snapshot afterward. The produced installer carries that database snapshot; distribute it only through the station's approved secure process.
