#!/usr/bin/env node

require("dotenv").config();
const { program } = require("commander");

program
  .name("banconexion")
  .description("CLI for Banco de Chile business portal automation")
  .version("1.0.0");

require("./commands/transfer")(program);
require("./commands/balances")(program);
require("./commands/transactions")(program);

program.parse();
