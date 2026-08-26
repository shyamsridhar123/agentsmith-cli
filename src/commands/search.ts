/**
 * Search Command
 * Query the skills and agents registry
 */

import chalk from "chalk";
import { Registry } from "../registry/index.js";

interface SearchOptions {
  limit?: string;
  type?: "skill" | "agent";
}

export async function searchCommand(query: string, options: SearchOptions): Promise<void> {
  const limit = parseInt(options.limit || "10", 10);
  const cwd = process.cwd();

  const registry = new Registry(cwd);
  const results = await registry.search(query, { type: options.type, limit });

  if (results.length === 0) {
    const typeLabel = options.type ? `${options.type}s` : "entries";
    console.log(chalk.yellow(`No ${typeLabel} found matching "${query}"`));
    return;
  }

  console.log(
    chalk.white("\n┌────────┬─────────────────┬──────────────────────────────────────────────────┐")
  );
  console.log(
    chalk.white("│ Type   │ Name            │ Description                                      │")
  );
  console.log(
    chalk.white("├────────┼─────────────────┼──────────────────────────────────────────────────┤")
  );

  for (const result of results) {
    const type = (result.type || "skill").padEnd(6).slice(0, 6);
    const name = result.name.padEnd(15).slice(0, 15);
    const desc = result.description.slice(0, 48).padEnd(48);
    const typeColor = result.type === "agent" ? chalk.cyan : chalk.magenta;
    console.log(chalk.white(`│ ${typeColor(type)} │ ${name} │ ${desc} │`));
  }

  console.log(
    chalk.white("└────────┴─────────────────┴──────────────────────────────────────────────────┘\n")
  );
}
