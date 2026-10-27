/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
/**
 * Data model for the key-count conversion ported from rizu vsrg
 * (https://github.com/semyon422/rizu, GPL-3.0; see LICENSE and NOTICE).
 *
 * Column indices are 1-based here, exactly like the Lua sources, and are
 * converted to osu's 0-based columns only at the edge (transform/automap.ts).
 * Times are whole milliseconds, as in rizu.
 */

/** Anything the preprocessor can lay out into lines and lanes. */
export interface PreprocessItem {
  startTime: number;
  endTime: number;
  /** 1-based source column. */
  columnIndex: number;
  baseColumnIndex: number;
  /** Pseudo entry for a long note that is still being held. */
  type?: "body" | "tail";
  /** For pseudo entries: the long note (or block) they belong to. */
  note?: PreprocessItem;
  line?: Line;
  /** Index of the line this item sits on. */
  lanePos?: number;
  /** Column of the item on its line. */
  linePos?: number;
  left?: PreprocessItem;
  right?: PreprocessItem;
  /** Nearest real note above and below in the same source lane. */
  top?: PreprocessItem;
  bottom?: PreprocessItem;
  /** Column distance to every other item on the same line. */
  distance?: Map<PreprocessItem, number>;
  locked?: boolean;
  /** Lane search state, used by the upscaler. */
  seeker?: LaneSeeker;
}

/** Backtracking state of `SolutionSeeker` for one item. */
export interface LaneSeeker {
  /** 0 = free, 1 = taken in this branch, -1 = rejected by backtracking. */
  lanes?: number[];
  rates?: { lane: number; rate: number }[];
  lane?: number;
}

/** One source note after it has been turned into automapper data. */
export interface RizuNote extends PreprocessItem {
  /** End time of the long note in the source; `endTime` may get shortened. */
  baseEndTime: number;
  long: boolean;
  /** Target column, 1-based. Set by the reductor. */
  reducedColumnIndex?: number;
  /** Expansion: block this note belongs to. */
  block?: NoteBlock;
  blockStart?: boolean;
}

/** A run of notes that repeats across lanes; the unit the upscaler moves. */
export interface NoteBlock extends PreprocessItem {
  notes: RizuNote[];
  size: number;
}

/** One time position with every item that starts there, sorted by column. */
export interface Line {
  startTime: number;
  items: PreprocessItem[];
  prev?: Line;
  next?: Line;
  first?: Line;
  last?: Line;
  /** Lines of the whole chart, shared so reducers can walk them. */
  lines?: Line[];

  /** LinePreReductor. */
  baseLine?: Line;
  time?: number;
  noteCount?: number;
  shortNoteCount?: number;
  longNoteCount?: number;
  combination?: number[];
  overlap?: number[];
  baseNotes?: PreprocessItem[];
  maxReducedNoteCount?: number;

  /** NoteCountReductor. */
  reducedNoteCount?: number;
  pair1?: LinePair;
  pair2?: LinePair;

  /** LineBalancer. */
  bestLineCombination?: number[];
  bestLineCombinationIndex?: number;
  appliedLineCombinationIndex?: number;

  /** NoteApplyer. */
  appliedSuggested?: Record<number, PreprocessItem>;
  reducedNotes?: PreprocessItem[];
}

/** The two lines a note-count decision belongs to. */
export interface LinePair {
  index: number;
  line1: Line;
  line2: Line;
  /** combinations[line1NoteCount][line2NoteCount]. */
  combinations?: Map<number, Map<number, PairCombination>>;
  jackCount?: number;
  overlapsCount?: number;
  preReducedJackCount?: number;
  bestLine2NoteCount?: number;
  reducedJackCount?: number;
}

/** How many notes two neighbouring lines keep. */
export interface PairCombination {
  j: number;
  k: number;
  /** How well the reduced note ratio matches the source ratio, 0..1. */
  ratio: number;
  sum: number;
}

/** A pair of columns in a target line, e.g. [1, 3] means notes in 1 and 3. */
export type LineCombination = number[];
