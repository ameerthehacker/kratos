#!/usr/bin/env node
import { Command } from "commander";
import { DEFAULT_PORT } from "@kratos/core";
import { startServer } from "./server.js";

const program = new Command()
  .name("kratos")
  .description("Mindful, controllable coding-agent harness")
  .option("-p, --port <number>", "port for the local web UI", String(DEFAULT_PORT))
  .action(async (opts: { port: string }) => {
    const server = await startServer({ port: Number(opts.port) });
    console.log(`kratos running at http://localhost:${server.port}`);
  });

await program.parseAsync();
