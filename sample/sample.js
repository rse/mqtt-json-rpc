
const MQTT = require("mqtt")
const RPC  = require("mqtt-json-rpc")

const mqtt = MQTT.connect("wss://127.0.0.1:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

const rpc = new RPC(mqtt)

rpc.on("error",     (err)            => { console.log("ERROR", err) })
rpc.on("offline",   ()               => { console.log("OFFLINE") })
rpc.on("close",     ()               => { console.log("CLOSE") })
rpc.on("reconnect", ()               => { console.log("RECONNECT") })
rpc.on("message",   (topic, message) => { console.log("RECEIVED", topic, message.toString()) })

rpc.on("connect", () => {
    console.log("CONNECT")
    rpc.register("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
    rpc.call("example/hello", "world", 42).then((result) => {
        console.log("example/hello sucess: ", result)
        rpc.end()
    }).catch((err) => {
        console.log("example/hello error: ", err)
    })
})

