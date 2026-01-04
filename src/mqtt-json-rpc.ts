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

/*  type of a wrapped client id (for method overloading)  */
export type ClientId = { __clientId: string }

/*  MQTT topic making  */
export type TopicMake = (name: string, clientId?: string) => string

/*  MQTT topic matching  */
export type TopicMatch    = (topic: string) => TopicMatching | null
export type TopicMatching = { name: string, clientId?: string }

/*  API option type  */
export interface APIOptions {
    clientId:                  string
    codec:                     "cbor" | "json"
    timeout:                   number
    topicEventNoticeMake:      TopicMake
    topicServiceRequestMake:   TopicMake
    topicServiceResponseMake:  TopicMake
    topicEventNoticeMatch:     TopicMatch
    topicServiceRequestMatch:  TopicMatch
    topicServiceResponseMatch: TopicMatch
}

/*  Registration, Subscription and Observation result types  */
export interface Registration {
    unregister (): Promise<void>
}
export interface Subscription {
    unsubscribe (): Promise<void>
}

/*  type utilities for generic API  */
export type APISchema = Record<string, (...args: any[]) => any>

/*  extract event keys where return type IS void (events: subscribe/notify/control)  */
export type EventKeys<T> = string extends keyof T ? string : {
    [ K in keyof T ]: T[K] extends (...args: any[]) => infer R
    /*  eslint-disable-next-line @typescript-eslint/no-invalid-void-type  */
    ? [ R ] extends [ void ] ? K : never
    : never
}[ keyof T ]

/*  extract service keys where return type is NOT void (services: register/call)  */
export type ServiceKeys<T> = string extends keyof T ? string : {
    [ K in keyof T ]: T[K] extends (...args: any[]) => infer R
    /*  eslint-disable-next-line @typescript-eslint/no-invalid-void-type  */
    ? [ R ] extends [ void ] ? never : K
    : never
}[ keyof T ]

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
export default class API<T extends APISchema = APISchema> {
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
        /*  determine options and provide defaults  */
        this.options = {
            clientId: (new UUID(1)).format("std"),
            codec:    "cbor",
            timeout:  10 * 1000,
            topicEventNoticeMake: (name, clientId) => {
                return clientId
                    ? `${name}/event-notice/${clientId}`
                    : `${name}/event-notice`
            },
            topicServiceRequestMake: (name, clientId) => {
                return clientId
                    ? `${name}/service-request/${clientId}`
                    : `${name}/service-request`
            },
            topicServiceResponseMake: (name, clientId) => {
                return clientId
                    ? `${name}/service-response/${clientId}`
                    : `${name}/service-response`
            },
            topicEventNoticeMatch: (topic) => {
                const m = topic.match(/^(.+?)\/event-notice(?:\/(.+))?$/)
                return m ? { name: m[1], clientId: m[2] } : null
            },
            topicServiceRequestMatch: (topic) => {
                const m = topic.match(/^(.+?)\/service-request(?:\/(.+))?$/)
                return m ? { name: m[1], clientId: m[2] } : null
            },
            topicServiceResponseMatch: (topic) => {
                const m = topic.match(/^(.+?)\/service-response\/(.+)$/)
                return m ? { name: m[1], clientId: m[2] } : null
            },
            ...options
        }

        /*  establish an encoder  */
        this.codec = new Codec(this.options.codec)

