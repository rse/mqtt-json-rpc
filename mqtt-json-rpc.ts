/*
**  MQTT-JSON-RPC -- JSON-RPC protocol over MQTT communication
**  Copyright (c) 2018-2025 Dr. Ralf S. Engelschall <rse@engelschall.com>
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
import UUID                       from "pure-uuid"
import JSONRPC, { JsonRpcError }  from "jsonrpc-lite"
import Encodr                     from "encodr"

/*  type definitions  */
interface APIOptions {
    encoding?: "json" | "cbor" | "msgpack"
    timeout?:  number
}
interface Registry {
    [ method: string ]: ((...params: any[]) => any) | undefined
}
interface Requests {
    [ rid: string ]: ((err: any, result: any) => void) | undefined
}
interface Subscriptions {
    [ topic: string ]: number | undefined
}

/*  the API class  */
class API {
    private options:       APIOptions
    private mqtt:          any
    private encodr:        Encodr
    private cid:           string
    private registry:      Registry
    private requests:      Requests
    private subscriptions: Subscriptions

    constructor (mqtt: any, options: APIOptions = {}) {
        /*  determine options  */
        this.options = Object.assign({
            encoding: "json",
            timeout:  10 * 1000
        }, options)

        /*  remember the underlying MQTT Client instance  */
        this.mqtt = mqtt

        /*  establish an encoder  */
        this.encodr = new Encodr(this.options.encoding)

        /*  generate unique client identifier  */
        this.cid = (new UUID(1)).format("std")

        /*  internal states  */
        this.registry      = {}
        this.requests      = {}
        this.subscriptions = {}

        /*  hook into the MQTT message processing  */
        this.mqtt.on("message", (topic: string, message: Buffer) => {
            this._onServer(topic, message)
            this._onClient(topic, message)
        })
    }

    /*
     *  RPC server/response side
     */

    /*  check for the registration of an RPC method  */
    registered (method: string): boolean {
        return (this.registry[method] !== undefined)
    }

    /*  register an RPC method  */
    register (method: string, callback: (...params: any[]) => any): Promise<any> {
        if (this.registry[method] !== undefined)
            throw new Error(`register: method "${method}" already registered`)
        this.registry[method] = callback
        return new Promise((resolve, reject) => {
            this.mqtt.subscribe(`${method}/request`, { qos: 2 }, (err: Error | null, granted: any) => {
                if (err)
                    reject(err)
                else
                    resolve(granted)
            })
        })
    }

    /*  unregister an RPC method  */
    unregister (method: string): Promise<any> {
        if (this.registry[method] === undefined)
            throw new Error(`unregister: method "${method}" not registered`)
        delete this.registry[method]
        return new Promise((resolve, reject) => {
            this.mqtt.unsubscribe(`${method}/request`, (err: Error | null, packet: any) => {
                if (err)
                    reject(err)
                else
                    resolve(packet)
            })
        })
    }

