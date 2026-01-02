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
import { MqttClient }             from "mqtt"
import UUID                       from "pure-uuid"
import JSONRPC, { JsonRpcError }  from "jsonrpc-lite"
import Encodr                     from "encodr"

/*  MQTT topic making and matching  */
type TopicRequestMake   = (method: string) => string
type TopicResponseMake  = (method: string, clientId: string) => string
type TopicRequestMatch  = (topic: string) => RegExpMatchArray | null
type TopicResponseMatch = (topic: string) => RegExpMatchArray | null

/*  API option type  */
interface APIOptions {
    clientId:           string
    encoding:           "json" | "cbor" | "msgpack"
    timeout:            number
    topicRequestMake:   TopicRequestMake
    topicResponseMake:  TopicResponseMake
    topicRequestMatch:  TopicRequestMatch
    topicResponseMatch: TopicResponseMatch
}

/*  the API class  */
class API {
    private options:       APIOptions
    private encodr:        Encodr
    private registry       = new Map<string, (...params: any[]) => any>()
    private requests       = new Map<string, (err: any, result: any) => void>()
    private subscriptions  = new Map<string, number>()

    constructor (
        private mqtt: MqttClient,
        options: Partial<APIOptions> = {}
    ) {
        /*  determine options  */
        this.options = {
            clientId:           (new UUID(1)).format("std"),
            encoding:           "json",
            timeout:            10 * 1000,
            topicRequestMake:   (method) => `${method}/request`,
            topicResponseMake:  (method, clientId) => `${method}/response/${clientId}`,
            topicRequestMatch:  (topic) => topic.match(/^(.+?)\/request$/),
            topicResponseMatch: (topic) => topic.match(/^(.+?)\/response\/(.+)$/),
            ...options
        }

        /*  establish an encoder  */
        this.encodr = new Encodr(this.options.encoding)

        /*  hook into the MQTT message processing  */
        this.mqtt.on("message", (topic: string, message: Buffer) => {
            this._onServerMessage(topic, message)
            this._onClientMessage(topic, message)
        })
    }

    /*
     *  RPC server/response side
     */

    /*  check for the registration of an RPC method  */
    registered (method: string): boolean {
        return this.registry.has(method)
    }

    /*  register an RPC method  */
    register (method: string, callback: (...params: any[]) => any): Promise<any> {
        if (this.registry.has(method))
            throw new Error(`register: method "${method}" already registered`)
        this.registry.set(method, callback)
        return new Promise((resolve, reject) => {
            const topic = this.options.topicRequestMake(method)
            this.mqtt.subscribe(topic, { qos: 2 }, (err: Error | null, granted: any) => {
                if (err)
                    reject(err)
                else
                    resolve(granted)
            })
        })
    }

    /*  unregister an RPC method  */
    unregister (method: string): Promise<any> {
        if (!this.registry.has(method))
            throw new Error(`unregister: method "${method}" not registered`)
        this.registry.delete(method)
        return new Promise((resolve, reject) => {
            const topic = this.options.topicRequestMake(method)
            this.mqtt.unsubscribe(topic, (err?: Error, packet?: any) => {
                if (err)
                    reject(err)
                else
                    resolve(packet)
            })
        })
    }

