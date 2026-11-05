// hls.js is an optional peer dependency and not installed here; the player only needs its
// constructor shape (HlsConstructor in player.ts).
declare module 'hls.js' {
  const Hls: unknown;
  export default Hls;
}
