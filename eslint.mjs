/*
**  MQTT-JSON-RPC -- JSON-RPC protocol over MQTT communication
**  Copyright (c) 2018-2023 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import globals           from "globals"
import path              from "node:path"
import { fileURLToPath } from "node:url"
import js                from "@eslint/js"
import { FlatCompat }    from "@eslint/eslintrc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
    baseDirectory:     __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig:         js.configs.all
})

export default [
    ...compat.extends("eslint:recommended"), {
    languageOptions: {
        globals: {
            ...globals.browser,
            ...Object.fromEntries(Object.entries(globals.node).map(([key]) => [key, "off"])),
            ...globals.commonjs,
            ...globals.worker,
            ...globals.serviceworker,
            process: true,
        },
        ecmaVersion: 12,
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: false } }
    },
    rules: {
        "indent": ["error", 4, { SwitchCase: 1, }],
        "linebreak-style": ["error", "unix"],
        "semi": ["error", "never"],
        "operator-linebreak": ["error", "after", { overrides: { "&&": "before", "||": "before", ":": "before" } }],
        "brace-style": ["error", "stroustrup", { allowSingleLine: true }],
        "quotes": ["error", "double"],
        "no-multi-spaces": "off",
        "no-multiple-empty-lines": "off",
        "key-spacing": "off",
        "object-property-newline": "off",
        "curly": "off",
        "space-in-parens": "off",
        "no-console": "off",
        "lines-between-class-members": "off",
        "array-bracket-spacing": "off",
    },
}]

