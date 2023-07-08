
MQTT-JSON-RPC
=============

[JSON-RPC](http://www.jsonrpc.org/) protocol over [MQTT](http://mqtt.org/) communication.

<p/>
<img src="https://nodei.co/npm/mqtt-json-rpc.png?downloads=true&stars=true" alt=""/>

<p/>
<img src="https://david-dm.org/rse/mqtt-json-rpc.png" alt=""/>

Installation
------------

```shell
$ npm install mqtt mqtt-json-rpc
```

About
-----

This is an addon API for the
[MQTT.js](https://www.npmjs.com/package/mqtt) API of
[Node.js](https://nodejs.org/), for
[Remote Procedure Call](https://en.wikipedia.org/wiki/Remote_procedure_call) (RPC)
communication based on the [JSON-RPC](http://www.jsonrpc.org/)
protocol. This allows a bi-directional request/response-style communication over
the technically uni-directional message protocol [MQTT](http://mqtt.org).

Usage
-----

#### Server:

```js
const MQTT = require("mqtt")
const RPC  = require("mqtt-json-rpc")

const mqtt = MQTT.connect("wss://127.0.0.1:8889", { ... })
const rpc  = new RPC(mqtt)

mqtt.on("connect", () => {
    rpc.register("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
})
```

#### Client:

```js
const MQTT = require("mqtt")
const RPC  = require("mqtt-json-rpc")

const mqtt = MQTT.connect("wss://127.0.0.1:8889", { ... })
const rpc  = new RPC(mqtt)

mqtt.on("connect", () => {
    rpc.call("example/hello", "world", 42).then((response) => {
        console.log("example/hello response: ", response)
        mqtt.end()
    })
})
```

Application Programming Interface
---------------------------------

The MQTT-JSON-RPC API provides the following methods (check out the corresponding
[./mqtt-json-rpc.d.ts](TypeScript definition)):

- `constructor(mqtt: MQTT, options?: { encoding?: string, timeout?: number }): MQTT-JSON-RPC`:<br/>
  The `mqtt` is the [MQTT.js](https://www.npmjs.com/package/mqtt) instance.
  The optional `encoding` option can be either `json` (default), `msgpack` or `cbor`.
  The optional `timeout` option is the timeout in seconds.

- `MQTT-JSON-RPC#registered(method: string): boolean`:<br/>
  Check for the previous registration of a method. The `method` has to
  be a valid MQTT topic name. The method returns `true` if `method` is
  already registered, else it returns `false`.

- `MQTT-JSON-RPC#register(method: string, callback: (...args: any[]) => any): Promise`:<br/>
  Register a method. The `method` has to be a valid MQTT topic
  name. The `callback` is called with the `params` passed to
  the remote `MQTT-JSON-RPC#notify()` or `MQTT-JSON-RPC#call()`. For
  a remote `MQTT-JSON-RPC#notify()`, the return value of `callback` will be
  ignored. For a remote `MQTT-JSON-RPC#call()`, the return value of `callback`
  will resolve the promise returned by the remote `MQTT-JSON-RPC#call()`.
  Internally, on the MQTT broker the topic `${method}/request` is
  subscribed.

- `MQTT-JSON-RPC#unregister(method: string): Promise`:<br/>
  Unregister a previously registered method.
  Internally, on the MQTT broker the topic `${method}/request` is unsubscribed.

- `MQTT-JSON-RPC#notify(method: string, ...params: any[]): void`:<br/>
  Notify a method. The remote `MQTT-JSON-RPC#register()` `callback` is called
  with `params` and its return value is silently ignored.

- `MQTT-JSON-RPC#call(method: string, ...params: any[]): Promise`:<br/>
  Call a method. The remote `MQTT-JSON-RPC#register()` `callback` is
  called with `params` and its return value resolves the returned
  `Promise`. If the remote `callback` throws an exception, this rejects
  the returned `Promise`. Internally, on the MQTT broker the topic
  `${method}/response/<cid>` is temporarily subscribed for receiving the
  response (`<cid>` is a UUID v1 to uniquely identify the MQTT-JSON-RPC
  caller instance).

Internals
---------

Internally, remote methods are assigned to MQTT topics. When calling a
remote method named `example/hello` with parameters `"world"` and `42` via...

```js
rpc.call("example/hello", "world", 42).then((result) => {
    ...
})
```

...the following JSON-RPC 2.0 request message is sent to the permanent MQTT
topic `example/hello/request`:

```json
{
    "jsonrpc": "2.0",
    "id":      "d1acc980-0e4e-11e8-98f0-ab5030b47df4:d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9",
    "method":  "example/hello",
    "params":  [ "world", 42 ]
}
```

Beforehand, this `example/hello` method should have been registered with...

```js
rpc.register("example/hello", (a1, a2) => {
    return `${a1}:${a2}`
})
```

...and then its result, in the above `rpc.call` example `"world:42"`, is then
sent back as the following JSON-RPC 2.0 success response
message to the temporary (client-specific) MQTT topic
`example/hello/response/d1acc980-0e4e-11e8-98f0-ab5030b47df4`:

```json
{
    "jsonrpc": "2.0",
    "id":      "d1acc980-0e4e-11e8-98f0-ab5030b47df4:d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9",
    "result":  "world:42"
}
```

The JSON-RPC 2.0 `id` field always consists of `<cid>:<rid>`, where
`<cid>` is the UUID v1 of the MQTT-JSON-RPC instance and `<rid>` is
the UUID v1 of the particular method request. The `<cid>` is used for
sending back the JSON-RPC 2.0 response message to the requestor only.

Example
-------

For a real test-drive of MQTT-JSON-RPC, install the
[Mosquitto](https://mosquitto.org/) MQTT broker with at least a "MQTT
over Secure-WebSockets" lister in the `mosquitto.conf` file like...

```
[...]

password_file        mosquitto-pwd.txt
acl_file             mosquitto-acl.txt

[...]

#   additional listener (wss: MQTT over WebSockets+SSL/TLS)
listener             8889 127.0.0.1
max_connections      -1
protocol             websockets
cafile               mosquitto-ca.crt.pem
certfile             mosquitto-sv.crt.pem
keyfile              mosquitto-sv.key.pem
require_certificate  false

[...]
```

...and an access control list in `mosquitto-acl.txt` like...

```
user    example
topic   readwrite example/#
```

...and an `example` user (with password `example`) in `mosquitto-pwd.txt` like:

```
example:$6$awYNe6oCAi+xlvo5$mWIUqyy4I0O3nJ99lP1mkRVqsDGymF8en5NChQQxf7KrVJLUp1SzrrVDe94wWWJa3JGIbOXD9wfFGZdi948e6A==
```

Then test-drive MQTT-JSON-RPC with a complete [sample](sample/sample.js) to see
MQTT-JSON-RPC in action and tracing its communication:

```js
const MQTT = require("mqtt")
const RPC  = require("mqtt-json-rpc")

const mqtt = MQTT.connect("wss://127.0.0.1:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

const rpc = new RPC(mqtt)

mqtt.on("error",     (err)            => { console.log("ERROR", err) })
mqtt.on("offline",   ()               => { console.log("OFFLINE") })
mqtt.on("close",     ()               => { console.log("CLOSE") })
mqtt.on("reconnect", ()               => { console.log("RECONNECT") })
mqtt.on("message",   (topic, message) => { console.log("RECEIVED", topic, message.toString()) })

mqtt.on("connect", () => {
    console.log("CONNECT")
    rpc.register("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
    rpc.call("example/hello", "world", 42).then((result) => {
        console.log("example/hello sucess: ", result)
        mqtt.end()
    }).catch((err) => {
        console.log("example/hello error: ", err)
    })
})
```

The output will be:

```
$ node sample.js
CONNECT
RECEIVED example/hello/request {"jsonrpc":"2.0","id":"1099cb50-bd2b-11eb-8198-43568ad728c4:10bf7bc0-bd2b-11eb-bac6-439c565b651a","method":"example/hello","params":["world",42]}
example/hello: request:  world 42
RECEIVED example/hello/response/1099cb50-bd2b-11eb-8198-43568ad728c4 {"jsonrpc":"2.0","id":"1099cb50-bd2b-11eb-8198-43568ad728c4:10bf7bc0-bd2b-11eb-bac6-439c565b651a","result":"world:42"}
example/hello sucess:  world:42
CLOSE
```

License
-------

Copyright (c) 2018-2023 Dr. Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

