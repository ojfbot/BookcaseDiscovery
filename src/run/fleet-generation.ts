const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Validate the optional UUID emitted by `fleet-runner restore`. */
export function fleetGeneration(env: NodeJS.ProcessEnv): string | undefined {
  const generation = env.FLEET_GENERATION;
  if (generation === undefined) return undefined;
  if (!GENERATION.test(generation)) throw new Error("invalid fleet generation");
  return generation;
}
