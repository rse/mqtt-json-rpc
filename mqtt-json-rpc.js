/*
**  MQTT-JSON-RPC -- JSON-RPC protocol over MQTT communication
**  Copyright (c) 2018-2023 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external requirements  */
const UUID    = require("pure-uuid")
const JSONRPC = require("jsonrpc-lite")
const Encodr  = require("encodr")

/*  the API class  */
class API {
    constructor (mqtt, options = {}) {
        /*  determine options  */
        this.options = Object.assign({
            encoding: "json",
            timeout:  10 * 1000
        }, options)

        /*  remember the underlying MQTT Client instance  */
        this.mqtt = mqtt

        /*  make an encoder  */
        this.encodr = new Encodr(this.options.encoding)

        /*  generate unique client identifier  */
        this.cid = (new UUID(1)).format("std")

        /*  internal states  */
        this.registry      = {}
        this.requests      = {}
        this.subscriptions = {}

        /*  hook into the MQTT message processing  */
        this.mqtt.on("message", (topic, message) => {
            this._onServer(topic, message)
            this._onClient(topic, message)
        })
    }

    /*
     *  RPC server/response side
     */

    /*  check for the registration of an RPC method  */
    registered (method) {
        return (this.registry[method] !== undefined)
    }

    /*  register an RPC method  */
    register (method, callback) {
        if (this.registry[method] !== undefined)
            throw new Error(`register: method "${method}" already registered`)
        this.registry[method] = callback
        return new Promise((resolve, reject) => {
            this.mqtt.subscribe(`${method}/request`, { qos: 2 }, (err, granted) => {
                if (err)
                    reject(err)
                else
                    resolve(granted)
            })
        })
    }

    /*  unregister an RPC method  */
    unregister (method) {
        if (this.registry[method] === undefined)
            throw new Error(`unregister: method "${method}" not registered`)
        delete this.registry[method]
        return new Promise((resolve, reject) => {
            this.mqtt.unsubscribe(`${method}/request`, (err, packet) => {
                if (err)
                    reject(err)
                else
                    resolve(packet)
            })
        })
    }

