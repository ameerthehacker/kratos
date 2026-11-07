// pino-roll ships no types; the part Kratos uses (D44, 3u3): build a rotating file stream.
declare module "pino-roll" {
  import type { DestinationStream } from "pino";
  export default function roll(options: {
    file: string;
    size?: string;
    limit?: { count: number; removeOtherLogFiles?: boolean };
    symlink?: boolean;
    mkdir?: boolean;
  }): Promise<DestinationStream>;
}
