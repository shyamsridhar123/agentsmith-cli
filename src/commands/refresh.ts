import { assimilateCommand } from "./assimilate.js";

interface RefreshOptions {
  verbose?: boolean;
  output?: string;
}

export async function refreshCommand(target = ".", options: RefreshOptions = {}): Promise<void> {
  await assimilateCommand(target, {
    verbose: options.verbose,
    output: options.output,
    cache: false,
  });
}
