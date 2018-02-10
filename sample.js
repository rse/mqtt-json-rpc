
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
    rpc.register("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
    rpc.call("example/hello", [ "world", 42 ], (err, data) => {
        console.log("example/hello response: ", data)
        rpc.end()
    })
})

