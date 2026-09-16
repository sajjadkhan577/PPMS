# PPMS

## Development

Install dependencies, then run the Vite client and API in separate terminals:

```powershell
npm install
npm run dev
$env:PPMS_ADMIN_PASSWORD = 'use-a-strong-password'
npm run server
```

The client runs at `http://localhost:5173/` and the SQLite API runs at `http://localhost:8787/`.

The Settings screen creates verified offline SQLite backups in `Documents\PPMS Backups`, separated into `Daily`, `Monthly`, and `Safety` folders. Daily backups use unique timestamped names. Administrators can create a month-end restore point, delete backups with confirmation, and restore any valid backup; every restore first creates a `PPMS_PreRestore_...db` safety backup. Monthly creation never removes daily backups automatically.

The API creates `data/ppms.sqlite` on first start. The default development account is `admin` with `change-me-now` only when `PPMS_ADMIN_PASSWORD` is not set; change it before any real use. The API provides hashed-password login, sessions, role checks, register-state persistence, and audit records. The browser keeps localStorage as an offline fallback and synchronizes register keys when authenticated to the API.

## Validation

```powershell
npx tsc --noEmit
npm test -- --run
npm run build
```
