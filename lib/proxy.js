const url = require('url')
const net = require('net')
const http = require('http')
const https = require('https')
const EventsEmitter = require('events')

const { Pipeline } = require('./pipeline')
const { CertManager } = require('./cert-manager')
const { dumpPrivateKey, dumpCertificate } = require('./cert-utils')

class IdManager {
    constructor() {
        this.id = 0
    }

    make() {
        return this.id++
    }
}

class Proxy extends EventsEmitter {
    constructor({ transports = { 'http:': http, 'https:': https }, idManager = new IdManager(), certManager = new CertManager(), transparentMode = true } = {}) {
        super()

        this.transports = transports
        this.idManager = idManager
        this.certManager = certManager
        this.transparentMode = transparentMode

        this.servers = {}

        this.onRequestHandler = this.onRequestHandler.bind(this)
        this.onConnectHandler = this.onConnectHandler.bind(this)
    }

    pipeline(options, inputStream) {
        const head = options.request || options.response

        let next

        if (options.filter === 'passthrough') {
            next = (c) => c(head, inputStream)
        }
        else
        if (options.filter === 'pipeline') {
            inputStream.pause()

            if (options.pipeline.stream) {
                next = (c) => {
                    options.pipeline.stream.pause()
                    options.pipeline.stream.write(head)

                    const pipelineStream = inputStream.pipe(options.pipeline.stream)

                    options.pipeline.stream.once('data', (head) => {
                        c(head, pipelineStream)
                    })

                    options.pipeline.stream.resume()

                    inputStream.resume()
                }
            }
            else {
                next = (c) => c(head, inputStream)
            }
        }
        else {
            throw new Error(`Unrecognized filter ${options.filter}`)
        }

        return next
    }

    getConnection(options, callback) {
        const socket = new net.Socket()

        socket.once('connect', () => {
            socket.removeAllListeners('error')

            callback(null, socket)
        })

        socket.once('error', (error) => {
            callback(error)
        })

        socket.connect(options)
    }

    getProxyConnection(hostname, port, callback) {
        const host = `${hostname}:${port}`

        let next

        if (!this.servers.hasOwnProperty(host)) {
            const { keys, cert } = this.certManager.getServerKeysAndCert(hostname, port)

            const options = {
                key: dumpPrivateKey(keys),
                cert: dumpCertificate(cert)
            }

            const server = https.createServer(options)

            server.context = {
                protocol: 'https:',
                hostname: hostname,
                port: port,
                host: host
            }

            server.on('request', this.onRequestHandler)

            server.on('close', () => {
                delete this.servers[host]
            })

            next = (c) => server.listen(0, (err) => {
                if (err) {
                    return c(err)
                }

                this.servers[host] = server

                return c(null, server)
            })
        }
        else {
            next = (c) => c(null, this.servers[host])
        }

        next((err, server) => {
            if (err) {
                return callback(err)
            }

            this.getConnection({ port: server.address().port }, callback)
        })
    }

