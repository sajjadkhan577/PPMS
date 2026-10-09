# Server-side permissions

The server derives permissions from the authenticated SQLite user role. Client-side navigation and button visibility are usability controls only; every API route enforces its own permission checks.

## Register stores

For ordinary list registers, operators may read, create, and edit records, but may not remove existing records. Managers may read, create, edit, and delete ordinary records. Administrators may perform all of those operations. Reset and restore are separate destructive operations and are administrator-only.

Sales and customer removals are excluded from generic register replacement for every role. They must use their guarded delete endpoints; customer balance/history checks and sale-linked receivable checks are enforced there.

| Register key | Read | Create | Edit | Delete | Reset | Restore |
| --- | --- | --- | --- | --- | --- | --- |
| `meters` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `meter-calibrations` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `sales` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager (dedicated guarded endpoint) | Admin | Admin |
| `customers` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager (only without balance/history) | Admin | Admin |
| `udhar-transactions` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `expenses` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `purchases` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `oil-sales` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `stock-adjustments` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `fleet-vehicles` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `fleet-allocations` | Admin, manager, operator | Admin, manager, operator | Admin, manager, operator | Admin, manager | Admin | Admin |
| `commission-records` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `discount-rules` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `payment-fees` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `bank-accounts` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `brs-records` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `family-adjustments` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `stock-openings` | Admin, manager | Admin, manager | Admin, manager | Admin, manager | Admin | Admin |
| `employee-salaries` | Admin | Admin | Admin | Admin | Admin | Admin |

## Other API operations

| Operation | Allowed roles |
| --- | --- |
| Login, logout, and read/change the authenticated user's own credentials | All authenticated roles (login is public) |
| Read system status or list/create daily backups | Manager, administrator |
| Create monthly backups, delete backups, restore a database, restore register backup, or reset register data | Administrator |
| Read/create users | Administrator |
| Delete a sale or customer | Manager, administrator, subject to server-side financial-history checks |
| Health handshake and static application files | Public; these do not expose register data |

Register saves use monotonically increasing per-key versions and SQLite write transactions. Missing or stale versions are rejected; reset and restore increment versions so a pre-operation client cannot accidentally reuse a stale revision.
