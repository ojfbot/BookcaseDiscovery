import { MemoryLedger } from "../src/ledger/index.ts";
import { ledgerBehaviour } from "./ledger-behaviour.ts";

ledgerBehaviour("MemoryLedger", (options) => new MemoryLedger(options));
