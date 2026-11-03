import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginBasicSsl } from './scripts/rsbuild-plugin-basic-ssl';

const path = require('path');

/**
 * Content Security Policy for the page: scripts only from this site (plus Google's Drive picker),
 * network calls only to Deriv, Google Drive and the Kapa Premium server, no plugins, no foreign forms.
 */
const contentSecurityPolicy = () => {
    let kapaApi = '';
    try {
        kapaApi = process.env.KAPA_API_URL ? new URL(process.env.KAPA_API_URL).origin : '';
    } catch {
        throw new Error('KAPA_API_URL must be a full https:// address');
    }
    const google = 'https://apis.google.com https://accounts.google.com';
    return [
        "default-src 'self'",
        // 'unsafe-eval': Bot Builder's strategy interpreter (js-interpreter's bundled acorn) builds functions from strings
        `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${google}`,
        "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com https://cdn.jsdelivr.net",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
        "media-src 'self' blob: https:",
        `connect-src 'self' https://deriv.com https://*.deriv.com wss://*.deriv.com https://*.derivws.com wss://*.derivws.com https://www.googleapis.com https://content.googleapis.com https://accounts.google.com ${kapaApi}`.trim(),
        'frame-src https://www.youtube.com https://iframe.cloudflarestream.com https://charts.deriv.com https://accounts.google.com https://docs.google.com https://content.googleapis.com',
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://deriv.com https://*.deriv.com",
    ].join('; ');
};

export default defineConfig({
    plugins: [
        pluginSass({
            sassLoaderOptions: {
                sourceMap: true,
                sassOptions: {
                    // includePaths: [path.resolve(__dirname, 'src')],
                },
                // additionalData: `@use "${path.resolve(__dirname, 'src/components/shared/styles')}" as *;`,
            },
            exclude: /node_modules/,
        }),
        pluginReact(),
        pluginBasicSsl(),
    ],
    source: {
        entry: {
            index: './src/main.tsx',
        },
        define: {
            'process.env': {
                APP_ENV: JSON.stringify(process.env.APP_ENV),
                PUBLIC_PATH: JSON.stringify(process.env.PUBLIC_PATH || '/'),
                GTM_ID: JSON.stringify(process.env.GTM_ID || ''),
                KAPA_API_URL: JSON.stringify(process.env.KAPA_API_URL || ''),
                CLIENT_ID: JSON.stringify(process.env.CLIENT_ID),
                APP_ID: JSON.stringify(process.env.APP_ID),
                GD_CLIENT_ID: JSON.stringify(process.env.GD_CLIENT_ID),
                GD_APP_ID: JSON.stringify(process.env.GD_APP_ID),
                GD_API_KEY: JSON.stringify(process.env.GD_API_KEY),
            },
        },
        alias: {
            react: path.resolve('./node_modules/react'),
            'react-dom': path.resolve('./node_modules/react-dom'),
            '@/external': path.resolve(__dirname, './src/external'),
            '@/components': path.resolve(__dirname, './src/components'),
            '@/hooks': path.resolve(__dirname, './src/hooks'),
            '@/utils': path.resolve(__dirname, './src/utils'),
            '@/constants': path.resolve(__dirname, './src/constants'),
            '@/stores': path.resolve(__dirname, './src/stores'),
        },
    },
    output: {
        // Serve from a sub-folder (e.g. GitHub Pages project site) when PUBLIC_PATH is set
        assetPrefix: process.env.PUBLIC_PATH || '/',
        copy: [
            {
                from: 'node_modules/@deriv-com/smartcharts-champion/dist/*',
                to: 'js/smartcharts/[name][ext]',
                globOptions: {
                    ignore: ['**/*.LICENSE.txt'],
                },
            },
            { from: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/*', to: 'assets/[name][ext]' },
            {
                from: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/fonts/*',
                to: 'assets/fonts/[name][ext]',
            },
            {
                from: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/shaders/*',
                to: 'assets/shaders/[name][ext]',
            },
            { from: path.join(__dirname, 'public') },
        ],
    },
    html: {
        template: './index.html',
        templateParameters: { CSP: contentSecurityPolicy() },
    },
    server: {
        port: 8443,
        compress: true,
    },
    dev: {
        hmr: true,
    },
    performance: {
        // Configure Rsbuild's native bundle analyzer
        bundleAnalyze:
            process.env.BUNDLE_ANALYZE === 'true'
                ? {
                      analyzerMode: 'server',
                      analyzerHost: 'localhost',
                      analyzerPort: 8888,
                      openAnalyzer: true,
                      generateStatsFile: true,
                      statsFilename: 'stats.json',
                  }
                : undefined,
    },
    tools: {
        // Libraries pull in seven Google Fonts stylesheets with CSS @import, which the browser must fetch
        // one after another before showing text. The page loads only the font it uses (index.html).
        postcss: (_config, { addPlugins }) => {
            addPlugins({
                postcssPlugin: 'kapa-drop-google-font-imports',
                AtRule: {
                    import: (rule: { params: string; remove: () => void }) => {
                        if (/fonts\.googleapis\.com/.test(rule.params)) rule.remove();
                    },
                },
            });
        },
        rspack: {
            plugins: [],
            resolve: {},
            module: {
                rules: [
                    {
                        test: /\.xml$/,
                        exclude: /node_modules/,
                        use: 'raw-loader',
                    },
                ],
            },
        },
    },
});