    /*  handle incoming RPC method request  */
    private _onServer (topic: string, message: Buffer): void {
        /*  ensure we handle only MQTT RPC requests  */
        let m: RegExpMatchArray | null
        if ((m = topic.match(/^(.+)\/request$/)) === null)
            return
        const method: string = m[1]

        /*  ensure we handle only JSON-RPC payloads  */
        const parsed: any = JSONRPC.parseObject(this.encodr.decode(message))
        if (!(typeof parsed === "object" && typeof parsed.type === "string"))
            return

        /*  ensure we handle a consistent JSON-RPC method request  */
        if (parsed.payload.method !== method)
            return

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "notification") {
            /*  just deliver notification  */
            if (typeof this.registry[method] === "function")
                this.registry[method]!(...parsed.payload.params)
        }
        else if (parsed.type === "request") {
            /*  deliver request and send response  */
            let response: Promise<any>
            if (typeof this.registry[method] === "function")
                response = Promise.resolve().then(() => this.registry[method]!(...parsed.payload.params))
            else
                response = Promise.reject(JsonRpcError.methodNotFound({ method, id: parsed.payload.id }))
            response.then((response: any) => {
                /*  create JSON-RPC success response  */
                return JSONRPC.success(parsed.payload.id, response)
            }, (error: any) => {
                /*  create JSON-RPC error response  */
                return this._buildError(parsed.payload, error)
            }).then((response: any) => {
                /*  send MQTT response message  */
                response = this.encodr.encode(response)
                const m: RegExpMatchArray = parsed.payload.id.match(/^(.+):.+$/)!
                const cid: string = m[1]
                this.mqtt.publish(`${method}/response/${cid}`, response, { qos: 0 })
            })
        }
    }

    /*
     *  RPC client/request side
     */

    /*  notify peer ("fire and forget")  */
    notify (method: string, ...params: any[]): void {
        let request: any = JSONRPC.notification(method, params)
        request = this.encodr.encode(request)
        this.mqtt.publish(`${method}/request`, request, { qos: 0 })
    }

    /*  call peer ("request and response")  */
    call (method: string, ...params: any[]): Promise<any> {
        /*  remember callback and create JSON-RPC request  */
        const rid: string = `${this.cid}:${(new UUID(1)).format("std")}`
        const promise: Promise<any> = new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout | null = setTimeout(() => {
                reject(new Error("communication timeout"))
                timer = null
            }, this.options.timeout!)
            this.requests[rid] = (err: any, result: any) => {
                if (timer !== null) {
                    clearTimeout(timer)
                    timer = null
                }
                if (err) reject(err)
                else     resolve(result)
            }
        })
        let request: any = JSONRPC.request(rid, method, params)

        /*  subscribe for response  */
        this._responseSubscribe(method)

        /*  send MQTT request message  */
        request = this.encodr.encode(request)
        this.mqtt.publish(`${method}/request`, request, { qos: 2 }, (err?: Error) => {
            if (err) {
                /*  handle request failure  */
                this._responseUnsubscribe(method)
                this.requests[rid]!(err, undefined)
            }
        })

        return promise
    }

    /*  handle incoming RPC method response  */
    private _onClient (topic: string, message: Buffer): void {
        /*  ensure we handle only MQTT RPC responses  */
        let m: RegExpMatchArray | null
        if ((m = topic.match(/^(.+)\/response\/(.+)$/)) === null)
            return
        const [ , method, cid ]: string[] = m

        /*  ensure we really handle only MQTT RPC responses for us  */
        if (cid !== this.cid)
            return

        /*  ensure we handle only JSON-RPC payloads  */
        const parsed: any = JSONRPC.parseObject(this.encodr.decode(message))
        if (!(typeof parsed === "object" && typeof parsed.type === "string"))
            return

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "success" || parsed.type === "error") {
            const rid: string = parsed.payload.id
            if (typeof this.requests[rid] === "function") {
                /*  call callback function  */
                if (parsed.type === "success")
                    this.requests[rid]!(undefined, parsed.payload.result)
                else
                    this.requests[rid]!(parsed.payload.error, undefined)

                /*  unsubscribe from response  */
                delete this.requests[rid]
                this._responseUnsubscribe(method)
            }
        }
    }

    /*  subscribe to RPC response  */
    private _responseSubscribe (method: string): void {
        const topic: string = `${method}/response/${this.cid}`
        if (this.subscriptions[topic] === undefined) {
            this.subscriptions[topic] = 0
            this.mqtt.subscribe(topic, { qos: 2 })
        }
        this.subscriptions[topic]!++
    }

    /*  unsubscribe from RPC response  */
    private _responseUnsubscribe (method: string): void {
        const topic: string = `${method}/response/${this.cid}`
        this.subscriptions[topic]!--
        if (this.subscriptions[topic] === 0) {
            delete this.subscriptions[topic]
            this.mqtt.unsubscribe(topic)
        }
    }

    /*  determine RPC error  */
    private _buildError (payload: any, error: any): any {
        let rpcError: JsonRpcError
        switch (typeof error) {
            case "undefined":
                rpcError = new JsonRpcError("undefined error", 0)
                break
            case "string":
                rpcError = new JsonRpcError(error, -1)
                break
            case "number":
            case "bigint":
                rpcError = new JsonRpcError("application error", error as number)
                break
            case "object":
                if (error === null)
                    rpcError = new JsonRpcError("undefined error", 0)
                else {
                    if (error instanceof JsonRpcError)
                        rpcError = error
                    else if (error instanceof Error)
                        rpcError = new JsonRpcError(error.toString(), -100, error)
                    else
                        rpcError = new JsonRpcError("application error", -100, error)
                }
                break
            default:
                rpcError = new JsonRpcError("unspecified error", 0, { data: error })
                break
        }
        return JSONRPC.error(payload.id, rpcError)
    }
}

/*  export the standard way  */
export default API

