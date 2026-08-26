import path from "path";
import chalk from "chalk";
import { installSkillPack, updateSkillPacks } from "../packs/index.js";

interface PackOptions {
  target?: string;
}

export async function installPackCommand(source: string, options: PackOptions = {}): Promise<void> {
  const pack = await installSkillPack(source, path.resolve(options.target || "."));
  console.log(chalk.green("✓"), `Installed ${pack.name}@${pack.version} (${pack.skills.length} skills).`);
}

export async function updatePacksCommand(name: string | undefined, options: PackOptions = {}): Promise<void> {
  const packs = await updateSkillPacks(path.resolve(options.target || "."), name);
  if (packs.length === 0) {
    console.log(chalk.yellow("No installed skill packs to update."));
    return;
  }
  for (const pack of packs) {
    console.log(chalk.green("✓"), `Updated ${pack.name}@${pack.version}.`);
  }
}
