// Stage layouts authored for this clone.
// Each layout: array of strings, one per row. First string = furthest back
// (spawns last), last string = closest to player (spawns first into view).
// Columns: left -> right. Chars: N normal, F forbidden, A advantage, . empty.
// Width must equal GRID_W (4).

export const STAGES = [
  {
    id: 1,
    tickMs: 1000,
    waves: [
      {
        layout: [
          "N..N",
          ".NN.",
          "N..N",
          ".NA.",
        ],
      },
      {
        layout: [
          "NN.N",
          "F..N",
          "N.N.",
          ".NNN",
          "N.A.",
        ],
      },
      {
        layout: [
          "NNNN",
          "F..F",
          ".NN.",
          "N..N",
          ".AN.",
          "N.NF",
          ".NN.",
        ],
      },
    ],
  },
  {
    id: 2,
    tickMs: 880,
    waves: [
      {
        layout: [
          "N.FN",
          ".NN.",
          "NF.N",
          ".N.A",
          "NN.N",
          ".N.F",
          "AN.N",
        ],
      },
      {
        layout: [
          "NFNF",
          ".N.N",
          "N.N.",
          "F.AF",
          ".NN.",
          "NFNN",
          ".NAN",
          "FN.F",
        ],
      },
    ],
  },
  {
    id: 3,
    tickMs: 760,
    waves: [
      {
        layout: [
          "NFNF",
          "FNFN",
          "N.A.",
          ".N.N",
          "NF.F",
          ".ANN",
          "FN.N",
          "N.FA",
          ".NNF",
        ],
      },
    ],
  },
];
