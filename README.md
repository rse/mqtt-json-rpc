
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

This is a small wrapper around the
[MQTT.js](https://www.npmjs.com/package/mqtt) API of
[Node.js](https://nodejs.org/), for Remote Procedure Call (RPC)
communication based on the [JSON-RPC](http://www.jsonrpc.org/)
protocol. It allows a request/response-style communication over
the plain message protocol [MQTT](http://mqtt.org).

Internally, remote methods are assigned to MQTT topics. When calling a
remote method named `example/hello` with parameters "world" and 42, the
following JSON-RPC 2.0 request message is sent to the permanent MQTT
topic `example/hello/request`:

```json
{
    "jsonrpc": "2.0",
    "id":      "d1acc980-0e4e-11e8-98f0-ab5030b47df4:d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9",
    "method":  "example/hello",
    "params":  [ "world", 42 ]
}
```

The result, e.g. `"world:42"`, of method `example/hello`
is then sent back as the following JSON-RPC 2.0 success
message to the temporary (client-specific) MQTT topic
`example/hello/response/d1acc980-0e4e-11e8-98f0-ab5030b47df4`:

```json
{
    "jsonrpc": "2.0",
    "id":      "d1acc980-0e4e-11e8-98f0-ab5030b47df4:d1db7aa0-0e4e-11e8-b1d9-5f0ab230c0d9",
    "result":  "world:42"
}
```

Usage
-----

Application Programming Interface
---------------------------------

License
-------

Copyright (c) 2018 Ralf S. Engelschall (http://engelschall.com/)

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

