
let mqtt    = require("mqtt")
let mqttRPC = require("./mqtt-json-rpc")

let mqttClient = mqtt.connect("wss://127.0.0.1:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

let rpc = new mqttRPC(mqttClient)

rpc.on("error",     (err)            => { console.log("ERROR", err) })
rpc.on("offline",   ()               => { console.log("OFFLINE") })
rpc.on("close",     ()               => { console.log("CLOSE") })
rpc.on("reconnect", ()               => { console.log("RECONNECT") })
rpc.on("message",   (topic, message) => { console.log("RECEIVED", topic, message.toString()) })

rpc.on("connect", () => {
    console.log("CONNECTED")
    rpc.register("example/foo", (...args) => {
        console.log("example/foo: request: ", args)
        return { ok: args }
    })
    rpc.call("example/foo", [ "hello", "world" ], (err, data) => {
        console.log("example/foo response: ", data)
        rpc.end()
    })
})

