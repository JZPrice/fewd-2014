export const GRID_W = 4;
export const GRID_D = 16;
export const TILE = 1;

// Slide and cooldown match so each step blends into the next - no pause
// between tile transitions while a direction is held.
export const MOVE_COOLDOWN_MS = 220;
export const PLAYER_SLIDE_MS = 220;

export const CUBE_TYPE = {
  NORMAL: "N",
  FORBIDDEN: "F",
  ADVANTAGE: "A",
};

export const COLORS = {
  floor:      0xb8c0d4,
  floorEdge:  0x6b7494,
  normal:     0xe6e8ee,
  forbidden:  0x1a1a22,
  forbiddenAccent: 0xff3030,
  advantage:  0x4cd97a,
  advantageAccent: 0xa9ffc5,
  mark:       0x6bd0ff,
  advMark:    0x8effc0,
  player:     0xffd24c,
  sky:        0x2a3454,
  ground:     0x0a0a12,
  bomb:       0xff5040,
  bombAccent: 0xffaa66,
};

export const FORBIDDEN_HOLE_DEPTH = 3;
