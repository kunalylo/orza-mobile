/** Static images bundled by Metro: importing one gives its asset id (for `<Image source>` / `Image.loadAsync`). */
declare module '*.png' {
  const asset: number;
  export default asset;
}
