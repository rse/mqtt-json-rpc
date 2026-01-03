"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var mqtt_1 = require("mqtt");
var mqtt_json_rpc_1 = require("mqtt-json-rpc");
var mqtt = mqtt_1.default.connect("wss://10.1.0.10:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
});
var rpc = new mqtt_json_rpc_1.default(mqtt, { codec: "json" });
mqtt.on("error", function (err) { console.log("ERROR", err); });
mqtt.on("offline", function () { console.log("OFFLINE"); });
mqtt.on("close", function () { console.log("CLOSE"); });
mqtt.on("reconnect", function () { console.log("RECONNECT"); });
mqtt.on("message", function (topic, message) { console.log("RECEIVED", topic, message.toString()); });
mqtt.on("connect", function () {
    console.log("CONNECT");
    rpc.subscribe("example/sample", function (a1, a2) {
        console.log("example/sample: info: ", a1, a2);
    });
    rpc.notify("example/sample", "world", 42);
    rpc.register("example/hello", function (a1, a2) {
        console.log("example/hello: request: ", a1, a2);
        return "".concat(a1, ":").concat(a2);
    });
    rpc.call("example/hello", "world", 42).then(function (result) {
        console.log("example/hello sucess: ", result);
        mqtt.end();
    }).catch(function (err) {
        console.log("example/hello error: ", err);
    });
});