    onRequestHandler(req, res) {
        const request = url.parse(req.url)

        if (this.transparentMode) {
            if (!request.host) {
                const host = req.headers.host

                const sepIndex = host.indexOf(':')

                let hostname
                let port

                if (sepIndex > 0) {
                    hostname = host.slice(0, sepIndex)
                    port = parseInt(host.slice(sepIndex + 1), 10)
                }
                else {
                    hostname = host
                }

                request.hostname = hostname
                request.port = port
                request.host = host
            }

            if (!request.protocol) {
                if (request.port === 80) {
                    request.protocol = 'http:'
                }
                else
                if (request.port === 443) {
                    request.protocol = 'https:'
                }
                else {
                    request.protocol = 'http:'
                }
            }
        }

        if (req.socket.server.context) {
            Object.assign(request, req.socket.server.context)
        }

        const transport = this.transports[request.protocol]

        if (!transport) {
            if (process.env.NODE_ENV !== 'production') {
                console.error(new Error(`Unknown protocol ${request.protocol}`))
            }

            res.end()

            return
        }

        request.headers = req.headers
        request.method = req.method
        request.httpVersion = req.httpVersion

        const requestOptions = {
            id: this.idManager.make(),
            request: request,
            filter: 'passthrough',
            pipeline: new Pipeline()
        }

        this.emit('request', requestOptions)

        if (requestOptions.filter === 'deny') {
            res.writeHead(401, 'Unauthorized')
            res.end()

            return
        }

        const next = this.pipeline(requestOptions, req)

        next((request, requestPipelineStream) => {
            const connection = transport.request(request)

            connection.once('response', (connectionResponse) => {
                connection.removeAllListeners()

                const response = { httpVersion: connectionResponse.httpVersion, statusCode: connectionResponse.statusCode, statusMessage: connectionResponse.statusMessage, headers: connectionResponse.headers }

                const responseOptions = {
                    id: requestOptions.id,
                    response: response,
                    filter: 'passthrough',
                    pipeline: new Pipeline()
                }

                this.emit('response', responseOptions)

                if (responseOptions.filter === 'deny') {
                    res.writeHead(401, 'Unauthorized')
                    res.end()

                    return
                }

                const next = this.pipeline(responseOptions, connectionResponse)

                next((response, responsePipelineStream) => {
                    res.writeHead(response.statusCode, response.headers)

                    responsePipelineStream.pipe(res, { end: true })
                })
            })

            connection.once('error', (error) => {
                connection.removeAllListeners()

                res.writeHead(502, 'Bad Gateway')
                res.end()
            })

            requestPipelineStream.pipe(connection, { end: true })
        })
    }

    onConnectHandler(req, clientSocket, head) {
        const connect = url.parse(`connect://${req.url}`)

        connect.headers = req.headers
        connect.method = req.method
        connect.httpVersion = req.httpVersion

        const connectOptions = {
            id: this.idManager.make(),
            connect: connect,
            filter: 'passthrough'
        }

        this.emit('connect', connectOptions)

        if (connectOptions.filter === 'deny') {
            clientSocket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')

            return
        }

        let connectionFunc

        if (connectOptions.filter === 'passthrough') {
            connectionFunc = this.getConnection.bind(this, { host: connect.hostname, port: connect.port })
        }
        else
        if (connectOptions.filter === 'pipeline') {
            connectionFunc = this.getProxyConnection.bind(this, connect.hostname, connect.port)
        }
        else {
            throw new Error(`Unrecognized filter ${connectOptions.filter}`)
        }

        connectionFunc((err, serverSocket) => {
            if (err) {
                if (process.env.NODE_ENV !== 'production') {
                    console.error(err)
                }

                return
            }

            clientSocket.write(`HTTP/1.1 200 Connection Established\r\n\r\n`)
            serverSocket.write(head)

            clientSocket.pipe(serverSocket)
            serverSocket.pipe(clientSocket)

            clientSocket.on('error', () => serverSocket.destroy())
            serverSocket.on('error', () => clientSocket.destroy())
        })
    }

    listen(port, callback) {
        this.server = http.createServer()

        this.server.on('request', this.onRequestHandler)
        this.server.on('connect', this.onConnectHandler)

        return new Promise((resolve, reject) => {
            this.server.listen(port, (err) => {
                if (err) {
                    if (callback) {
                        callback(err)
                        resolve()
                    }
                    else {
                        reject(err)
                    }
                }
                else {
                    if (callback) {
                        callback()
                        resolve()
                    }
                    else {
                        resolve()
                    }
                }
            })
        })
    }

    close(callback) {
        return new Promise((resolve, reject) => {
            Promise.all([this.server].concat(Object.values(this.servers)).map((server) => {
                    return new Promise((resolve) => {
                        server.close(resolve)
                    })
                }))
                .then(() => {
                    if (callback) {
                        callback()
                        resolve()
                    }
                    else {
                        resolve()
                    }
                })
                .error((err) => {
                    if (callback) {
                        callback(err)
                        resolve()
                    }
                    else {
                        reject(err)
                    }
                })
        })
    }
}

exports.Proxy = Proxy
