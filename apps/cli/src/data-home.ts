import { homedir } from "node:os";
import { join } from "node:path";

/** All of Kratos's own data lives here (D44): `kratos.db` and `logs/`. */
export const KRATOS_HOME = join(homedir(), ".kratos");
export const DEFAULT_DB = join(KRATOS_HOME, "kratos.db");
export const DEFAULT_LOG_DIR = join(KRATOS_HOME, "logs");
