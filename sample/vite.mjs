
import * as Vite          from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

export default Vite.defineConfig(({ command, mode }) => ({
    logLevel: "info",
    appType:  "custom",
    base:     "",
    root:     "",
    plugins: [
        viteSingleFile()
    ],
    build: {
        lib: {
            entry:    "sample.js",
            formats:  [ "umd" ],
            name:     "Sample",
            fileName: (format) => "sample.bundle.js"
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
