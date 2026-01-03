
<img src="https://raw.githubusercontent.com/rse/mqtt-json-rpc/master/etc/logo.svg" width="200" align="right" alt=""/>

MQTT-JSON-RPC
=============

[JSON-RPC](http://www.jsonrpc.org/) protocol over [MQTT](http://mqtt.org/) communication.

<p/>
<img src="https://nodei.co/npm/mqtt-json-rpc.png?downloads=true&stars=true" alt=""/>

[![github (author stars)](https://img.shields.io/github/stars/rse?logo=github&label=author%20stars&color=%233377aa)](https://github.com/rse)
[![github (author followers)](https://img.shields.io/github/followers/rse?label=author%20followers&logo=github&color=%234477aa)](https://github.com/rse)

Installation
------------

```shell
$ npm install mqtt mqtt-json-rpc
```

About
-----

This is an addon API for the excellent
[MQTT.js](https://www.npmjs.com/package/mqtt) JavaScript/TypeScript API
for [Remote Procedure Call](https://en.wikipedia.org/wiki/Remote_procedure_call) (RPC)
communication based on the [JSON-RPC](http://www.jsonrpc.org/)
protocol. This allows a bi-directional request/response-style communication over
the technically uni-directional message protocol [MQTT](http://mqtt.org).

Conceptually, this RPC API provides two types of communication patterns:

- **Event Emission**:
  Event Emission is a *uni-directional* communication pattern.
  An Event is the combination of an event name and optionally zero or more arguments.
  You *subscribe* to events.
  When an event is *emitted*, either a single particular subscriber (in case of
  a directed event emission) or all subscribers are called and receive the
  arguments as extra information.

- **Service Call**:
  Service Call is a *bi-directional* communication pattern.
  A Service is the combination of a service name and optionally zero or more arguments.
  You *register* for a service.
   When a service is *called*, a single particular registrator (in case
  of a directed service call) or one arbitrary registrator is called and
  receives the arguments as the request. The registrator then has to
  provide the service response.

Notice: while the provided Event Emission functionality is just a very thing
wrapper around the regular MQTT message publishing API of MQTT.js, the
Service Call functionality is the core and heart of this addon API.

Usage
-----

### API:

```ts
export default type API = {
    "example/sample": (a1: string, a2: number) => void
    "example/hello":  (a1: string, a2: number) => string
}
```

### Server:

```ts
import MQTT  from "mqtt"
import RPC   from "mqtt-json-rpc"
import API   from "..."

const mqtt = MQTT.connect("wss://127.0.0.1:8889", { ... })
const rpc  = new RPC<API>(mqtt)

mqtt.on("connect", async () => {
    rpc.register("example/hello", (a1, a2) => {
        console.log("example/hello: request: ", a1, a2)
        return `${a1}:${a2}`
    })
})
```

### Client:

```ts
import MQTT from "mqtt"
import RPC  from "mqtt-json-rpc"
import API   from "..."

const mqtt = MQTT.connect("wss://127.0.0.1:8889", { ... })
const rpc  = new RPC<API>(mqtt)

mqtt.on("connect", () => {
    rpc.call("example/hello", "world", 42).then((response) => {
        console.log("example/hello response: ", response)
        mqtt.end()
    })
})
```

Application Programming Interface
---------------------------------

The RPC API provides the following methods:

- **Construction**:<br/>
  `constructor(mqtt: MqttClient, options?: Partial<APIOptions>): RPC`:<br/>
  The `mqtt` is the [MQTT.js](https://www.npmjs.com/package/mqtt) instance.
  The optional `options` object supports the following fields:
  - `clientId` (string): Custom client identifier (default: auto-generated UUID v1).
  - `codec` (`"cbor"` | `"json"`): Encoding format (default: `"cbor"`).
  - `timeout` (number): Timeout in milliseconds (default: `10000`).
  - `topicEventNoticeMake` (function): Custom topic generation for event notices.<br/>
    Type: `(name: string, clientId?: string) => string`<br/>
    Default: `` (name, clientId) => clientId ? `${name}/event-notice/${clientId}` : `${name}/event-notice` ``
  - `topicServiceRequestMake` (function): Custom topic generation for service requests.<br/>
    Type: `(name: string, clientId?: string) => string`<br/>
    Default: `` (name, clientId) => clientId ? `${name}/service-request/${clientId}` : `${name}/service-request` ``
  - `topicServiceResponseMake` (function): Custom topic generation for service responses.<br/>
    Type: `(name: string, clientId?: string) => string`<br/>
    Default: `` (name, clientId) => clientId ? `${name}/service-response/${clientId}` : `${name}/service-response` ``
  - `topicEventNoticeMatch` (function): Custom topic matching for event notices.<br/>
    Type: `(topic: string) => TopicMatch | null`<br/>
    Default: `` (topic) => { const m = topic.match(/^(.+?)\/event-notice(?:\/(.+))?$/); return m ? { name: m[1], clientId: m[2] } : null } ``<br/>
    The match result should have the event `name` and optionally the `clientId`.
  - `topicServiceRequestMatch` (function): Custom topic matching for service requests.<br/>
    Type: `(topic: string) => TopicMatch | null`<br/>
    Default: `` (topic) => { const m = topic.match(/^(.+?)\/service-request(?:\/(.+))?$/); return m ? { name: m[1], clientId: m[2] } : null } ``<br/>
    The match result should have the service `name` and optionally the `clientId`.
  - `topicServiceResponseMatch` (function): Custom topic matching for service responses.<br/>
    Type: `(topic: string) => TopicMatch | null`<br/>
    Default: `` (topic) => { const m = topic.match(/^(.+?)\/service-response\/(.+)$/); return m ? { name: m[1], clientId: m[2] } : null } ``<br/>
    The match result should have the service `name` and the `clientId`.

- **Event Subscription**:<br/>

      /*  (simplified API method signature)  */
      subscribe(
          event:    string,
          callback: (...params: any[]) => void,
          options?: MQTT::IClientSubscribeOptions
      ): Promise<Subscription>

  Subscribe to an event. The `event` has to be a valid MQTT topic
  name. The `callback` is called with the `params` passed to
  a remote `emit()`. There is no return value of `callback`.
  Internally, on the MQTT broker, the topics generated by `topicEventNoticeMake()` (default: `${event}/event-notice` and
  `${event}/event-notice/${clientId}`) are subscribed. Returns a `Subscription` object with an `unsubscribe()` method.

- **Service Registration**:<br/>

      /*  (simplified API method signature)  */
      register(
          service: string,
          callback: (...params: any[]) => any,
          options?: MQTT::IClientSubscribeOptions
      ): Promise<Registration>

  Register a service. The `service` has to be a valid MQTT topic
  name. The `callback` is called with the `params` passed to
  a remote `call()`. The return value of `callback`
  will resolve the `Promise` returned by the remote `call()`.
  Internally, on the MQTT broker, the topics by `topicServiceRequestMake()` (default: `${service}/service-request` and
  `${service}/service-request/${clientId}`) are subscribed. Returns a `Registration` object with an `unregister()` method.

- **Event Emission**:<br/>

      /*  (simplified API method signature)  */
      emit(
          event:     string,
          clientId?: ClientId,
          options?:  MQTT::IClientSubscribeOptions,
          ...params: any[]
      ): void

  Emit an event to all subscribers or a specific client ("fire and forget").
  The optional `clientId` (wrapped via `clientId()`) directs the event to a specific client.
  The optional `options` allows setting MQTT publish options like `qos` or `retain`.
  Internally, publishes to the MQTT topic by `topicEventNoticeMake(event, clientId)`
  (default: `${event}/event-notice` or `${event}/event-notice/${clientId}`).

- **Service Call**:<br/>

      /*  (simplified API method signature)  */
      call(
          service:   string,
          clientId?: ClientId,
          options?:  MQTT::IClientSubscribeOptions,
          ...params: any[]
      ): Promise<any>

  Call a service. The remote `register()` `callback` is
  called with `params` and its return value resolves the returned
  `Promise`. If the remote `callback` throws an exception, this rejects
  the returned `Promise`. The optional `clientId` (wrapped via `clientId()`) directs the call to a specific client.
  The optional `options` allows setting MQTT publish options like `qos`.
  Internally, on the MQTT broker, the topic
  by `topicServiceResponseMake(service, clientId)` (default: `${service}/service-response/${clientId}`)
  is temporarily subscribed for receiving the response.

- **Client Id Wrapping**:<br/>

      clientId(
          id: string
      ): ClientId

  Wrap a client ID string for use with `emit()` or `call()` to direct the
  message to a specific client. Returns a `ClientId` object.

Internals
---------

In the following, assume that an RPC instance is created with:

```ts
import MQTT from "mqtt"
import RPC  from "mqtt-json-rpc"

const mqtt = MQTT.connect("...", { ... })
const rpc  = new RPC(mqtt, { clientId: "d1acc980-0e4e-11e8-98f0-ab5030b47df4", codec: "json" })
```

Internally, remote services are assigned to MQTT topics. When calling a
remote service named `example/hello` with parameters `"world"` and `42` via...

```ts
rpc.call("example/hello", "world", 42).then((result) => {
    ...
})
```

...the following JSON-RPC 2.0 request message is sent to the permanent MQTT
topic `example/hello/service-request` (UUID `d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9` is
a random generated one):

```json
{
    "jsonrpc": "2.0",
    "id":      "d1acc980-0e4e-11e8-98f0-ab5030b47df4:d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9",
    "method":  "example/hello",
    "params":  [ "world", 42 ]
}
```

Beforehand, this `example/hello` service should have been registered with...

```ts
rpc.register("example/hello", (a1, a2) => {
    return `${a1}:${a2}`
})
```

...and then its result, in the above `rpc.call()` example `"world:42"`, is then
sent back as the following JSON-RPC 2.0 success response
message to the temporary (client-specific) MQTT topic
`example/hello/service-response/d1acc980-0e4e-11e8-98f0-ab5030b47df4`:

```json
{
    "jsonrpc": "2.0",
    "id":      "d1acc980-0e4e-11e8-98f0-ab5030b47df4:d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9",
    "result":  "world:42"
}
```

The JSON-RPC 2.0 `id` field always consists of `clientId:requestId`, where
`clientId` is the UUID v1 of the RPC client instance and `requestId` is
the UUID v1 of the particular service request. The `clientId` is used for
sending back the JSON-RPC 2.0 response message to the requestor only.
The `requestId` is used for correlating the response to the request only.

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

Then test-drive MQTT-JSON-RPC with a complete [sample](sample/sample.ts) to see
MQTT-JSON-RPC in action and tracing its communication (the typing of the `RPC`
class with `RPCSchema` is optional, but strongly suggested):

```ts
import MQTT from "mqtt"
import RPC  from "mqtt-json-rpc"

const mqtt = MQTT.connect("wss://127.0.0.1:8889", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

type RPCSchema = {
    "example/sample": (a1: string, a2: number) => void
    "example/hello":  (a1: string, a2: number) => string
}

const rpc = new RPC<RPCSchema>(mqtt, { codec: "json" })

type Sample = (a: string, b: number) => string

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
        console.log("example/hello success: ", result)
        mqtt.end()
    }).catch((err) => {
        console.log("example/hello error: ", err)
    })
})
```

The output will be:

```
$ node sample.ts
CONNECT
RECEIVED example/hello/service-request {"jsonrpc":"2.0","id":"b441fe30-e8af-11f0-b361-a30e779baa27:b474f510-e8af-11f0-ace2-97e30fcf7dca","method":"example/hello","params":["world",42]}
example/hello: request:  world 42
RECEIVED example/hello/service-response/b441fe30-e8af-11f0-b361-a30e779baa27 {"jsonrpc":"2.0","id":"b441fe30-e8af-11f0-b361-a30e779baa27:b474f510-e8af-11f0-ace2-97e30fcf7dca","result":"world:42"}
example/hello success:  world:42
CLOSE
```

License
-------

Copyright (c) 2018-2025 Dr. Ralf S. Engelschall (http://engelschall.com/)

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

