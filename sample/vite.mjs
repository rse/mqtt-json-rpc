
import * as Vite             from "vite"
import { tscPlugin }         from "@wroud/vite-plugin-tsc"
import { viteSingleFile }    from "vite-plugin-singlefile"
import { nodePolyfills }     from "vite-plugin-node-polyfills"

export default Vite.defineConfig(({ command, mode }) => ({
    logLevel: "info",
    appType:  "custom",
    base:     "",
    root:     "",
    plugins: [
        tscPlugin({
            tscArgs:        [ "--project", "tsc.json" ],
            packageManager: "npx",
            prebuild:       true
        }),
        nodePolyfills(),
        viteSingleFile()
    ],
    build: {
        rollupOptions: {
            external: []
        },
        lib: {
            entry:    "sample-client.js",
            formats:  [ "umd" ],
            name:     "Sample",
            fileName: (format) => "sample-client.bundle.js"
        },
        target:                 "es2024",
        outDir:                 ".",
        assetsDir:              "",
        emptyOutDir:            false,
        chunkSizeWarningLimit:  5000,
        assetsInlineLimit:      0,
        sourcemap:              false,
        minify:                 true,
        reportCompressedSize:   true
    }
}))
