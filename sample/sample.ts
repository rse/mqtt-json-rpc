
import MQTT from "mqtt"
import RPC  from "mqtt-json-rpc"

const mqtt = MQTT.connect("wss://10.1.0.10:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

const rpc = new RPC(mqtt, { codec: "cbor" })

mqtt.on("error",     (err)            => { console.log("ERROR", err) })
mqtt.on("offline",   ()               => { console.log("OFFLINE") })
mqtt.on("close",     ()               => { console.log("CLOSE") })
mqtt.on("reconnect", ()               => { console.log("RECONNECT") })
mqtt.on("message",   (topic, message) => { console.log("RECEIVED", topic, message) })

type Sample = (a: string, b: number) => string

mqtt.on("connect", () => {
    console.log("CONNECT")
    rpc.register<Sample>("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
    rpc.call<Sample>("example/hello", "world", 42).then((result) => {
        console.log("example/hello sucess: ", result)
        mqtt.end()
    }).catch((err) => {
        console.log("example/hello error: ", err)
    })
})

