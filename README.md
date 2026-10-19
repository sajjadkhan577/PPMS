# PPMS — Petrol Pump Management System

PPMS is a local-first desktop application for recording and reviewing day-to-day petrol pump operations. It is designed for petrol pump owners, station managers, and operators who need a shared set of station registers on one Windows installation.

Each installation keeps its own SQLite database and backups on that computer. PPMS does not provide cloud synchronization, multi-station hosting, or cross-computer data sharing.

## Features

The current application includes:

- **Dashboard** — date-filtered sales and operating summaries, receivables, fuel performance, fuel stock, fleet usage, and recent activity.
- **Daily Operations** — daily meter and financial review with a printable closing report.
- **Meter Reading** — nozzle readings, shift entries, meter history, and test/calibration records.
- **Fuel Management** — fuel stock, purchases, receiving, and stock adjustments.
- **Sales** — cash and credit fuel sales, discounts, and payment-method fee handling.
- **Customers & Credit** — customer directory, Udhar payments, statements, transaction history, fleet-credit vehicles and allocations, and discount rules.
- **Expenses** — operating expenses and salary records.
- **Mobile Oil** — mobile-oil sales register.
- **Commission** — commission records and reports.
- **Safety Duty** — safety-duty readings and summaries.
- **Reports and Accounting** — operational reports, financial summaries, and accounting registers available in the application.
- **Settings** — Station Profile, user and role management, payment-fee configuration, bank accounts, and register backup/restore controls.

Administrators can configure a **Station Profile** (business name, branch, phone, and address). It is saved in that installation's local database and displayed in the application and printable reports. Register resets preserve the profile.

The packaged application runs its local Node.js service on loopback and stores production data under `%LOCALAPPDATA%\PPMS`. The core application does not require an internet connection after installation. Windows installer creation and dependency installation are development-time operations and may require internet access.

### Screenshots

Genuine application screenshots have not yet been added. This section will be updated when screenshots of the current application are available.

## Windows installer

**[Visit PPMS GitHub Releases](https://github.com/sajjadkhan577/PPMS/releases)**

The Releases page is the intended location for downloadable Windows installers. A download is available only after a real installer has been uploaded to a published release. No release version or installer asset is claimed here.

When an installer is published:

1. Download the `.exe` asset from the Releases page.
2. Run it and follow the Windows installer prompts. The installer lets you choose an installation directory and offers desktop and Start Menu shortcuts.
3. Launch PPMS. A new installation creates its database in `%LOCALAPPDATA%\PPMS\data\ppms.sqlite` and opens a one-time administrator setup form. Create and securely retain the administrator credentials.
4. Sign in and set the pump's details under **Settings → Station Profile**.
5. Create and verify a backup before beginning operational use.

PPMS currently does not configure Windows code signing. Windows may display a publisher or SmartScreen warning for an installer; verify that any download comes from the linked repository release before running it.

### Local data and backups

For a packaged Windows installation, PPMS stores:

```text
%LOCALAPPDATA%\PPMS\data\ppms.sqlite
%LOCALAPPDATA%\PPMS\backups\Daily
%LOCALAPPDATA%\PPMS\backups\Monthly
%LOCALAPPDATA%\PPMS\backups\Safety
%LOCALAPPDATA%\PPMS\logs
```

The installer is built without a database or station-data seed. Existing supported installations can migrate a prior local database when the new LocalAppData database is absent; an existing target database is not replaced. The installer does not synchronize data with other computers. Keep backups in a secure location and periodically verify that they can be restored.

## Development

### Requirements

- Windows for building the configured NSIS installer.
- Node.js with support for the built-in `node:sqlite` module.
- npm.

### Install and run

```powershell
npm ci
npm run dev
```

In a second terminal, start the local API:

```powershell
$env:PPMS_ADMIN_PASSWORD = 'choose-a-strong-local-development-password'
npm run server
```

The Vite development client is available at `http://localhost:5173/`. The API listens on `http://127.0.0.1:8787/`. In development, the database, backups, and logs are kept in the project folders `data\`, `backups\`, and `logs\`. Do not use or publish a development database as an installer seed.

### Validate and build

```powershell
npx tsc --noEmit
npm test
npm run build
```

To build the Windows installer on a Windows build machine:

```powershell
npm run dist:win
```

This builds the Vite client and uses electron-builder's configured Windows NSIS target. The package step does not snapshot the project database or include `build-seed`; it creates an installer that initializes a clean database on first run. Build output is written to the ignored `release-build\` folder.

## Troubleshooting

- **PPMS cannot start its local service:** the packaged application uses fixed loopback port `127.0.0.1:8787`. Check whether another application already owns that port and consult `%LOCALAPPDATA%\PPMS\logs`.
- **First-run administrator setup does not appear:** setup is available only for a new packaged installation with no user accounts. For an existing installation, sign in with its existing account or use the supported recovery/backup procedure.
- **Login fails:** verify the username and password. PPMS does not ship a shared default administrator password.
- **Build or tests fail:** run `npm ci`, then rerun the failing command and include its output when reporting the problem.

## Support and issue reports

Report reproducible defects or feature requests through [GitHub Issues](https://github.com/sajjadkhan577/PPMS/issues). Include the PPMS version, Windows version, steps to reproduce, and relevant error text. Do not attach databases, backups, credentials, customer details, or other private station information.

## Technology

- Electron 36 and electron-builder (Windows NSIS installer)
- React 19 and TypeScript
- Vite 8
- Node.js built-in HTTP server and `node:sqlite`
- Vitest

See [OFFLINE_AUDIT.md](./OFFLINE_AUDIT.md) for the source-level offline/runtime architecture review and [PPMS_User_Guide.html](./PPMS_User_Guide.html) for the operational guide.
