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
import { MqttClient, IClientPublishOptions,
    IClientSubscribeOptions }                from "mqtt"
import UUID                                  from "pure-uuid"
import CBOR                                  from "cbor"
import JSONRPC, {
    JsonRpcError, JsonRpcParsed, ID,
    RpcParams, NotificationObject,
    RequestObject, SuccessObject,
    ErrorObject }                            from "jsonrpc-lite"

/*  MQTT topic making  */
export type TopicEventMake     = (name: string, clientId?: string) => string
export type TopicServiceMake   = (name: string, clientId?: string) => string

/*  MQTT topic matching  */
export type TopicEventMatch    = (topic: string) => RegExpMatchArray | null
export type TopicServiceMatch  = (topic: string) => RegExpMatchArray | null

/*  API option type  */
export interface APIOptions {
    clientId:           string
    codec:              "cbor" | "json"
    timeout:            number
    topicEventMake:     TopicEventMake
    topicServiceMake:   TopicServiceMake
    topicEventMatch:    TopicEventMatch
    topicServiceMatch:  TopicServiceMatch
}

/*  Registration, Subscription and Observation result types  */
export interface Registration {
    unregister (): Promise<void>
}
export interface Subscription {
    unsubscribe (): Promise<void>
}

/*  the encoder/decoder abstraction  */
class Codec {
    constructor (private type: "cbor" | "json") {}
    encode (data: unknown): Buffer | string {
        let result: Buffer | string
        if (this.type === "cbor") {
            try { result = CBOR.encode(data) }
            catch (_ex) { throw new Error("failed to encode CBOR format") }
        }
        else if (this.type === "json") {
            try { result = JSON.stringify(data) }
            catch (_ex) { throw new Error("failed to encode JSON format") }
        }
        else
            throw new Error("invalid format")
        return result
    }
    decode (data: Buffer | string): unknown {
        let result: unknown
        if (this.type === "cbor" && typeof data === "object" && data instanceof Buffer) {
            try { result = CBOR.decode(data) }
            catch (_ex) { throw new Error("failed to decode CBOR format") }
        }
        else if (this.type === "json" && typeof data === "string") {
            try { result = JSON.parse(data) }
            catch (_ex) { throw new Error("failed to decode JSON format") }
        }
        else
            throw new Error("invalid format or wrong data type")
        return result
    }
}

/*  the API class  */
export default class API {
    private options:      APIOptions
    private codec:        Codec
    private registry      = new Map<string, ((...params: any[]) => any) | ((...params: any[]) => void)>()
    private requests      = new Map<string, { service: string, callback: (err: any, result: any) => void }>()
    private subscriptions = new Map<string, number>()

    /*  construct API class  */
    constructor (
        private mqtt: MqttClient,
        options: Partial<APIOptions> = {}
    ) {
        /*  determine options  */
        this.options = {
            clientId:          (new UUID(1)).format("std"),
            codec:             "cbor",
            timeout:           10 * 1000,
            topicEventMake:    (name, clientId) => clientId ? `${name}/event/${clientId}`    : `${name}/event`,
            topicServiceMake:  (name, clientId) => clientId ? `${name}/response/${clientId}` : `${name}/request`,
            topicEventMatch:   (topic) => topic.match(/^(.+?)\/event(?:\/(.+))?$/),
            topicServiceMatch: (topic) => topic.match(/^(.+?)\/(?:request|response\/(.+))$/),
            ...options
        }

        /*  establish an encoder  */
        this.codec = new Codec(this.options.codec)

        /*  hook into the MQTT message processing  */
        this.mqtt.on("message", (topic, message) => {
            this._onMessage(topic, message)
        })
    }

