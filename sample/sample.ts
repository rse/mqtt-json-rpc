
import MQTT from "mqtt"
import RPC  from "mqtt-json-rpc"

const mqtt = MQTT.connect("wss://10.1.0.10:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

type RPCSchema = {
    "example/sample": (a1: string, a2: number) => void
    "example/hello":  (a1: string, a2: number) => string
}

const rpc = new RPC<RPCSchema>(mqtt, { codec: "json" })

mqtt.on("error",     (err)            => { console.log("ERROR", err) })
mqtt.on("offline",   ()               => { console.log("OFFLINE") })
mqtt.on("close",     ()               => { console.log("CLOSE") })
mqtt.on("reconnect", ()               => { console.log("RECONNECT") })
mqtt.on("message",   (topic, message) => { console.log("RECEIVED", topic, message.toString()) })

mqtt.on("connect", () => {
    console.log("CONNECT")
    rpc.subscribe("example/sample", (a1, a2) => {
        console.log("example/sample: info: ", a1, a2)
    })
    rpc.emit("example/sample", "world", 42)
    rpc.register("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
    rpc.call("example/hello", "world", 42).then((result) => {
        console.log("example/hello success: ", result)
        mqtt.end()
    }).catch((err) => {
        console.log("example/hello error: ", err)
    })
})

