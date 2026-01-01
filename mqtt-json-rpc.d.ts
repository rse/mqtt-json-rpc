interface APIOptions {
    encoding?: "json" | "cbor" | "msgpack";
    timeout?: number;
}
declare class API {
    private options;
    private mqtt;
    private encodr;
    private cid;
    private registry;
    private requests;
    private subscriptions;
    constructor(mqtt: any, options?: APIOptions);
    registered(method: string): boolean;
    register(method: string, callback: (...params: any[]) => any): Promise<any>;
    unregister(method: string): Promise<any>;
    private _onServer;
    notify(method: string, ...params: any[]): void;
    call(method: string, ...params: any[]): Promise<any>;
    private _onClient;
    private _responseSubscribe;
    private _responseUnsubscribe;
    private _buildError;
}
export default API;
