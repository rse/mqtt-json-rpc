
module.exports = function (grunt) {
    grunt.loadNpmTasks("grunt-browserify")
    grunt.initConfig({
        browserify: {
            "sample": {
                files: {
                    "sample.bundle.js": [ "./sample.js" ]
                },
                options: {
                    transform: [
                        [ "babelify", {
                            presets: [
                                [ "@babel/preset-env", {
                                    "targets": {
                                        "browsers": "last 2 versions, > 1%, ie 11"
                                    }
                                } ]
                            ]
                        } ],
                        // "aliasify"
                    ],
                    browserifyOptions: {
                        standalone: "Sample",
                        debug: false
                    }
                }
            }
        }
    })
    grunt.registerTask("default", [ "browserify" ])
}

