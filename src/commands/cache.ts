import chalk from "chalk";
import { FileCache } from "../cache/index.js";

export async function clearCacheCommand(): Promise<void> {
  await new FileCache().clear();
  console.log(chalk.green("✓"), "AgentSmith analysis cache cleared.");
}