        /*  hook into the MQTT message processing  */
        this.mqtt.on("message", (topic, message) => {
            this._onMessage(topic, message)
        })
    }

    /*  subscribe to an MQTT topic (Promise-based)  */
    private async _subscribeTopic (topic: string, options: Partial<IClientSubscribeOptions> = {}) {
        return new Promise<void>((resolve, reject) => {
            this.mqtt.subscribe(topic, { qos: 2, ...options }, (err: Error | null, _granted: any) => {
                if (err) reject(err)
                else     resolve()
            })
        })
    }

    /*  unsubscribe from an MQTT topic (Promise-based)  */
    private async _unsubscribeTopic (topic: string) {
        return new Promise<void>((resolve, reject) => {
            this.mqtt.unsubscribe(topic, (err?: Error, _packet?: any) => {
                if (err) reject(err)
                else     resolve()
            })
        })
    }

    /*  subscribe to an RPC event  */
    async subscribe<K extends EventKeys<T> & string> (
        event:    K,
        callback: T[K]
    ): Promise<Subscription>
    async subscribe<K extends EventKeys<T> & string> (
        event:    K,
        options:  Partial<IClientSubscribeOptions>,
        callback: T[K]
    ): Promise<Subscription>
    async subscribe<K extends EventKeys<T> & string> (
        event:    K,
        ...args:  any[]
    ): Promise<Subscription> {
        /*  determine parameters  */
        let options:  Partial<IClientSubscribeOptions> = {}
        let callback: T[K] = args[0] as T[K]
        if (args.length === 2 && typeof args[0] === "object") {
            options  = args[0]
            callback = args[1]
        }

        /*  sanity check situation  */
        if (this.registry.has(event))
            throw new Error(`subscribe: event "${event}" already subscribed`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicB = this.options.topicEventNoticeMake(event)
        const topicD = this.options.topicEventNoticeMake(event, this.options.clientId)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicB, { qos: 0, ...options }),
            this._subscribeTopic(topicD, { qos: 0, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicB).catch(() => {})
            this._unsubscribeTopic(topicD).catch(() => {})
            throw err
        })

        /*  remember the subscription  */
        this.registry.set(event, callback)

        /*  provide a subscription for subsequent unsubscribing  */
        const self = this
        const subscription: Subscription = {
            async unsubscribe (): Promise<void> {
                if (!self.registry.has(event))
                    throw new Error(`unsubscribe: event "${event}" not subscribed`)
                self.registry.delete(event)
                return Promise.all([
                    self._unsubscribeTopic(topicB),
                    self._unsubscribeTopic(topicD)
                ]).then(() => {})
            }
        }
        return subscription
    }

    /*  register an RPC service  */
    async register<K extends ServiceKeys<T> & string> (
        service:  K,
        callback: T[K]
    ): Promise<Registration>
    async register<K extends ServiceKeys<T> & string> (
        service:  K,
        options:  Partial<IClientSubscribeOptions>,
        callback: T[K]
    ): Promise<Registration>
    async register<K extends ServiceKeys<T> & string> (
        service:  K,
        ...args:  any[]
    ): Promise<Registration> {
        /*  determine parameters  */
        let options:  Partial<IClientSubscribeOptions> = {}
        let callback: T[K] = args[0] as T[K]
        if (args.length === 2 && typeof args[0] === "object") {
            options  = args[0]
            callback = args[1]
        }

        /*  sanity check situation  */
        if (this.registry.has(service))
            throw new Error(`register: service "${service}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicB = this.options.topicServiceRequestMake(service)
        const topicD = this.options.topicServiceRequestMake(service, this.options.clientId)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicB, { qos: 2, ...options }),
            this._subscribeTopic(topicD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicB).catch(() => {})
            this._unsubscribeTopic(topicD).catch(() => {})
            throw err
        })

        /*  remember the registration  */
        this.registry.set(service, callback)

        /*  provide a registration for subsequent unregistering  */
        const self = this
        const registration: Registration = {
            async unregister (): Promise<void> {
                if (!self.registry.has(service))
                    throw new Error(`unregister: service "${service}" not registered`)
                self.registry.delete(service)
                return Promise.all([
                    self._unsubscribeTopic(topicB),
                    self._unsubscribeTopic(topicD)
                ]).then(() => {})
            }
        }
        return registration
    }

    /*  check whether argument has structure of interface IClientPublishOptions  */
    private _isIClientPublishOptions (arg: any) {
        if (typeof arg !== "object")
            return false
        const keys = [ "qos", "retain", "dup", "properties", "cbStorePut" ]
        return Object.keys(arg).every((key) => keys.includes(key))
    }

    /*  wrap client id into object (required for type-safe overloading)  */
    clientId (id: string) {
        return { __clientId: id }
    }

    /*  return client id from wrapper object  */
    private _getClientId (obj: ClientId) {
        return obj.__clientId
    }

    /*  detect client id wrapper object  */
    private _isClientId (obj: any): obj is ClientId {
        return (typeof obj === "object"
            && obj !== null
            && "__clientId" in obj
            && typeof obj.__clientId === "string"
        )
    }

    /*  parse optional clientId and options from variadic arguments  */
    private _parseCallArgs<T extends any[]> (args: any[]): { clientId?: string, options: IClientPublishOptions, params: T } {
        let clientId: string | undefined
        let options: IClientPublishOptions = {}
        let params = args as T
        if (args.length >= 2 && this._isClientId(args[0]) && this._isIClientPublishOptions(args[1])) {
            clientId = this._getClientId(args[0])
            options  = args[1]
            params   = args.slice(2) as T
        }
        else if (args.length >= 1 && this._isClientId(args[0])) {
            clientId = this._getClientId(args[0])
            params   = args.slice(1) as T
        }
        else if (args.length >= 1 && this._isIClientPublishOptions(args[0])) {
            options = args[0]
            params  = args.slice(1) as T
        }
        return { clientId, options, params }
    }

    /*  emit event ("fire and forget")  */
    emit<K extends EventKeys<T> & string> (
        event:     K,
        ...params: Parameters<T[K]>
    ): void
    emit<K extends EventKeys<T> & string> (
        event:     K,
        clientId:  ClientId,
        ...params: Parameters<T[K]>
    ): void
    emit<K extends EventKeys<T> & string> (
        event:     K,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): void
    emit<K extends EventKeys<T> & string> (
        event:     K,
        clientId:  ClientId,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): void
    emit<K extends EventKeys<T> & string> (
        event:     K,
        ...args:   any[]
    ): void {
        /*  determine actual parameters  */
        const { clientId, options, params } = this._parseCallArgs<Parameters<T[K]>>(args)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicEventNoticeMake(event, clientId)

        /*  generate encoded JSON-RPC message  */
        const request = JSONRPC.notification(event, params)
        const message = this.codec.encode(request)

        /*  publish JSON-RPC message to MQTT topic  */
        this.mqtt.publish(topic, message, { qos: 2, ...options })
    }

    /*  call service ("request and response")  */
    call<K extends ServiceKeys<T> & string> (
        service:   K,
        ...params: Parameters<T[K]>
    ): Promise<Awaited<ReturnType<T[K]>>>
    call<K extends ServiceKeys<T> & string> (
        service:   K,
        clientId:  ClientId,
        ...params: Parameters<T[K]>
    ): Promise<Awaited<ReturnType<T[K]>>>
    call<K extends ServiceKeys<T> & string> (
        service:   K,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<Awaited<ReturnType<T[K]>>>
    call<K extends ServiceKeys<T> & string> (
        service:   K,
        clientId:  ClientId,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<Awaited<ReturnType<T[K]>>>
    call<K extends ServiceKeys<T> & string> (
        service:   K,
        ...args:   any[]
    ): Promise<Awaited<ReturnType<T[K]>>> {
        /*  determine actual parameters  */
        const { clientId, options, params } = this._parseCallArgs<Parameters<T[K]>>(args)

        /*  determine unique request id
            (NOTICE: the clientId prefix is necessary to later determine response topic)  */
        const rid: string = `${this.options.clientId}:${(new UUID(1)).format("std")}`

        /*  subscribe to MQTT response topic  */
        this._responseSubscribe(service, { qos: options.qos ?? 2 })

        /*  create promise for MQTT response handling  */
        const promise: Promise<Awaited<ReturnType<T[K]>>> = new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout | null = setTimeout(() => {
                this.requests.delete(rid)
                this._responseUnsubscribe(service)
                timer = null
                reject(new Error("communication timeout"))
            }, this.options.timeout)
            this.requests.set(rid, {
                service,
                callback: (err: any, result: Awaited<ReturnType<T[K]>>) => {
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
        const topic = this.options.topicServiceRequestMake(service, clientId)
        const message = this.codec.encode(request)
        this.mqtt.publish(topic, message, { qos: 2, ...options }, (err?: Error) => {
            /*  handle request failure  */
            const pendingRequest = this.requests.get(rid)
            if (err && pendingRequest !== undefined) {
                this.requests.delete(rid)
                this._responseUnsubscribe(service)
                pendingRequest.callback(err, undefined)
            }
        })

        return promise
    }

    /*  subscribe to RPC response  */
    private _responseSubscribe (service: string, options: IClientSubscribeOptions = { qos: 2 }): void {
        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicServiceResponseMake(service, this.options.clientId)

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
        const topic = this.options.topicServiceResponseMake(service, this.options.clientId)

        /*  short-circuit processing if (no longer) subscribed  */
        if (!this.subscriptions.has(topic))
            return

        /*  unsubscribe from MQTT topic and forget subscription  */
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
        let eventMatch:    TopicMatching | null = null
        let requestMatch:  TopicMatching | null = null
        let responseMatch: TopicMatching | null = null
        if (   (eventMatch    = this.options.topicEventNoticeMatch(topic))     === null
            && (requestMatch  = this.options.topicServiceRequestMatch(topic))  === null
            && (responseMatch = this.options.topicServiceResponseMatch(topic)) === null)
            return

        /*  ensure we really handle only MQTT RPC responses for us  */
        const clientId = eventMatch?.clientId ?? requestMatch?.clientId ?? responseMatch?.clientId
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
                const topic = this.options.topicServiceResponseMake(name, clientId)
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
