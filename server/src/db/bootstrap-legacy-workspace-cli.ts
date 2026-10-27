import { loadConfig } from "../config.js";
import {
  bootstrapLegacyWorkspace,
  LEGACY_WORKSPACE_ID,
} from "../workspaces/repository.js";
import { createPool } from "./pool.js";

const USAGE = `Usage:
  npm run db:bootstrap-legacy -- --user-id <uuid> --confirm
  npm run db:bootstrap-legacy -- --user-email <email> --confirm

This one-time local-development command assigns the existing legacy workspace
to exactly one already-registered account. It refuses to run if the workspace
already has a member or if the selector is missing or ambiguous.`;

function readArguments(argv: string[]): {
  userId?: string;
  userEmail?: string;
  confirm: boolean;
} {
  let userId: string | undefined;
  let userEmail: string | undefined;
  let confirm = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--confirm") {
      confirm = true;
      continue;
    }

    if (argument === "--user-id" || argument === "--user-email") {
      const value = argv[index + 1]?.trim();

      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }

      if (argument === "--user-id") {
        userId = value;
      } else {
        userEmail = value;
      }

      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { userId, userEmail, confirm };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const options = readArguments(argv);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    const context = await bootstrapLegacyWorkspace(pool, options);
    console.log(
      `Legacy workspace ${context.workspace.id} is now the default workspace for the selected account.`,
    );
    console.log(
      `Workspace name: ${context.workspace.name}; role: ${context.membership.role}.`,
    );
    console.log(
      `Legacy workspace id: ${LEGACY_WORKSPACE_ID}. Re-running this command will be refused.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Legacy workspace bootstrap failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
