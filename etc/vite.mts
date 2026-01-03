/*
**  MQTT-JSON-RPC -- JSON-RPC protocol over MQTT communication
**  Copyright (c) 2018-2025 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under MIT <https://spdx.org/licenses/MIT>
*/

import * as Vite             from "vite"
import { tscPlugin }         from "@wroud/vite-plugin-tsc"
import { viteSingleFile }    from "vite-plugin-singlefile"
import { nodePolyfills }     from "vite-plugin-node-polyfills"

const formats = process.env.VITE_BUILD_FORMATS ?? "esm"

export default Vite.defineConfig(({ command, mode }) => ({
    logLevel: "info",
    appType:  "custom",
    base:     "",
    root:     "",
    plugins: [
        tscPlugin({
            tscArgs:        [ "--project", "etc/tsc.json" ],
            packageManager: "npx",
            prebuild:       true
        }),
        ...(formats === "umd" ? [ nodePolyfills() ] : []),
        viteSingleFile()
    ],
    build: {
        rollupOptions: {
            external: formats === "umd" ? [] : [ "stream" ]
        },
        lib: {
            entry:    "dst/mqtt-json-rpc.js",
            formats:  formats.split(","),
            name:     "MqttJsonRpc",
            fileName: (format) => `mqtt-json-rpc.${format === "es" ? "esm" : format}.js`
        },
        target:                 formats === "umd" ? "es2022" : "node20",
        outDir:                 "dst",
        assetsDir:              "",
        emptyOutDir:            (mode === "production") && formats !== "umd",
        chunkSizeWarningLimit:  5000,
        assetsInlineLimit:      0,
        sourcemap:              (mode === "development"),
        minify:                 (mode === "production") && formats === "umd",
        reportCompressedSize:   (mode === "production")
    }
}))
