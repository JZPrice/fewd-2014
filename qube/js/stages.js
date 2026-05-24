// Stage layouts authored for this clone.
// Each layout: array of strings, one per row. First string = furthest back
// (spawns last), last string = closest to player (spawns first into view).
// Columns: left -> right. Chars: N normal, F forbidden, A advantage.
// Every cell is filled - no gaps. Width must equal GRID_W (4).

export const STAGES = [
  {
    id: 1,
    tickMs: 2000,
    rollMs: 1000,
    waves: [
      {
        layout: [
          "NNNN",
          "NNNN",
          "NNNN",
          "NNAN",
        ],
      },
      {
        layout: [
          "NNNN",
          "FNNN",
          "NNNN",
          "NNNN",
          "NNAN",
        ],
      },
      {
        layout: [
          "NNNN",
          "FNNF",
          "NNNN",
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
    tickMs: 1600,
    rollMs: 800,
    waves: [
      {
        layout: [
          "NNFN",
          "NNNN",
          "NFNN",
          "NNNA",
          "NNNN",
          "NNNF",
          "ANNN",
        ],
      },
      {
        layout: [
          "NFNF",
          "NNNN",
          "NNNN",
          "FNAF",
          "NNNN",
          "NFNN",
          "NNAN",
          "FNNF",
        ],
      },
    ],
  },
  {
    id: 3,
    tickMs: 1200,
    rollMs: 600,
    waves: [
      {
        layout: [
          "NFNF",
          "FNFN",
          "NNAN",
          "NNNN",
          "NFNF",
          "NANN",
          "FNNN",
          "NNFA",
          "NNNF",
        ],
      },
    ],
  },
];
