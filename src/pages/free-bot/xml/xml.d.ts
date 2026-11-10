// Bot Builder XML files are bundled as text (raw-loader in rsbuild.config.ts)
declare module '*.xml' {
    const xml: string;
    export default xml;
}
