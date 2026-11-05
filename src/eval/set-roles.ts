// DL-5 · set roles: the one registry of what each fixture, session and evaluation set is for, and the one guard every
// export or training input goes through (OC35). A set is trainable only when it is declared here as a
// `training-source`; a set with no declared role is refused (fail closed), so an evaluation set under a new name is
// never exported by accident. The name test TS-0 used to rely on (`/yardstick|proxy|audit/i`) stays as a second,
// belt-and-braces check: a declared `training-source` named like a yardstick is still refused. Pure. Set and session
// names share one namespace (TS-0 checks a row's set and a manifest photo's session against the same registry).

/**
 * What a set is for. `training-source`: real-use or controlled fixtures whose machine labels may be exported and
 * trained on (OC36: machine labels only). `yardstick`: a set that scores the stack (OC36's yardstick). `proxy`: a
 * public library-shelf dataset the yardstick is drawn from. `audit`: a slice kept back to check labels. `held-out`:
 * data never used to choose anything (F-1, `docs/dataset.md`).
 */
export const SET_ROLES = ["training-source", "yardstick", "proxy", "audit", "held-out"] as const;
export type SetRole = (typeof SET_ROLES)[number];

/** The only role whose sets may be exported for training. */
export const TRAINABLE_ROLES: readonly SetRole[] = ["training-source"];

export type SetRegistry = Readonly<Record<string, SetRole>>;

/**
 * Every set the code names, by role. Add a set here before anything exports or trains on it; until then it is
 * refused. The yardstick's names are its stage caches under the data root (one per box arm and post step).
 */
export const SET_REGISTRY: SetRegistry = {
  // Real use (OC35): the first real-use set; training and evaluation data (its audit slice, O-3a, was withdrawn: OC36).
  "pilot-000": "training-source",
  // The public yardstick (PROXY): the 40-image Library Dataset sample, under every name a card has given it.
  yardstick: "yardstick",
  "yardstick-library": "yardstick",
  "yardstick-library-b1": "yardstick",
  "yardstick-library-b2": "yardstick",
  "yardstick-library-b3": "yardstick",
  "yardstick-library-b4": "yardstick",
  "yardstick-library-b2+extend": "yardstick",
  "yardstick-library-b2+strips": "yardstick",
  "yardstick-b1": "yardstick",
  "yardstick-b2": "yardstick",
  "yardstick-b3": "yardstick",
  "yardstick-b4": "yardstick",
  // The public datasets the yardstick pair is drawn from (H-0): titles and boxes.
  "library-dataset": "proxy",
  "zhong-yang-661": "proxy",
  // F-1: reserved as held-out from the start.
  "sf-store-002": "held-out",
};

/** The second check: a name that reads as a yardstick, PROXY or audit set is never trainable, whatever its role. */
export const NEVER_TRAIN_NAME = /yardstick|proxy|audit/i;

/** A set's declared role, or null when the registry does not name it. */
export function roleOf(set: string, registry: SetRegistry = SET_REGISTRY): SetRole | null {
  return Object.hasOwn(registry, set) ? registry[set]! : null;
}

/** Why a set may not be trained on, or null when it may. */
export function refusal(set: string, registry: SetRegistry = SET_REGISTRY): "undeclared" | "role" | "name" | null {
  const role = roleOf(set, registry);
  if (role === null) return "undeclared";
  if (!TRAINABLE_ROLES.includes(role)) return "role";
  if (NEVER_TRAIN_NAME.test(set)) return "name";
  return null;
}

export const isTrainable = (set: string, registry: SetRegistry = SET_REGISTRY): boolean => refusal(set, registry) === null;

/** OC35: throws unless the set is a declared `training-source` whose name does not read as an evaluation set. */
export function assertTrainable(set: string, card = "TS-0", registry: SetRegistry = SET_REGISTRY): void {
  const why = refusal(set, registry);
  if (why === "undeclared") throw new Error(`${card}: "${set}" has no declared set role and is never exported for training (OC35, fail closed: declare it in src/eval/set-roles.ts)`);
  if (why === "role") throw new Error(`${card}: "${set}" is a ${roleOf(set, registry)} set and is never exported for training (OC35)`);
  if (why === "name") throw new Error(`${card}: "${set}" is named like a yardstick, PROXY or audit set and is never exported for training (OC35)`);
}

/** Registered sets by role (counts only; names are not private, but the report needs only the counts). */
export function setsByRole(registry: SetRegistry = SET_REGISTRY): Record<SetRole, number> {
  const out = Object.fromEntries(SET_ROLES.map((r) => [r, 0])) as Record<SetRole, number>;
  for (const role of Object.values(registry)) out[role]++;
  return out;
}