    /*  handle incoming RPC method request  */
    _onServer (topic, message) {
        /*  ensure we handle only MQTT RPC requests  */
        let m
        if ((m = topic.match(/^(.+)\/request$/)) === null)
            return
        const method = m[1]

        /*  ensure we handle only JSON-RPC payloads  */
        const parsed = JSONRPC.parseObject(this.encodr.decode(message))
        if (!(typeof parsed === "object" && typeof parsed.type === "string"))
            return

        /*  ensure we handle a consistent JSON-RPC method request  */
        if (parsed.payload.method !== method)
            return

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "notification") {
            /*  just deliver notification  */
            if (typeof this.registry[method] === "function")
                this.registry[method](...parsed.payload.params)
        }
        else if (parsed.type === "request") {
            /*  deliver request and send response  */
            let response
            if (typeof this.registry[method] === "function")
                response = Promise.resolve().then(() => this.registry[method](...parsed.payload.params))
            else
                response = Promise.reject(JSONRPC.JsonRpcError.methodNotFound({ method, id: parsed.payload.id }))
            response.then((response) => {
                /*  create JSON-RPC success response  */
                return JSONRPC.success(parsed.payload.id, response)
            }, (error) => {
                /*  create JSON-RPC error response  */
                return this._buildError(parsed.payload, error)
            }).then((response) => {
                /*  send MQTT response message  */
                response = this.encodr.encode(response)
                const m = parsed.payload.id.match(/^(.+):.+$/)
                const cid = m[1]
                this.mqtt.publish(`${method}/response/${cid}`, response, { qos: 0 })
            })
        }
    }

    /*
     *  RPC client/request side
     */

    /*  notify peer ("fire and forget")  */
    notify (method, ...params) {
        let request = JSONRPC.notification(method, params)
        request = this.encodr.encode(request)
        this.mqtt.publish(`${method}/request`, request, { qos: 0 })
    }

    /*  call peer ("request and response")  */
    call (method, ...params) {
        /*  remember callback and create JSON-RPC request  */
        const rid = `${this.cid}:${(new UUID(1)).format("std")}`
        const promise = new Promise((resolve, reject) => {
            let timer = setTimeout(() => {
                reject(new Error("communication timeout"))
                timer = null
            }, this.options.timeout)
            this.requests[rid] = (err, result) => {
                if (timer !== null) {
                    clearTimeout(timer)
                    timer = null
                }
                if (err) reject(err)
                else     resolve(result)
            }
        })
        let request = JSONRPC.request(rid, method, params)

        /*  subscribe for response  */
        this._responseSubscribe(method)

        /*  send MQTT request message  */
        request = this.encodr.encode(request)
        this.mqtt.publish(`${method}/request`, request, { qos: 2 }, (err) => {
            if (err) {
                /*  handle request failure  */
                this._responseUnsubscribe(method)
                this.requests[rid](err, undefined)
            }
        })

        return promise
    }

    /*  handle incoming RPC method response  */
    _onClient (topic, message) {
        /*  ensure we handle only MQTT RPC responses  */
        let m
        if ((m = topic.match(/^(.+)\/response\/(.+)$/)) === null)
            return
        const [ , method, cid ] = m

        /*  ensure we really handle only MQTT RPC responses for us  */
        if (cid !== this.cid)
            return

        /*  ensure we handle only JSON-RPC payloads  */
        const parsed = JSONRPC.parseObject(this.encodr.decode(message))
        if (!(typeof parsed === "object" && typeof parsed.type === "string"))
            return

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "success" || parsed.type === "error") {
            const rid = parsed.payload.id
            if (typeof this.requests[rid] === "function") {
                /*  call callback function  */
                if (parsed.type === "success")
                    this.requests[rid](undefined, parsed.payload.result)
                else
                    this.requests[rid](parsed.payload.error, undefined)

                /*  unsubscribe from response  */
                delete this.requests[rid]
                this._responseUnsubscribe(method)
            }
        }
    }

    /*  subscribe to RPC response  */
    _responseSubscribe (method) {
        const topic = `${method}/response/${this.cid}`
        if (this.subscriptions[topic] === undefined) {
            this.subscriptions[topic] = 0
            this.mqtt.subscribe(topic, { qos: 2 })
        }
        this.subscriptions[topic]++
    }

    /*  unsubscribe from RPC response  */
    _responseUnsubscribe (method) {
        const topic = `${method}/response/${this.cid}`
        this.subscriptions[topic]--
        if (this.subscriptions[topic] === 0) {
            delete this.subscriptions[topic]
            this.mqtt.unsubscribe(topic)
        }
    }

    /*  determine RPC error  */
    _buildError (payload, error) {
        let rpcError
        switch (typeof error) {
            case "undefined":
                rpcError = new JSONRPC.JsonRpcError("undefined error", 0)
                break
            case "string":
                rpcError = new JSONRPC.JsonRpcError(error, -1)
                break
            case "number":
            case "bigint":
                rpcError = new JSONRPC.JsonRpcError("application error", error)
                break
            case "object":
                if (error === null)
                    rpcError = new JSONRPC.JsonRpcError("undefined error", 0)
                else {
                    if (error instanceof JSONRPC.JsonRpcError)
                        rpcError = error
                    else if (error instanceof Error)
                        rpcError = new JSONRPC.JsonRpcError(error.toString(), -100, error)
                    else
                        rpcError = new JSONRPC.JsonRpcError("application error", -100, error)
                }
                break
            default:
                rpcError = new JSONRPC.JsonRpcError("unspecified error", 0, { data: error })
                break
        }
        return JSONRPC.error(payload.id, rpcError)
    }
}

/*  export the standard way  */
module.exports = API

