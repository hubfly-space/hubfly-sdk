// The one React API the `react` entry uses, so the package builds without @types/react.
// React is a peer dependency of the `react` and `next` entries only.
declare module 'react' {
  export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
}