    /*  register an RPC service  */
    register<C extends ((...params: any[]) => any)> (
        service:  string,
        callback: C,
        options?: Partial<IClientSubscribeOptions>
    ): Promise<Registration> {
        if (this.registry.has(service))
            throw new Error(`register: service "${service}" already registered`)
        this.registry.set(service, callback)
        return new Promise((resolve, reject) => {
            const topic = this.options.topicServiceMake(service)
            this.mqtt.subscribe(topic, { qos: 2, ...options }, (err: Error | null, granted: any) => {
                if (err)
                    reject(err)
                else {
                    const self = this
                    const registration: Registration = {
                        async unregister (): Promise<void> {
                            if (!self.registry.has(service))
                                throw new Error(`unregister: method "${service}" not registered`)
                            self.registry.delete(service)
                            return new Promise((resolve, reject) => {
                                self.mqtt.unsubscribe(topic, (err?: Error, packet?: any) => {
                                    if (err)
                                        reject(err)
                                    else
                                        resolve()
                                })
                            })
                        }
                    }
                    resolve(registration)
                }
            })
        })
    }

    /*  subscribe to an RPC event  */
    subscribe<C extends ((...params: any[]) => void)> (
        event:    string,
        callback: C,
        options:  Partial<IClientSubscribeOptions>
    ): Promise<Subscription> {
        if (this.registry.has(event))
            throw new Error(`subscribe: event "${event}" already subscribed`)
        this.registry.set(event, callback)
        return new Promise((resolve, reject) => {
            const topic = this.options.topicEventMake(event)
            this.mqtt.subscribe(topic, { qos: 2, ...options }, (err: Error | null, granted: any) => {
                if (err)
                    reject(err)
                else {
                    const self = this
                    const subscription: Subscription = {
                        async unsubscribe (): Promise<void> {
                            if (!self.registry.has(event))
                                throw new Error(`unsubscribe: event "${event}" not subscribed`)
                            self.registry.delete(event)
                            return new Promise((resolve, reject) => {
                                self.mqtt.unsubscribe(topic, (err?: Error, packet?: any) => {
                                    if (err)
                                        reject(err)
                                    else
                                        resolve()
                                })
                            })
                        }
                    }
                    resolve(subscription)
                }
            })
        })
    }

    /*  check whether argument has structure of interface IClientPublishOptions  */
    _isIClientPublishOptions (args: any) {
        if (typeof args[0] !== "object")
            return false
        const keys = [ "qos", "retain", "dup", "properties", "cbStorePut" ]
        if (!Object.keys(args).every((key) => keys.includes(key)))
            return false
    }

    /*  notify (one or more) peers with event ("fire and forget")  */
    notify<P extends any[]> (
        event:      string,
        ...params:  P
    ): void
    notify<P extends any[]> (
        event:      string,
        options:    IClientPublishOptions,
        ...params:  P
    ): void
    notify<P extends any[]> (
        event:      string,
        ...args:    any[]
    ): void {
        /*  determine options and parameters  */
        let options: IClientPublishOptions = {}
        let params = args as P
        if (args.length > 0 && this._isIClientPublishOptions(args[0])) {
            options = args[0]
            params  = args.slice(1) as P
        }

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicEventMake(event)

        /*  generate encoded JSON-RPC message  */
        const request = JSONRPC.notification(event, params)
        const message = this.codec.encode(request)

        /*  publish JSON-RPC message to MQTT topic  */
        this.mqtt.publish(topic, message, { qos: 0, ...options })
    }

    /*  control (one) peer with event ("fire and forget")  */
    control<P extends any[]> (
        clientId:  string,
        event:     string,
        ...params: P
    ): void
    control<P extends any[]> (
        clientId:  string,
        event:     string,
        options:   IClientPublishOptions,
        ...params: P
    ): void
    control<P extends any[]> (
        clientId:  string,
        event:     string,
        ...args:   any[]
    ): void {
        /*  determine options and parameters  */
        let options: IClientPublishOptions = {}
        let params = args as P
        if (args.length > 0 && this._isIClientPublishOptions(args[0])) {
            options = args[0]
            params  = args.slice(1) as P
        }

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicEventMake(event, clientId)

        /*  generate encoded JSON-RPC message  */
        const request: any = JSONRPC.notification(event, params)
        const message = this.codec.encode(request)

        /*  publish JSON-RPC message to MQTT topic  */
        this.mqtt.publish(topic, message, { qos: 2, ...options })
    }

