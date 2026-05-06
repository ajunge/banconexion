# Banconexion

CLI for Banco de Chile's business portal automation using Playwright.

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

The CLI needs `BANCO_USERNAME` and `BANCO_PASSWORD` in a `.env` file.

**Option A: Manual**

```bash
cp .env.tpl .env
# Edit .env with your RUT and password
```

**Option B: 1Password CLI**

The `.env.tpl` file contains [1Password secret references](https://developer.1password.com/docs/cli/secret-references/) that point to the `Bancochile Banconexion 2.0` item in the Private vault. Run:

```bash
npm run env
```

This uses `op inject` to resolve the references and write the `.env` file.

## Usage

```bash
node cli.js <command> [options]
```

### Commands

#### `transfer` — Send an express transfer

```bash
node cli.js transfer --to <beneficiary> --amount <amount> [options]
```

| Option                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `--to <name>`         | Beneficiary name (as saved in bank) **(required)**       |
| `--amount <amount>`   | Transfer amount in CLP **(required)**                    |
| `--from <account>`    | Source account number or alias                           |
| `--account <account>` | Beneficiary account filter (for multi-account contacts)  |
| `--message <text>`    | Transfer description                                     |
| `--headless`          | Run without opening a browser window                     |
| `--debug`             | Save screenshots at each step (`debug-*.png`)            |

Example:

```bash
node cli.js transfer --to "Juan Perez" --amount 50000 --from "Cuenta Corriente" --message "Pago servicio"
```

The transfer requires Mi Pass approval on your phone before completing.

#### `balances` — Show account and credit card balances

```bash
node cli.js balances [options]
```

| Option       | Description                            |
| ------------ | -------------------------------------- |
| `--headless` | Run without opening a browser window   |
| `--debug`    | Save screenshots at each step          |
| `--json`     | Output as JSON instead of a table      |

Example:

```bash
node cli.js balances --headless --json
```

Retrieves balances from all accounts (cuenta corriente) and credit cards (national and international).

#### `transactions` — Show transactions for an account or credit card

```bash
node cli.js transactions [--account <number> | --card <last4>] [options]
```

If neither `--account` nor `--card` is given, the currently selected account on the portal is used. The chosen account number is always echoed in the output.

| Option                 | Description                                                                       |
| ---------------------- | --------------------------------------------------------------------------------- |
| `--account <number>`   | Checking account number (e.g. `00-001-70743-06`). Optional — defaults to current. |
| `--card <last4>`       | Credit card last 4 digits                                                         |
| `--billed`             | Credit cards only: show billed transactions instead of unbilled                   |
| `--from <YYYY-MM-DD>`  | Start date (must be combined with `--to`)                                         |
| `--to <YYYY-MM-DD>`    | End date (must be combined with `--from`)                                         |
| `--headless`           | Run without opening a browser window                                              |
| `--debug`              | Save screenshots at each step                                                     |
| `--json`               | Output as JSON instead of a table                                                 |

Examples:

```bash
node cli.js transactions --from 2026-05-01 --to 2026-05-06
node cli.js transactions --account 00-847-02492-10 --from 2026-04-01 --to 2026-04-30
node cli.js transactions --card 1234 --json
node cli.js transactions --card 1234 --billed --from 2026-03-01 --to 2026-03-31
```
