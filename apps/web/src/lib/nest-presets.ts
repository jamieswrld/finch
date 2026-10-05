import type { NestManifest } from "@finch/sdk";

/**
 * Built-in swarms.
 *
 * None ship right now. Swarms are composed by the people using Yinsi — in the
 * swarm composer or as a submitted manifest — and run through the same
 * runtime a built-in would. The registry, the directory and the run route all
 * read this list, so adding a preset here makes it appear everywhere at once.
 */
export const NEST_PRESETS: NestManifest[] = [];

export function getNestPreset(id: string): NestManifest | undefined {
  return NEST_PRESETS.find((preset) => preset.identity.id === id);
}