    /*  handle incoming RPC method request  */
    private _onServerMessage (topic: string, message: Buffer): void {
        /*  ensure we handle only MQTT JSON-RPC requests  */
        if (this.options.topicRequestMatch(topic) === null)
            return

        /*  try to parse payload as JSON-RPC payload  */
        let parsed: any
        try {
            parsed = JSONRPC.parseObject(this.encodr.decode(message))
        }
        catch (_error: any) {
            return
        }
        if (!(typeof parsed === "object" && typeof parsed.type === "string"))
            return

        /*  determine method from JSON-RPC payload  */
        const method = parsed.payload.method

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "notification") {
            /*  just deliver notification  */
            this.registry.get(method)?.(...parsed.payload.params)
        }
        else if (parsed.type === "request") {
            /*  deliver request and send response  */
            let response: Promise<any>
            const handler = this.registry.get(method)
            if (handler !== undefined)
                response = Promise.resolve().then(() => handler(...parsed.payload.params))
            else
                response = Promise.reject(JsonRpcError.methodNotFound({ method, id: parsed.payload.id }))
            response.then((result: any) => {
                /*  create JSON-RPC success response  */
                return JSONRPC.success(parsed.payload.id, result)
            }, (error: any) => {
                /*  create JSON-RPC error response  */
                return this._buildError(parsed.payload, error)
            }).then((rpcResponse: any) => {
                /*  send MQTT response message  */
                const idMatch = parsed.payload.id.match(/^(.+):.+$/)
                if (idMatch === null)
                    throw new Error("invalid request id format")
                const encoded = this.encodr.encode(rpcResponse) as string | Buffer
                const clientId: string = idMatch[1]
                const topic = this.options.topicResponseMake(method, clientId)
                this.mqtt.publish(topic, encoded, { qos: 0 })
            }).catch((err: Error) => {
                this.mqtt.emit("error", err)
            })
        }
    }

    /*
     *  RPC client/request side
     */

    /*  notify peer ("fire and forget")  */
    notify (method: string, ...params: any[]): void {
        const topic = this.options.topicRequestMake(method)
        let request: any = JSONRPC.notification(method, params)
        request = this.encodr.encode(request)
        this.mqtt.publish(topic, request, { qos: 0 })
    }

    /*  call peer ("request and response")  */
    call (method: string, ...params: any[]): Promise<any> {
        /*  remember callback and create JSON-RPC request  */
        const rid: string = `${this.options.clientId}:${(new UUID(1)).format("std")}`
        /*  subscribe for response  */
        this._responseSubscribe(method)

        /*  create promise for response handling  */
        const promise: Promise<any> = new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout | null = setTimeout(() => {
                this.requests.delete(rid)
                this._responseUnsubscribe(method)
                reject(new Error("communication timeout"))
                timer = null
            }, this.options.timeout!)
            this.requests.set(rid, (err: any, result: any) => {
                if (timer !== null) {
                    clearTimeout(timer)
                    timer = null
                }
                if (err) reject(err)
                else     resolve(result)
            })
        })
        let request: any = JSONRPC.request(rid, method, params)

        /*  send MQTT request message  */
        const topic = this.options.topicRequestMake(method)
        request = this.encodr.encode(request)
        this.mqtt.publish(topic, request, { qos: 2 }, (err?: Error) => {
            const callback = this.requests.get(rid)
            if (err && callback !== undefined) {
                /*  handle request failure  */
                this._responseUnsubscribe(method)
                callback(err, undefined)
                this.requests.delete(rid)
            }
        })

        return promise
    }

    /*  handle incoming RPC method response  */
    private _onClientMessage (topic: string, message: Buffer): void {
        /*  ensure we handle only MQTT JSON-RPC responses  */
        let m: RegExpMatchArray | null
        if ((m = this.options.topicResponseMatch(topic)) === null)
            return

        /*  ensure we really handle only MQTT RPC responses for us  */
        const clientId = m[2]
        if (clientId !== this.options.clientId)
            return

        /*  try to parse payload as JSON-RPC payload  */
        let parsed: any
        try {
            parsed = JSONRPC.parseObject(this.encodr.decode(message))
        }
        catch (_error: any) {
            return
        }
        if (!(typeof parsed === "object" && typeof parsed.type === "string"))
            return

        /*  determine method from JSON-RPC payload  */
        const method = parsed.payload.method

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "success" || parsed.type === "error") {
            const rid: string = parsed.payload.id
            const callback = this.requests.get(rid)
            if (callback !== undefined) {
                /*  call callback function  */
                if (parsed.type === "success")
                    callback(undefined, parsed.payload.result)
                else
                    callback(parsed.payload.error, undefined)

                /*  unsubscribe from response  */
                this.requests.delete(rid)
                this._responseUnsubscribe(method)
            }
        }
    }

    /*  subscribe to RPC response  */
    private _responseSubscribe (method: string): void {
        const topic = this.options.topicResponseMake(method, this.options.clientId)
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, 0)
            this.mqtt.subscribe(topic, { qos: 2 }, (err: Error | null) => {
                if (err)
                    this.mqtt.emit("error", err)
            })
        }
        this.subscriptions.set(topic, this.subscriptions.get(topic)! + 1)
    }

    /*  unsubscribe from RPC response  */
    private _responseUnsubscribe (method: string): void {
        const topic = this.options.topicResponseMake(method, this.options.clientId)
        if (!this.subscriptions.has(topic))
            return
        this.subscriptions.set(topic, this.subscriptions.get(topic)! - 1)
        if (this.subscriptions.get(topic) === 0) {
            this.subscriptions.delete(topic)
            this.mqtt.unsubscribe(topic, (err?: Error) => {
                if (err)
                    this.mqtt.emit("error", err)
            })
        }
    }

    /*  determine RPC error  */
    private _buildError (payload: any, error: any): any {
        /*  determine error type and build appropriate JSON-RPC error  */
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
                rpcError = new JsonRpcError("application error", Number(error))
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