    /*  call peer service ("request and response")  */
    call<C extends ((...params: any[]) => any)> (
        service:   string,
        ...params: Parameters<C>
    ): Promise<ReturnType<C>>
    call<C extends ((...params: any[]) => any)> (
        service:   string,
        options:   IClientPublishOptions,
        ...params: Parameters<C>
    ): Promise<ReturnType<C>>
    call<C extends ((...params: any[]) => any)> (
        service:   string,
        ...args:   any[]
    ): Promise<ReturnType<C>> {
        /*  determine options and parameters  */
        let options: IClientPublishOptions = {}
        let params = args as Parameters<C>
        if (args.length > 0 && this._isIClientPublishOptions(args[0])) {
            options = args[0]
            params  = args.slice(1) as Parameters<C>
        }

        /*  determine unique request id
            (NOTICE: the clientId prefix is necessary to later determine response topic)  */
        const rid: string = `${this.options.clientId}:${(new UUID(1)).format("std")}`

        /*  subscribe to MQTT response topic  */
        this._responseSubscribe(service, { qos: options.qos ?? 2 })

        /*  create promise for MQTT response handling  */
        const promise: Promise<ReturnType<C>> = new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout | null = setTimeout(() => {
                this.requests.delete(rid)
                this._responseUnsubscribe(service)
                timer = null
                reject(new Error("communication timeout"))
            }, this.options.timeout!)
            this.requests.set(rid, {
                service,
                callback: (err: any, result: ReturnType<C>) => {
                    if (timer !== null) {
                        clearTimeout(timer)
                        timer = null
                    }
                    if (err) reject(err)
                    else     resolve(result)
                }
            })
        })
        const request = JSONRPC.request(rid, service, params)

        /*  send MQTT request message  */
        const topic = this.options.topicServiceMake(service)
        const message = this.codec.encode(request)
        this.mqtt.publish(topic, message, { qos: 2, ...options }, (err?: Error) => {
            /*  handle request failure  */
            const request = this.requests.get(rid)
            if (err && request !== undefined) {
                this.requests.delete(rid)
                this._responseUnsubscribe(service)
                request.callback(err, undefined)
            }
        })

        return promise
    }

    /*  subscribe to RPC response  */
    private _responseSubscribe (service: string, options: IClientSubscribeOptions = { qos: 2 }): void {
        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicServiceMake(service, this.options.clientId)

        /*  subscribe to MQTT topic and remember subscription  */
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, 0)
            this.mqtt.subscribe(topic, options, (err: Error | null) => {
                if (err)
                    this.mqtt.emit("error", err)
            })
        }
        this.subscriptions.set(topic, this.subscriptions.get(topic)! + 1)
    }

    /*  unsubscribe from RPC response  */
    private _responseUnsubscribe (service: string): void {
        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicServiceMake(service, this.options.clientId)

        /*  short-circuit processing if (no longer) subscribed  */
        if (!this.subscriptions.has(topic))
            return

        /*  unsubscribe from MQTT topic and unremember subscription  */
        this.subscriptions.set(topic, this.subscriptions.get(topic)! - 1)
        if (this.subscriptions.get(topic) === 0) {
            this.subscriptions.delete(topic)
            this.mqtt.unsubscribe(topic, (err?: Error) => {
                if (err)
                    this.mqtt.emit("error", err)
            })
        }
    }

    /*  handle incoming MQTT message  */
    private _onMessage (topic: string, message: Buffer): void {
        /*  ensure we handle only MQTT JSON-RPC messages  */
        let m1: RegExpMatchArray | null = null
        let m2: RegExpMatchArray | null = null
        if (   (m1 = this.options.topicEventMatch(topic))   === null
            && (m2 = this.options.topicServiceMatch(topic)) === null)
            return

        /*  ensure we really handle only MQTT RPC responses for us  */
        const clientId = (m1 !== null ? m1[2] : (m2 !== null ? m2[2] : undefined))
        if (clientId !== undefined && clientId !== this.options.clientId)
            return

        /*  try to parse payload as JSON-RPC payload  */
        let parsed: JsonRpcParsed
        try {
            let input: Buffer | string = message
            if (this.options.codec === "json")
                input = message.toString()
            const payload = this.codec.decode(input)
            parsed = JSONRPC.parseObject(payload)
        }
        catch (_err: unknown) {
            const err = _err instanceof JsonRpcError
                ? new Error(`failed to parse JSON-RPC message: ${_err.message}`)
                : new Error("failed to parse JSON-RPC message")
            this.mqtt.emit("error", err)
            return
        }

        /*  determine parameters  */
        const getId = (arg: ID) =>
            (typeof arg === "string" ? arg : String(arg))
        const getParams = (arg: RpcParams | undefined) => {
            if (arg === undefined)
                return []
            if (!(typeof arg === "object" && Array.isArray(arg)))
                return []
            return Array.from(arg)
        }

        /*  dispatch according to JSON-RPC type  */
        if (parsed.type === "notification" && parsed.payload instanceof NotificationObject) {
            /*  just deliver event  */
            const name = parsed.payload.method
            const handler = this.registry.get(name)
            const params = getParams(parsed.payload.params)
            handler?.(...params)
        }
        else if (parsed.type === "request" && parsed.payload instanceof RequestObject) {
            /*  deliver service request and send response  */
            const rid = getId(parsed.payload.id)
            const name = parsed.payload.method
            const handler = this.registry.get(name)
            let response: Promise<any>
            if (handler !== undefined) {
                /*  execute service handler  */
                const params = getParams(parsed.payload.params)
                response = Promise.resolve().then(() => handler(...params))
            }
            else
                response = Promise.reject(JsonRpcError.methodNotFound({ method: name, id: rid }))
            response.then((result: any) => {
                /*  create JSON-RPC success response  */
                return JSONRPC.success(rid, result)
            }, (result: any) => {
                /*  determine error type and build appropriate JSON-RPC error response  */
                let rpcError: JsonRpcError
                switch (typeof result) {
                    case "undefined":
                        rpcError = new JsonRpcError("undefined error", 0)
                        break
                    case "string":
                        rpcError = new JsonRpcError(result, -1)
                        break
                    case "number":
                        rpcError = new JsonRpcError("application error", result)
                        break
                    case "bigint":
                        rpcError = new JsonRpcError("application error", Number(result))
                        break
                    case "object":
                        if (result === null)
                            rpcError = new JsonRpcError("undefined error", 0)
                        else if (result instanceof JsonRpcError)
                            rpcError = result
                        else if (result instanceof Error)
                            rpcError = new JsonRpcError(result.toString(), -100, result)
                        else
                            rpcError = new JsonRpcError("application error", -100, result)
                        break
                    default:
                        rpcError = new JsonRpcError("unspecified error", 0, { data: result })
                        break
                }
                return JSONRPC.error(rid, rpcError)
            }).then((rpcResponse) => {
                /*  send MQTT response message  */
                const idMatch = rid.match(/^(.+):.+$/)
                if (idMatch === null)
                    throw new Error("invalid request id format")
                const clientId = idMatch[1]
                const encoded = this.codec.encode(rpcResponse)
                const topic = this.options.topicServiceMake(name, clientId)
                this.mqtt.publish(topic, encoded, { qos: 2 })
            }).catch((err: Error) => {
                this.mqtt.emit("error", err)
            })
        }
        else if ((parsed.type === "success" && parsed.payload instanceof SuccessObject)
            || (parsed.type === "error" && parsed.payload instanceof ErrorObject)) {
            /*  handle service response  */
            const rid = getId(parsed.payload.id)
            const request = this.requests.get(rid)
            if (request !== undefined) {
                /*  call callback function  */
                if (parsed.type === "success" && parsed.payload instanceof SuccessObject)
                    request.callback(undefined, parsed.payload.result)
                else if (parsed.type === "error" && parsed.payload instanceof ErrorObject)
                    request.callback(parsed.payload.error, undefined)

                /*  unsubscribe from response  */
                this.requests.delete(rid)
                this._responseUnsubscribe(request.service)
            }
        }
    }
}
