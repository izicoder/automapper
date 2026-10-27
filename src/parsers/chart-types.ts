/**
 * StepMania step types and the osu!mania key count each one declares
 * (spec section 5).
 *
 * Data columns run left to right, which is also osu's left to right, so no
 * column permutation is needed: column 0 of the source is column 0 of the
 * output.
 */
export const KEY_COUNT_BY_STEP_TYPE: Record<string, number> = {
  "dance-single": 4,
  "dance-double": 8,
  "dance-couple": 8,
  "dance-solo": 6,
  "dance-threepanel": 3,
  "dance-routine": 8,
  "pump-single": 5,
  "pump-halfdouble": 6,
  "pump-double": 10,
  "pump-couple": 10,
  "pump-routine": 10,
  "kb7-single": 7,
  "ez2-single": 5,
  "ez2-double": 10,
  "ez2-real": 7,
  "para-single": 5,
  "ds3ddx-single": 8,
  "bm-single5": 6,
  "bm-double5": 12,
  "bm-single7": 8,
  "bm-double7": 16,
  "maniax-single": 4,
  "maniax-double": 8,
  "techno-single4": 4,
  "techno-single5": 5,
  "techno-single8": 8,
  "techno-double4": 8,
  "techno-double5": 10,
  "techno-double8": 16,
  "popn-five": 5,
  "popn-nine": 9,
  "lights-cabinet": 8,
};

export function keyCountForStepType(stepType: string): number | undefined {
  return KEY_COUNT_BY_STEP_TYPE[stepType.trim().toLowerCase()];
}

/** Difficulty labels that StepMania allows, mapped to display names. */
export const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  challenge: "Challenge",
  edit: "Edit",
};
