export const EASE_OUT = ([0.16, 1, 0.3, 1] as const);
export const EASE_IN_OUT = ([0.77, 0, 0.175, 1] as const);
export const DURATION = ({
  entrance: 0.65,
  loop: 3,
  stagger: 0.1
} as const);
export const SPRING_MOUSE = ({
  stiffness: 200,
  damping: 25,
  mass: 0.3
} as const);
