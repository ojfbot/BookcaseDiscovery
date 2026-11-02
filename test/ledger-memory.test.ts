import { MemoryLedger } from "../src/ledger/index.ts";
import { ledgerBehaviour } from "./ledger-behaviour.ts";
import { liveBehaviour } from "./live-behaviour.ts";

ledgerBehaviour("MemoryLedger", (options) => new MemoryLedger(options));
liveBehaviour("MemoryLedger", (options) => new MemoryLedger(options));
