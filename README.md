# Banconexion

CLI tool to automate express transfers on Banco de Chile's business portal using Playwright.

## Setup

### Prerequisites

- Node.js
- [1Password CLI](https://developer.1password.com/docs/cli/) (optional, for credential injection)

### Install

```bash
npm install
npx playwright install chromium
```

### Configure credentials

Copy the template and fill in your credentials:

```bash
cp .env.tpl .env
```

Or inject from 1Password:

```bash
npm run env
```

## Usage

```bash
node transfer.js --to <beneficiary> --amount <amount> [options]
```

### Required options

| Option              | Description                          |
| ------------------- | ------------------------------------ |
| `--to <name>`       | Beneficiary name (as saved in bank)  |
| `--amount <amount>` | Transfer amount in CLP               |

### Optional flags

| Option                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `--from <account>`    | Source account number or alias                           |
| `--account <account>` | Beneficiary account filter (for multi-account contacts)  |
| `--message <text>`    | Transfer description                                     |
| `--headless`          | Run without opening a browser window                     |
| `--debug`             | Save screenshots at each step (`debug-*.png`)            |

### Example

```bash
node transfer.js --to "Juan Perez" --amount 50000 --from "Cuenta Corriente" --message "Pago servicio"
```

The transfer requires Mi Pass approval on your phone before completing.
