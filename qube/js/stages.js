// Stage layouts authored for this clone.
// Each layout: array of strings, one per row. First string = furthest back
// (spawns last), last string = closest to player (spawns first into view).
// Columns: left -> right. Chars: N normal, F forbidden, A advantage.
// Every cell is filled - no gaps. Width must equal the stage's gridW.

export const STAGES = [
  {
    id: 1,
    tickMs: 2000,
    rollMs: 1000,
    gridW: 4,
    gridD: 16,
    waves: [
      {
        layout: [
          "NNNN",
          "NNNN",
          "NNAN",
          "NNNN",
        ],
      },
      {
        layout: [
          "NNNN",
          "NFNN",
          "NNNN",
          "NNAN",
          "NNNN",
        ],
      },
      {
        layout: [
          "NNNN",
          "FNNN",
          "NNAN",
          "NNNN",
          "NNNF",
          "NNNN",
        ],
      },
      {
        layout: [
          "NNNN",
          "FNNF",
          "NNAN",
          "NNFN",
          "NNNN",
          "NANN",
          "NNNF",
          "NNNN",
        ],
      },
    ],
  },
  {
    id: 2,
    tickMs: 2000,
    rollMs: 1000,
    gridW: 5,
    gridD: 20,
    waves: [
      {
        layout: [
          "NNNNN",
          "NFNNN",
          "NNNAN",
          "NNNNN",
          "NNFNN",
          "NANNN",
        ],
      },
      {
        layout: [
          "NNFNN",
          "NNNNN",
          "NFNAN",
          "NNNNN",
          "NNNFN",
          "NANNN",
          "NNANN",
        ],
      },
      {
        layout: [
          "NFNFN",
          "NNNNN",
          "FNANF",
          "NNNNN",
          "NFNFN",
          "NANAN",
          "NNFNN",
          "NNNNN",
        ],
      },
      {
        layout: [
          "NFNFN",
          "ANNNA",
          "FNNNF",
          "NNANN",
          "NFNFN",
          "NNNAN",
          "FNFNF",
          "NANNN",
          "NNNNN",
        ],
      },
    ],
  },
  {
    id: 3,
    tickMs: 2000,
    rollMs: 1000,
    gridW: 6,
    gridD: 24,
    waves: [
      {
        layout: [
          "NNNNNN",
          "NFNNAN",
          "NNNNFN",
          "ANNNAN",
          "NNFNNN",
          "NNNANN",
        ],
      },
      {
        layout: [
          "NFNNFN",
          "NNANNN",
          "FNNNAF",
          "NNNANN",
          "NFNFNN",
          "NNANFA",
          "FNNFNN",
        ],
      },
      {
        layout: [
          "NFNFNF",
          "NNANNN",
          "FNNNAF",
          "NNNNFN",
          "NFNANF",
          "NNNANN",
          "FNFNFA",
          "NNNANN",
        ],
      },
      {
        layout: [
          "NFNFNF",
          "ANNANN",
          "FNFNFA",
          "NNNANN",
          "NFNFNF",
          "NNANNA",
          "FNFNFN",
          "NANNAN",
          "NFNFNF",
          "NNANNN",
        ],
      },
    ],
  },
];
